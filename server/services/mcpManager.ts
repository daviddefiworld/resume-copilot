import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { mcpRepository } from '../repositories/mcpRepository.ts';
import type { McpServer, McpServerStatus, OpenAITool } from '../../shared/types.ts';

// Hard bounds on MCP operations. A misbehaving server — a stdio child that
// spawns but never speaks MCP, or an HTTP/SSE endpoint that accepts the socket
// but never replies — must fail cleanly, not hang the chat turn. The transport's
// own start() has no built-in timeout (the SSE EventSource can stay open and
// silent forever), so we race connect() against our own timer below.
const CONNECT_TIMEOUT_MS = 15_000;
const TOOL_TIMEOUT_MS = 30_000;

// The transport object client.connect() accepts (derived so we don't depend on
// the SDK's transport import path). Not to be confused with McpServer.transport.
type ClientTransport = Parameters<Client['connect']>[0];

// The model sees a tool as "<server>__<tool>". This maps that name back to the
// connection and the tool's real name so we can route a call.
interface Route {
  serverId: string;
  serverName: string;
  original: string;
}

// The result of running one tool, as the loop needs it: text to feed back to the
// model, whether it succeeded, and labels for the chat trace.
export interface ToolCallResult {
  text: string;
  ok: boolean;
  server: string;
  tool: string;
}

