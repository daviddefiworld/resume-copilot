import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SELF_TOOL_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'resume-builder.sqlite');

// A binding object may legitimately carry more keys than a statement consumes
// (e.g. an update reusing an insert's row shape). better-sqlite3 ignored the
// extras; node:sqlite rejects unknown named parameters, so we filter to the
// names a statement actually declares.
const NAMED_PARAM = /[@:$]([a-zA-Z_][a-zA-Z0-9_]*)/g;

function namedParamsOf(sql: string): Set<string> {
  const names = new Set<string>();
  for (const match of sql.matchAll(NAMED_PARAM)) names.add(match[1]);
  return names;
}

type Bindings = unknown[] | [Record<string, unknown>];

// Minimal prepared-statement wrapper mirroring the better-sqlite3 surface the
// repositories use: run/get/all with either positional or named bindings.
export class Statement {
  private readonly raw: StatementSync;
  private readonly named: Set<string>;

  constructor(raw: StatementSync, named: Set<string>) {
    this.raw = raw;
    this.named = named;
  }

  private bind(args: unknown[]): Bindings {
    const [first] = args;
    if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
      const source = first as Record<string, unknown>;
      const filtered: Record<string, unknown> = {};
      for (const key of this.named) if (key in source) filtered[key] = source[key];
      return [filtered];
    }
    return args as Bindings;
  }

  run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.raw.run(...(this.bind(args) as Parameters<StatementSync['run']>));
  }

  get(...args: unknown[]): unknown {
    return this.raw.get(...(this.bind(args) as Parameters<StatementSync['get']>));
  }

  all(...args: unknown[]): unknown[] {
    return this.raw.all(...(this.bind(args) as Parameters<StatementSync['all']>));
  }
}

// Owns the SQLite connection and schema. One reason to change: the database
// shape. Repositories receive this prepared connection and never open their own.
// Backed by Node's built-in node:sqlite so no native module has to be compiled
// or rebuilt per runtime (plain Node for dev, Electron's Node when packaged).
class Connection {
  readonly db: DatabaseSync;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.createSchema();
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql), namedParamsOf(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  // Runs `fn` inside a single transaction, mirroring better-sqlite3's
  // db.transaction(): returns a callable that commits on success and rolls
  // back on a thrown error.
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
    return (...args: Args): R => {
      this.db.exec('BEGIN');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_messages (
        id         TEXT PRIMARY KEY,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_items (
        id                TEXT PRIMARY KEY,
        category          TEXT NOT NULL,
        title             TEXT NOT NULL,
        content           TEXT NOT NULL,
        confidence        TEXT NOT NULL DEFAULT 'unverified',
        source_message_id TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resume_sessions (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        personality_id  TEXT NOT NULL DEFAULT 'strategic_minimalist',
        company_name    TEXT NOT NULL DEFAULT '',
        job_title       TEXT NOT NULL DEFAULT '',
        job_description TEXT NOT NULL DEFAULT '',
        location        TEXT NOT NULL DEFAULT '',
        company_notes   TEXT NOT NULL DEFAULT '',
        analysis        TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resume_messages (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resume_versions (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        template_id    TEXT NOT NULL DEFAULT 'classic_ats',
        content        TEXT NOT NULL,
        strategy       TEXT NOT NULL DEFAULT '{}',
        is_final       INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_documents (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_memory (
        profile_id      TEXT NOT NULL,
        personality_id  TEXT NOT NULL,
        summary         TEXT NOT NULL DEFAULT '',
        notes           TEXT NOT NULL DEFAULT '',
        message_count   INTEGER NOT NULL DEFAULT 0,
        reflected_count INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (profile_id, personality_id)
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        transport  TEXT NOT NULL DEFAULT 'stdio',
        command    TEXT NOT NULL DEFAULT '',
        args       TEXT NOT NULL DEFAULT '[]',
        env        TEXT NOT NULL DEFAULT '{}',
        url        TEXT NOT NULL DEFAULT '',
        headers    TEXT NOT NULL DEFAULT '{}',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resume_messages_session ON resume_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_resume_versions_session ON resume_versions(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_documents_session ON session_documents(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_items_category    ON memory_items(category);
    `);
    this.migrate();
  }

  // Forward-only migrations for databases created before a column existed. Each
  // step is guarded so it's safe to run on every startup. Memory and resume
  // sessions gain a profile_id so each profile owns an isolated memory + resume
  // set; existing rows keep profile_id NULL until the first profile adopts them.
  private migrate(): void {
    const addColumn = (table: string, column: string, decl: string): void => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
      }
    };
    addColumn('memory_messages', 'profile_id', 'profile_id TEXT');
    addColumn('memory_items', 'profile_id', 'profile_id TEXT');
    addColumn('resume_sessions', 'profile_id', 'profile_id TEXT');
    // Agent tool-call traces, stored as JSON on the assistant message that made
    // them. NULL on every message written before the agent existed.
    addColumn('memory_messages', 'tool_trace', 'tool_trace TEXT');
    addColumn('resume_messages', 'tool_trace', 'tool_trace TEXT');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_messages_profile ON memory_messages(profile_id);
      CREATE INDEX IF NOT EXISTS idx_memory_items_profile    ON memory_items(profile_id);
      CREATE INDEX IF NOT EXISTS idx_resume_sessions_profile ON resume_sessions(profile_id);
    `);
  }
}

export const db = new Connection();
