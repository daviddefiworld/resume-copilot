import { settingsService } from './settingsService.ts';
import type { ChatMessage, OpenAITool, ToolCall } from '../../shared/types.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Default ceiling on one outbound AI call. Enough for an agent step or a normal
// completion; the heavy single-shot generations (a full resume draft) pass a
// larger timeoutMs since they legitimately run longer than this.
const DEFAULT_TIMEOUT_MS = 90_000;

interface RequestOptions {
  temperature: number;
  responseFormat?: { type: 'json_object' };
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface CallOptions {
  temperature?: number;
  // Override the model for this call (e.g. the final-resume model). Defaults to
  // the configured primary model.
  model?: string;
  // An external abort signal (the agent run's overall budget, or a user Stop).
  // Combined with the per-call cap so whichever fires first ends the request.
  signal?: AbortSignal;
  // Per-call ceiling in ms (defaults to DEFAULT_TIMEOUT_MS). Heavy generations
  // raise it; the agent loop leaves it at the default and bounds itself separately.
  timeoutMs?: number;
}

interface CompleteOptions extends CallOptions {
  // Tools the model may call this turn. Omitted/empty → a plain completion.
  tools?: OpenAITool[];
}

// One assistant turn: its text and any tool calls it wants run. `content` is ''
// when the model replied with tool calls only.
export interface AssistantMessage {
  content: string;
  tool_calls?: ToolCall[];
}

// Invoked for each text chunk of a streaming completion, in order.
export type StreamDelta = (text: string) => void;

// The raw message OpenRouter returns (content may be null on a tool-call turn).
interface RawMessage {
  content?: string | null;
  tool_calls?: ToolCall[];
}

interface CompletionResponse {
  choices?: Array<{ message?: RawMessage }>;
}

// A single SSE chunk from a streaming completion. `delta.content` is the next
// slice of text; tool calls arrive in indexed pieces spread across chunks
// (id/name once, arguments accumulated character-by-character).
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

// True when an OpenRouter error looks like the model rejecting json_object
// response_format (so we can retry without it). Matches the 4xx messages
// providers return for unsupported/invalid response_format.
function unsupportedJsonFormat(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : '').toLowerCase();
  const isClientError = /\((400|404|422)\)/.test(message);
  return isClientError && (message.includes('response_format') || message.includes('json'));
}

// Turns a failed `fetch` into a human-readable reason. Node reports the useful
// detail (DNS, refused, timeout, TLS, proxy) on error.cause, not error.message.
function describeNetworkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  const hints: Record<string, string> = {
    ENOTFOUND: 'DNS lookup failed — the host openrouter.ai could not be resolved (likely offline or a proxy is required)',
    EAI_AGAIN: 'DNS lookup is temporarily failing (network or DNS issue)',
    ECONNREFUSED: 'the connection was refused (a proxy/firewall may be blocking it)',
    ECONNRESET: 'the connection was reset mid-request',
    ETIMEDOUT: 'the connection timed out',
    UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
    CERT_HAS_EXPIRED: 'the TLS certificate failed to validate (often a corporate proxy intercepting HTTPS)',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the TLS certificate could not be verified (often a corporate proxy intercepting HTTPS)'
  };
  if (code && hints[code]) return `${hints[code]} [${code}]`;
  return cause?.message || (error as Error).message || 'unknown network error';
}

// Owns every outbound AI request. Services talk to this class, never to
// OpenRouter directly, so credentials and transport stay in one place.
class OpenRouterService {
  // Plain chat completion. `messages` is an OpenAI-style array.
  async chat(messages: ChatMessage[], { temperature = 0.4, model }: CallOptions = {}): Promise<string> {
    return this.request(messages, { temperature, model });
  }

  // Chat completion that must return a single JSON object. Returns the parsed
  // value. Throws if the model returns unparseable output. Not every model on
  // OpenRouter accepts response_format: json_object, so fall back to a plain
  // request (our prompts already demand JSON and parseJson is tolerant).
  async json<T = unknown>(messages: ChatMessage[], { temperature = 0.2, model, signal, timeoutMs }: CallOptions = {}): Promise<T> {
    let content: string;
    try {
      content = await this.request(messages, { temperature, model, signal, timeoutMs, responseFormat: { type: 'json_object' } });
    } catch (error) {
      if (!unsupportedJsonFormat(error)) throw error;
      content = await this.request(messages, { temperature, model, signal, timeoutMs });
    }
    return this.parseJson<T>(content);
  }

