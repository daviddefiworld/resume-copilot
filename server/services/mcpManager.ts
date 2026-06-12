import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { mcpRepository } from '../repositories/mcpRepository.ts';
import type { McpServer, McpServerStatus, OpenAITool } from '../../shared/types.ts';

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
    const tools: OpenAITool[] = [];
    for (const server of servers) {
      tools.push(...(await this.loadTools(server)));
    }
    return tools;
  }

  // Run a tool the model asked for. Never throws — a failure comes back as text
  // so the model can read the error and recover.
  async callTool(qualifiedName: string, args: unknown): Promise<ToolCallResult> {
    const route = this.route.get(qualifiedName);
    if (!route) {
      return { text: `Tool "${qualifiedName}" is not available.`, ok: false, server: 'unknown', tool: qualifiedName };
    }
    const entry = this.clients.get(route.serverId);
    if (!entry) {
      return { text: `The server for "${qualifiedName}" is not connected.`, ok: false, server: route.serverName, tool: route.original };
    }
    try {
      const result = await entry.client.callTool({ name: route.original, arguments: isRecord(args) ? args : {} });
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
    return this.statusById.get(id) ?? { connected: false, toolCount: 0, tools: [], error: null };
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
      const { tools } = await client.listTools();
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
        error: null
      });
      return defs;
    } catch (error) {
      await this.disconnect(server.id);
      this.statusById.set(server.id, { connected: false, toolCount: 0, tools: [], error: errorMessage(error) });
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

  // Build the transport for a server and connect a fresh client. Remote servers
  // try Streamable HTTP first and fall back to the older HTTP+SSE transport.
  private async openClient(server: McpServer): Promise<Client> {
    if (server.transport === 'http') {
      const url = new URL(server.url);
      const init = { requestInit: { headers: server.headers } };
      try {
        const client = new Client({ name: 'sox-agent', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(url, init));
        return client;
      } catch {
        const client = new Client({ name: 'sox-agent', version: '1.0.0' });
        await client.connect(new SSEClientTransport(url, init));
        return client;
      }
    }

    const client = new Client({ name: 'sox-agent', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({ command: server.command, args: server.args, env: server.env, stderr: 'ignore' })
    );
    return client;
  }
}

export const mcpManager = new McpManager();
