import { settingsService } from './settingsService.ts';
import type { ChatMessage, OpenAITool, ToolCall } from '../../shared/types.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface RequestOptions {
  temperature: number;
  responseFormat?: { type: 'json_object' };
  model?: string;
}

interface CallOptions {
  temperature?: number;
  // Override the model for this call (e.g. the final-resume model). Defaults to
  // the configured primary model.
  model?: string;
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

// The raw message OpenRouter returns (content may be null on a tool-call turn).
interface RawMessage {
  content?: string | null;
  tool_calls?: ToolCall[];
}

interface CompletionResponse {
  choices?: Array<{ message?: RawMessage }>;
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
  async json<T = unknown>(messages: ChatMessage[], { temperature = 0.2, model }: CallOptions = {}): Promise<T> {
    let content: string;
    try {
      content = await this.request(messages, { temperature, model, responseFormat: { type: 'json_object' } });
    } catch (error) {
      if (!unsupportedJsonFormat(error)) throw error;
      content = await this.request(messages, { temperature, model });
    }
    return this.parseJson<T>(content);
  }

  // Agentic turn: send the conversation plus the tools the model may call, and
  // return the assistant message (text and/or tool calls). The agent loop owns
  // executing the calls and deciding when to stop.
  async complete(messages: ChatMessage[], { tools, temperature = 0.4, model }: CompleteOptions = {}): Promise<AssistantMessage> {
    const body: Record<string, unknown> = {
      model: model || settingsService.model(),
      messages,
      temperature
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const message = await this.postChat(body);
    return { content: typeof message.content === 'string' ? message.content : '', tool_calls: message.tool_calls };
  }

  private async request(messages: ChatMessage[], { temperature, responseFormat, model }: RequestOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: model || settingsService.model(),
      messages,
      temperature
    };
    if (responseFormat) {
      body.response_format = responseFormat;
    }
    const message = await this.postChat(body);
    if (typeof message.content !== 'string') {
      throw new Error('OpenRouter returned an empty response.');
    }
    return message.content;
  }

  // The single outbound call: auth, transport, timeout, and error shaping. Both
  // plain completions and tool-calling turns go through here.
  private async postChat(body: Record<string, unknown>): Promise<RawMessage> {
    const apiKey = settingsService.apiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key is not set. Add it in Settings.');
    }

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Agentic Resume Builder'
        },
        body: JSON.stringify(body),
        // Bound the whole request so a stalled connection fails cleanly with a
        // clear message instead of hanging or surfacing a bare "fetch failed".
        signal: AbortSignal.timeout(90_000)
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new Error('OpenRouter timed out after 90s. The network or the model is slow — try again.');
      }
      // The request never reached OpenRouter (DNS, refused connection, proxy,
      // TLS, connect timeout). `fetch` only says "fetch failed" — the real
      // reason is on the cause, so surface it.
      throw new Error(`Could not reach OpenRouter: ${describeNetworkError(error)}. ` +
        'Check your internet connection, VPN/proxy, or firewall.');
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const data = (await response.json()) as CompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('OpenRouter returned an empty response.');
    }
    return message;
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
