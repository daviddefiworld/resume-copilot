import { db, type Statement } from '../database/connection.ts';
import type { McpServer } from '../../shared/types.ts';

// Raw row: JSON columns are stored as text and `enabled` as an integer.
interface McpRow {
  id: string;
  name: string;
  transport: string;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  enabled: number;
  created_at: string;
}

// Tolerant JSON parse for a stored column. Returns the fallback on bad/empty
// data so one corrupt row never breaks the whole server list.
function parse<T>(value: string, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function hydrate(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport === 'http' ? 'http' : 'stdio',
    command: row.command,
    args: parse<string[]>(row.args, []),
    env: parse<Record<string, string>>(row.env, {}),
    url: row.url,
    headers: parse<Record<string, string>>(row.headers, {}),
    enabled: row.enabled === 1,
    created_at: row.created_at
  };
}

function toRow(s: McpServer): McpRow {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: JSON.stringify(s.args ?? []),
    env: JSON.stringify(s.env ?? {}),
    url: s.url,
    headers: JSON.stringify(s.headers ?? {}),
    enabled: s.enabled ? 1 : 0,
    created_at: s.created_at
  };
}

// Data access for configured MCP servers. Owns (de)serialization of its own JSON
// columns; live connections and validation belong to the service layer.
class McpRepository {
  private readonly listStmt: Statement;
  private readonly getStmt: Statement;
  private readonly insertStmt: Statement;
  private readonly updateStmt: Statement;
  private readonly deleteStmt: Statement;

  constructor() {
    this.listStmt = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC');
    this.getStmt = db.prepare('SELECT * FROM mcp_servers WHERE id = ?');
    this.insertStmt = db.prepare(
      `INSERT INTO mcp_servers (id, name, transport, command, args, env, url, headers, enabled, created_at)
       VALUES (@id, @name, @transport, @command, @args, @env, @url, @headers, @enabled, @created_at)`
    );
    this.updateStmt = db.prepare(
      `UPDATE mcp_servers SET name = @name, transport = @transport, command = @command, args = @args,
        env = @env, url = @url, headers = @headers, enabled = @enabled WHERE id = @id`
    );
    this.deleteStmt = db.prepare('DELETE FROM mcp_servers WHERE id = ?');
  }

  list(): McpServer[] {
    return (this.listStmt.all() as McpRow[]).map(hydrate);
  }

  get(id: string): McpServer | undefined {
    const row = this.getStmt.get(id) as McpRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  insert(server: McpServer): void {
    this.insertStmt.run(toRow(server));
  }

  update(server: McpServer): void {
    this.updateStmt.run(toRow(server));
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}

export const mcpRepository = new McpRepository();