// Tool names exposed to the model must match ^[a-zA-Z0-9_-]{1,64}$.
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function qualify(serverName: string, toolName: string): string {
  return `${sanitize(serverName)}__${sanitize(toolName)}`.slice(0, 64);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A clear authentication failure is not a transport mismatch, so it must not be
// masked by silently retrying over a different transport. Used to decide whether
// the Streamable→SSE fallback should fire or rethrow the real error.
function isAuthError(error: unknown): boolean {
  const message = errorMessage(error);
  return /\b(401|403)\b/.test(message) || /unauthor|forbidden/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// An MCP tool's inputSchema is already a JSON Schema; make sure it is a usable
// object schema (some servers omit `properties` or `type`), which the model API
// requires for a function's `parameters`.
function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (isRecord(schema)) {
    const out = { ...schema };
    if (!out.type) out.type = 'object';
    if (out.type === 'object' && !isRecord(out.properties)) out.properties = {};
    return out;
  }
  return { type: 'object', properties: {} };
}

// Flatten an MCP tool result into text. Tool results are an array of content
// blocks; we keep text blocks verbatim and JSON-encode anything else, capped so
// a huge result can't blow the token budget.
function textOf(result: unknown): string {
  const blocks = isRecord(result) ? result.content : undefined;
  if (!Array.isArray(blocks)) {
    // Legacy/compat results carry a `toolResult` instead of content blocks.
    return isRecord(result) && 'toolResult' in result ? JSON.stringify(result.toolResult) : '';
  }
  const text = blocks
    .map((block) => (isRecord(block) && block.type === 'text' ? String(block.text ?? '') : JSON.stringify(block)))
    .join('\n')
    .trim();
  return text.length > 8000 ? `${text.slice(0, 8000)}\n…(truncated)` : text;
}

// Owns every live MCP connection. Connects servers lazily, exposes their tools
// to the agent in OpenAI function form, and routes tool calls back to the right
// server. Connections are reused across turns and reconnected when a server's
// config changes or its process dies. One reason to change: how we talk to MCP.
class McpManager {
  private readonly clients = new Map<string, { client: Client; signature: string }>();
  private readonly statusById = new Map<string, McpServerStatus>();
  private route = new Map<string, Route>();

  // Connect every enabled server and return their tools for the model. Rebuilds
  // the call route each time so it always reflects the current servers. A server
  // that fails to connect is skipped (its error is recorded for the UI).
  async listTools(): Promise<OpenAITool[]> {
    const servers = mcpRepository.list().filter((s) => s.enabled);
    this.route = new Map();
    // Connect every server concurrently and skip any that fail or time out, so a
    // single slow/dead server can neither serialize delay onto the others nor
    // hang the turn. Safe to parallelize: loadTools swallows each server's own
    // errors and writes the shared route map under a unique qualified name.
    const results = await Promise.allSettled(servers.map((server) => this.loadTools(server)));
    const tools: OpenAITool[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') tools.push(...result.value);
    }
    return tools;
  }

  // Run a tool the model asked for. Never throws — a failure (including a
  // timeout or the run's deadline aborting) comes back as text so the model can
  // read the error and recover. `signal` lets the agent's overall run deadline
  // cancel a tool call that's still in flight.
  async callTool(qualifiedName: string, args: unknown, signal?: AbortSignal): Promise<ToolCallResult> {
    const route = this.route.get(qualifiedName);
    if (!route) {
      return { text: `Tool "${qualifiedName}" is not available.`, ok: false, server: 'unknown', tool: qualifiedName };
    }
    const entry = this.clients.get(route.serverId);
    if (!entry) {
      return { text: `The server for "${qualifiedName}" is not connected.`, ok: false, server: route.serverName, tool: route.original };
    }
    try {
      const result = await entry.client.callTool(
        { name: route.original, arguments: isRecord(args) ? args : {} },
        undefined,
        { timeout: TOOL_TIMEOUT_MS, resetTimeoutOnProgress: false, signal }
      );
      return { text: textOf(result), ok: result.isError !== true, server: route.serverName, tool: route.original };
    } catch (error) {
      return { text: errorMessage(error), ok: false, server: route.serverName, tool: route.original };
    }
  }

  // Connect one server and report what it exposes — used by the Settings "Test"
  // button. Leaves the connection warm so the next chat turn reuses it.
  async refresh(server: McpServer): Promise<McpServerStatus> {
    await this.loadTools(server);
    return this.statusOf(server.id);
  }

  // Last-known status for a server (after a connect or a Test). "Not connected"
  // until something has tried.
  statusOf(id: string): McpServerStatus {
    return this.statusById.get(id) ?? { connected: false, toolCount: 0, tools: [], error: null, instructions: null };
  }

  // The server-level usage guidance (MCP `instructions`) of every enabled,
  // connected server, concatenated into one labelled block for the agent's
  // system prompt. Each server is capped so one can't dominate the prompt (and to
  // bound a prompt-injection blast radius). '' when no connected server sent any.
  // Reads the status populated by loadTools(), so call listTools() first.
  instructionsText(): string {
    const PER_SERVER_CAP = 4000;
    const blocks: string[] = [];
    for (const server of mcpRepository.list().filter((s) => s.enabled)) {
      const text = this.statusById.get(server.id)?.instructions;
      if (!text) continue;
      const clipped = text.length > PER_SERVER_CAP ? `${text.slice(0, PER_SERVER_CAP)}\n…(truncated)` : text;
      blocks.push(`Guidance from tool server "${server.name}":\n${clipped}`);
    }
    return blocks.join('\n\n');
  }

  // Drop a live connection (on delete/update). Closing also kills a stdio child.
  async disconnect(id: string): Promise<void> {
    const entry = this.clients.get(id);
    this.clients.delete(id);
    this.statusById.delete(id);
    if (entry) {
      try {
        await entry.client.close();
      } catch {
        // Already gone — nothing to clean up.
      }
    }
  }

  // Connect (reusing a healthy connection), list the server's tools, register
  // their routes, and record status. On any failure: drop the connection so the
  // next attempt reconnects, record the error, and return no tools.
  private async loadTools(server: McpServer): Promise<OpenAITool[]> {
    try {
      const client = await this.connect(server);
      const { tools } = await client.listTools(undefined, { timeout: TOOL_TIMEOUT_MS });
      // Server-level usage guidance sent on initialize. Most clients ignore this;
      // forwarding it is what lets a server teach the agent how to use its tools
      // together without the agent hard-coding any knowledge of the server.
      const instructions = client.getInstructions()?.trim() || null;
      const defs: OpenAITool[] = tools.map((tool) => {
        const name = qualify(server.name, tool.name);
        this.route.set(name, { serverId: server.id, serverName: server.name, original: tool.name });
        return {
          type: 'function',
          function: { name, description: tool.description ?? '', parameters: normalizeSchema(tool.inputSchema) }
        };
      });
      this.statusById.set(server.id, {
        connected: true,
        toolCount: tools.length,
        tools: tools.map((t) => t.name),
        error: null,
        instructions
      });
      return defs;
    } catch (error) {
      await this.disconnect(server.id);
      this.statusById.set(server.id, { connected: false, toolCount: 0, tools: [], error: errorMessage(error), instructions: null });
      return [];
    }
  }

  // Return a connected client, reusing the cached one when the server's config is
  // unchanged; otherwise (re)connect.
  private async connect(server: McpServer): Promise<Client> {
    const signature = JSON.stringify({
      transport: server.transport,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers
    });
    const existing = this.clients.get(server.id);
    if (existing && existing.signature === signature) return existing.client;
    if (existing) await this.disconnect(server.id);

    const client = await this.openClient(server);
    this.clients.set(server.id, { client, signature });
    return client;
  }

  // Connect a client to a transport, but never wait longer than CONNECT_TIMEOUT_MS.
  // The MCP SDK's own request timeout does NOT cover transport.start() — and the
  // SSE EventSource resolves only on an `endpoint` event with no internal timer —
  // so a server that accepts the socket and goes silent would otherwise hang the
  // connect forever. On timeout we close the client to tear down the half-open
  // stream/child process so it can't leak, then reject with a clear message.
  private async connectWithTimeout(client: Client, transport: ClientTransport, serverName: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void client.close().catch(() => {});
        reject(new Error(`MCP server "${serverName}" did not respond within ${CONNECT_TIMEOUT_MS}ms while connecting.`));
      }, CONNECT_TIMEOUT_MS);
    });
    try {
      await Promise.race([client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Build the transport for a server and connect a fresh client. Remote servers
  // try Streamable HTTP first and fall back to the older HTTP+SSE transport.
  private async openClient(server: McpServer): Promise<Client> {
    if (server.transport === 'http') {
      const url = new URL(server.url);
      const init = { requestInit: { headers: server.headers } };
      try {
        const client = new Client({ name: 'sox-agent', version: '1.0.0' });
        await this.connectWithTimeout(client, new StreamableHTTPClientTransport(url, init), server.name);
        return client;
      } catch (error) {
        // Only fall back to the older HTTP+SSE transport for a genuine transport
        // mismatch. A 401/403 means the auth header is wrong, not the transport —
        // rethrow it so the user sees the real reason instead of a generic SSE error.
        if (isAuthError(error)) throw error;
        const client = new Client({ name: 'sox-agent', version: '1.0.0' });
        await this.connectWithTimeout(client, new SSEClientTransport(url, init), server.name);
        return client;
      }
    }

    const client = new Client({ name: 'sox-agent', version: '1.0.0' });
    await this.connectWithTimeout(
      client,
      new StdioClientTransport({ command: server.command, args: server.args, env: server.env, stderr: 'ignore' }),
      server.name
    );
    return client;
  }
}

export const mcpManager = new McpManager();