  // Agentic turn: send the conversation plus the tools the model may call, and
  // return the assistant message (text and/or tool calls). The agent loop owns
  // executing the calls and deciding when to stop.
  async complete(messages: ChatMessage[], { tools, temperature = 0.4, model, signal, timeoutMs }: CompleteOptions = {}): Promise<AssistantMessage> {
    const body: Record<string, unknown> = {
      model: model || settingsService.model(),
      messages,
      temperature
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const message = await this.postChat(body, signal, timeoutMs);
    return { content: typeof message.content === 'string' ? message.content : '', tool_calls: message.tool_calls };
  }

  // Streaming variant of `complete`: the same request with `stream: true`, calling
  // `onDelta` for each text chunk as it arrives. Tool-call deltas are accumulated
  // and returned whole (a half-formed tool call is never surfaced), so the agent
  // loop treats a streamed turn exactly like a buffered one.
  async completeStream(
    messages: ChatMessage[],
    { tools, temperature = 0.4, model, signal, timeoutMs }: CompleteOptions = {},
    onDelta: StreamDelta
  ): Promise<AssistantMessage> {
    const body: Record<string, unknown> = {
      model: model || settingsService.model(),
      messages,
      temperature,
      stream: true
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const message = await this.postChatStream(body, onDelta, signal, timeoutMs);
    return { content: typeof message.content === 'string' ? message.content : '', tool_calls: message.tool_calls };
  }

  private async request(messages: ChatMessage[], { temperature, responseFormat, model, signal, timeoutMs }: RequestOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: model || settingsService.model(),
      messages,
      temperature
    };
    if (responseFormat) {
      body.response_format = responseFormat;
    }
    const message = await this.postChat(body, signal, timeoutMs);
    if (typeof message.content !== 'string') {
      throw new Error('OpenRouter returned an empty response.');
    }
    return message.content;
  }

  // The single outbound transport: auth, fetch, timeout, and error shaping. Both
  // buffered and streaming requests go through here; the caller decides how to
  // read the body. An optional external signal (the agent's run deadline) is
  // combined with the per-call cap so whichever fires first ends the request.
  private async dispatch(body: Record<string, unknown>, externalSignal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
    const apiKey = settingsService.apiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key is not set. Add it in Settings.');
    }

    // Bound the whole request so a stalled connection fails cleanly with a clear
    // message instead of hanging or surfacing a bare "fetch failed". When the
    // caller passes a run deadline, abort as soon as either fires.
    const signal = externalSignal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), externalSignal]) : AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Job Hunter Copilot'
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      throw this.transportError(error, timeoutMs);
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return response;
  }

  // Shape a transport-phase failure into a clear, user-facing error. Applied to
  // BOTH the initial fetch and the body read (json()/stream reader) — the per-call
  // timeout can fire while the model is still streaming a long buffered response,
  // and that abort lands on the body read, NOT the fetch. Without shaping it there
  // too, the raw "operation was aborted due to timeout" DOMException reaches the UI.
  private transportError(error: unknown, timeoutMs: number): Error {
    const name = (error as Error)?.name;
    // A user Stop aborts via an AbortController ('AbortError'), distinct from the
    // per-call/run timeout ('TimeoutError'). Surface the canonical 'Cancelled'
    // error every layer already swallows, not a misleading network failure.
    if (name === 'AbortError') {
      const cancelled = new Error('Request cancelled by the user.');
      cancelled.name = 'Cancelled';
      return cancelled;
    }
    if (name === 'TimeoutError') {
      return new Error(`OpenRouter timed out after ${Math.round(timeoutMs / 1000)}s. The network or the model is slow — try again.`);
    }
    // A real transport failure (DNS, refused, proxy, TLS, connection reset) carries
    // the underlying reason on `error.cause`; `fetch` itself only says "fetch
    // failed". An app-level error (no cause) is already clean — pass it through.
    if ((error as { cause?: unknown })?.cause) {
      return new Error(`Could not reach OpenRouter: ${describeNetworkError(error)}. ` +
        'Check your internet connection, VPN/proxy, or firewall.');
    }
    return error instanceof Error ? error : new Error('OpenRouter request failed.');
  }

  // Buffered completion: read the whole JSON body and return the one message.
  private async postChat(body: Record<string, unknown>, externalSignal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RawMessage> {
    const response = await this.dispatch(body, externalSignal, timeoutMs);
    let data: CompletionResponse;
    try {
      data = (await response.json()) as CompletionResponse;
    } catch (error) {
      // The timeout can elapse here, while the model is still producing the
      // (un-streamed) response — shape that abort like any other transport error.
      throw this.transportError(error, timeoutMs);
    }
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('OpenRouter returned an empty response.');
    }
    return message;
  }

  // Streaming completion: parse the SSE body, forwarding each text delta to
  // `onDelta` and re-assembling tool-call deltas (which arrive in indexed pieces)
  // into whole calls. Returns the fully assembled message once the stream ends.
  private async postChatStream(
    body: Record<string, unknown>,
    onDelta: StreamDelta,
    externalSignal?: AbortSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<RawMessage> {
    const response = await this.dispatch(body, externalSignal, timeoutMs);
    if (!response.body) {
      throw new Error('OpenRouter returned no response stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: ToolCall[] = [];

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Each SSE field is one line; process every complete line and keep any
        // trailing partial in the buffer until its newline arrives.
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          // Skip blanks and ': OPENROUTER PROCESSING' keep-alive comments.
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            continue; // a malformed/partial payload; ignore it
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          for (const tc of delta.tool_calls ?? []) {
            const index = tc.index ?? 0;
            const call = (toolCalls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.function.name += tc.function.name;
            if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
          }
        }
      }
    } catch (error) {
      // The per-call timeout can elapse mid-stream — shape that abort the same way
      // as one on the initial fetch, rather than leaking the raw DOMException.
      throw this.transportError(error, timeoutMs);
    }

    // The array can be sparse if providers number tool calls non-contiguously.
    const calls = toolCalls.filter(Boolean);
    return { content, tool_calls: calls.length > 0 ? calls : undefined };
  }

  // Models sometimes wrap JSON in prose or code fences despite instructions.
  // Extract the outermost object before parsing so callers get clean data.
  private parseJson<T>(content: string): T {
    const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('AI response did not contain JSON.');
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      throw new Error('AI response contained invalid JSON.');
    }
  }
}

export const openRouter = new OpenRouterService();
