import { openRouter } from './openRouterService.ts';
import { mcpManager } from './mcpManager.ts';
import type { ChatMessage, OpenAITool, ToolTraceEntry } from '../../shared/types.ts';

// Hard cap on tool round-trips per turn, so a confused model can't loop forever
// spawning tool calls. After this we force one final tool-free answer.
const MAX_STEPS = 6;

export interface AgentResult {
  content: string;
  trace: ToolTraceEntry[];
}

interface RunOptions {
  model?: string;
  temperature?: number;
}

// Best-effort detection that the model/provider rejected the `tools` parameter
// (not every OpenRouter model supports function calling). When it does, we retry
// the same turn without tools so the chat still answers.
function rejectsTools(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : '').toLowerCase();
  return /\((400|404|422)\)/.test(message) && (message.includes('tool') || message.includes('function'));
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    // A malformed arguments string still tells the model something ran; pass it
    // through so the tool can reject it and the model can correct itself.
    return raw;
  }
}

// The tool-calling loop shared by every agent chat. Given a prompt (system +
// history), it lets the model call MCP tools, runs them, feeds results back, and
// repeats until the model answers in prose or the step cap is hit. Returns the
// final text plus a trace of every tool call for the UI. Long-term memory and
// resume guardrails stay in the callers' system prompts — this only adds tools.
class AgentRunner {
  async run(messages: ChatMessage[], options: RunOptions = {}): Promise<AgentResult> {
    // Connect configured servers and gather their tools. If MCP is unavailable,
    // degrade to an ordinary completion rather than failing the chat.
    let tools: OpenAITool[] = [];
    try {
      tools = await mcpManager.listTools();
    } catch {
      tools = [];
    }

    const conversation: ChatMessage[] = [...messages];
    const trace: ToolTraceEntry[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const useTools = tools.length > 0;
      let assistant;
      try {
        assistant = await openRouter.complete(conversation, { ...options, tools: useTools ? tools : undefined });
      } catch (error) {
        if (useTools && rejectsTools(error)) {
          // The model can't use tools — answer plainly this turn and stop.
          const plain = await openRouter.complete(conversation, options);
          return { content: plain.content || '…', trace };
        }
        throw error;
      }

      const calls = assistant.tool_calls ?? [];
      if (calls.length === 0) {
        return { content: assistant.content || '…', trace };
      }

      // Echo the assistant's tool-call message back, then run each call and
      // append its result so the model can read it on the next step.
      conversation.push({ role: 'assistant', content: assistant.content || '', tool_calls: calls });
      for (const call of calls) {
        const args = parseArgs(call.function.arguments);
        const result = await mcpManager.callTool(call.function.name, args);
        trace.push({ server: result.server, tool: result.tool, args, result: result.text, ok: result.ok });
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: result.text || (result.ok ? '(no output)' : 'Tool call failed.')
        });
      }
    }

    // Step cap reached with tool calls still pending: ask for a final answer with
    // no tools so the turn always ends in a real reply.
    const final = await openRouter.complete(conversation, options);
    return {
      content: final.content || 'I used the available tools but ran out of steps before finishing. Tell me how to continue.',
      trace
    };
  }
}

export const agentRunner = new AgentRunner();
