import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'resume-builder.sqlite');

// Owns the SQLite connection and schema. One reason to change: the database
// shape. Repositories receive this prepared connection and never open their own.
class Connection {
  readonly db: Database.Database;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
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

      CREATE INDEX IF NOT EXISTS idx_resume_messages_session ON resume_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_resume_versions_session ON resume_versions(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_items_category    ON memory_items(category);
    `);
  }
}

export const db: Database.Database = new Connection().db;
