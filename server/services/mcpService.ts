import { randomUUID } from 'crypto';
import { mcpRepository } from '../repositories/mcpRepository.ts';
import { mcpManager } from './mcpManager.ts';
import { MCP_CATALOG } from '../data/mcpCatalog.ts';
import type { McpCatalogEntry, McpServer, McpServerInput, McpServerStatus, McpServerView, McpTransport } from '../../shared/types.ts';

// Keep only non-empty string args, preserving order (paths/flags may contain
// spaces, so we don't split — the caller provides one entry per argument).
function cleanArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  return args.map((a) => String(a)).filter((a) => a.length > 0);
}

// A string→string map with empty keys dropped (used for env vars and headers).
function cleanMap(map: unknown): Record<string, string> {
  if (typeof map !== 'object' || map === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    const k = key.trim();
    if (k) out[k] = String(value ?? '');
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Find the name→config map inside a pasted config. Supports Claude Desktop
// ({ "mcpServers": {…} }), VS Code ({ "servers": {…} }), a bare name→config map,
// or a single server object pasted on its own.
function extractServers(parsed: unknown): Record<string, unknown> {
  if (!isObject(parsed)) throw new Error('The config must be a JSON object.');
  if (isObject(parsed.mcpServers)) return parsed.mcpServers;
  if (isObject(parsed.servers)) return parsed.servers;
  if (typeof parsed.command === 'string' || typeof parsed.url === 'string') {
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Imported server';
    return { [name]: parsed };
  }
  return parsed;
}

// Turn one config entry into a server input. Transport is taken from an explicit
// type/transport field, otherwise inferred (a url means remote, else stdio).
function entryToInput(name: string, cfg: unknown): McpServerInput {
  if (!isObject(cfg)) throw new Error('not a valid server object');
  const url = typeof cfg.url === 'string' ? cfg.url : '';
  const declared = String(cfg.type ?? cfg.transport ?? '').toLowerCase();
  const transport: McpTransport =
    declared.includes('http') || declared === 'sse' ? 'http' : declared === 'stdio' ? 'stdio' : url ? 'http' : 'stdio';
  return {
    name,
    transport,
    command: typeof cfg.command === 'string' ? cfg.command : '',
    args: Array.isArray(cfg.args) ? cfg.args.map((a) => String(a)) : [],
    env: isObject(cfg.env) ? (cfg.env as Record<string, string>) : {},
    url,
    headers: isObject(cfg.headers) ? (cfg.headers as Record<string, string>) : {},
    // Honour either an `enabled: false` or a `disabled: true` flag.
    enabled: cfg.enabled !== false && cfg.disabled !== true
  };
}

// Configuration + validation for MCP servers, plus the catalog. Owns the rule
// that a server is valid before we ever try to connect it; the live connection
// itself is the manager's job, and the agent loop reads tools straight from the
// manager. One reason to change: what makes a server config valid.
class McpService {
  // All configured servers with their last-known connection status.
  listView(): McpServerView[] {
    return mcpRepository.list().map((server) => this.toView(server));
  }

  catalog(): McpCatalogEntry[] {
    return MCP_CATALOG;
  }

  // Insert and return immediately. We do NOT connect here: a first stdio launch
  // can download a package and take many seconds, which would hang the request.
  // The agent connects lazily on first use, and "Test" connects on demand.
  add(input: McpServerInput): McpServerView {
    const server = this.normalize(input);
    mcpRepository.insert(server);
    return this.toView(server);
  }

  async update(id: string, input: McpServerInput): Promise<McpServerView> {
    const existing = mcpRepository.get(id);
    if (!existing) throw new Error('MCP server not found.');
    const server = this.normalize(input, existing);
    // Drop the old connection so the next use reconnects with the new config.
    await mcpManager.disconnect(id);
    mcpRepository.update(server);
    return this.toView(server);
  }

  // Import one or more servers from a pasted config (Claude Desktop / VS Code
  // style). Each entry is upserted by name, so re-pasting updates rather than
  // duplicates. Returns how many imported plus a message per skipped entry.
  async importConfig(raw: unknown): Promise<{ added: number; errors: string[] }> {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      if (!raw.trim()) throw new Error('Paste a config first.');
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('That is not valid JSON.');
      }
    }

    const map = extractServers(parsed);
    const names = Object.keys(map);
    if (names.length === 0) throw new Error('No servers found in the config.');

    const errors: string[] = [];
    let added = 0;
    for (const name of names) {
      try {
        await this.upsertByName(entryToInput(name, map[name]));
        added++;
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : 'invalid'}`);
      }
    }
    if (added === 0) throw new Error(errors.join('; ') || 'Could not import any servers.');
    return { added, errors };
  }

  async delete(id: string): Promise<void> {
    if (!mcpRepository.get(id)) throw new Error('MCP server not found.');
    await mcpManager.disconnect(id);
    mcpRepository.delete(id);
  }

  // Connect now and report what the server exposes (the Settings "Test" button).
  async test(id: string): Promise<McpServerStatus> {
    const server = mcpRepository.get(id);
    if (!server) throw new Error('MCP server not found.');
    return mcpManager.refresh(server);
  }

  // Insert a server, or update the one that already has this name (case-
  // insensitive). Used by config import so re-pasting is idempotent.
  private async upsertByName(input: McpServerInput): Promise<void> {
    const target = input.name.trim().toLowerCase();
    const existing = mcpRepository.list().find((s) => s.name.toLowerCase() === target);
    const server = this.normalize(input, existing);
    if (existing) {
      await mcpManager.disconnect(existing.id);
      mcpRepository.update(server);
    } else {
      mcpRepository.insert(server);
    }
  }

  private toView(server: McpServer): McpServerView {
    return { ...server, status: mcpManager.statusOf(server.id) };
  }

  // Build a validated server from input, merging onto an existing record for
  // partial updates. Throws a clear message when required fields are missing.
  private normalize(input: McpServerInput, base?: McpServer): McpServer {
    const transport: McpTransport = (input.transport ?? base?.transport) === 'http' ? 'http' : 'stdio';
    const name = String(input.name ?? base?.name ?? '').trim();
    if (!name) throw new Error('A server name is required.');

    const server: McpServer = {
      id: base?.id ?? randomUUID(),
      name,
      transport,
      command: String(input.command ?? base?.command ?? '').trim(),
      args: cleanArgs(input.args ?? base?.args),
      env: cleanMap(input.env ?? base?.env),
      url: String(input.url ?? base?.url ?? '').trim(),
      headers: cleanMap(input.headers ?? base?.headers),
      enabled: input.enabled ?? base?.enabled ?? true,
      created_at: base?.created_at ?? new Date().toISOString()
    };

    if (transport === 'stdio' && !server.command) {
      throw new Error('A start command is required for a local (stdio) server.');
    }
    if (transport === 'http') {
      if (!server.url) throw new Error('A server URL is required for a remote (http) server.');
      try {
        new URL(server.url);
      } catch {
        throw new Error('The server URL is not valid.');
      }
    }
    return server;
  }
}

export const mcpService = new McpService();
