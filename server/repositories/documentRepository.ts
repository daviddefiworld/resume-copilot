import { db, type Statement } from '../database/connection.ts';
import type { SessionDocument } from '../../shared/types.ts';

// Data access for per-session workspace documents. Pure persistence: ids and
// timestamps are assigned by the service. Documents cascade-delete with their
// session (see the FK in connection.ts).
class DocumentRepository {
  private readonly insertStmt: Statement;
  private readonly listStmt: Statement;
  private readonly getStmt: Statement;
  private readonly findByTitleStmt: Statement;
  private readonly updateStmt: Statement;
  private readonly deleteStmt: Statement;

  constructor() {
    this.insertStmt = db.prepare(
      `INSERT INTO session_documents (id, session_id, title, content, created_at, updated_at)
       VALUES (@id, @session_id, @title, @content, @created_at, @updated_at)`
    );
    this.listStmt = db.prepare('SELECT * FROM session_documents WHERE session_id = ? ORDER BY created_at ASC');
    this.getStmt = db.prepare('SELECT * FROM session_documents WHERE id = ?');
    // Case-insensitive title match within a session, so the agent's upsert finds
    // an existing document instead of piling up near-duplicates.
    this.findByTitleStmt = db.prepare(
      'SELECT * FROM session_documents WHERE session_id = ? AND lower(trim(title)) = lower(trim(?)) ORDER BY created_at ASC LIMIT 1'
    );
    this.updateStmt = db.prepare(
      'UPDATE session_documents SET title = ?, content = ?, updated_at = ? WHERE id = ?'
    );
    this.deleteStmt = db.prepare('DELETE FROM session_documents WHERE id = ?');
  }

  insert(doc: SessionDocument): void {
    this.insertStmt.run({ ...doc });
  }

  list(sessionId: string): SessionDocument[] {
    return this.listStmt.all(sessionId) as SessionDocument[];
  }

  get(id: string): SessionDocument | undefined {
    return this.getStmt.get(id) as SessionDocument | undefined;
  }

  findByTitle(sessionId: string, title: string): SessionDocument | undefined {
    return this.findByTitleStmt.get(sessionId, title) as SessionDocument | undefined;
  }

  update(id: string, title: string, content: string, updatedAt: string): void {
    this.updateStmt.run(title, content, updatedAt, id);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}

export const documentRepository = new DocumentRepository();
