import { db, type Statement } from '../database/connection.ts';
import type { MemoryItem, MemoryMessage } from '../../shared/types.ts';

// Data access for memory chat messages and confirmed memory items. Pure
// persistence: it stores and returns rows; ids, timestamps, and AI logic
// belong to the service layer.
class MemoryRepository {
  private readonly insertMessageStmt: Statement;
  private readonly listMessagesStmt: Statement;
  private readonly deleteMessagesStmt: Statement;
  private readonly insertItemStmt: Statement;
  private readonly listItemsStmt: Statement;
  private readonly getItemStmt: Statement;
  private readonly updateItemStmt: Statement;
  private readonly deleteItemStmt: Statement;

  constructor() {
    this.insertMessageStmt = db.prepare(
      'INSERT INTO memory_messages (id, profile_id, role, content, created_at) VALUES (@id, @profile_id, @role, @content, @created_at)'
    );
    this.listMessagesStmt = db.prepare(
      'SELECT * FROM memory_messages WHERE profile_id = ? ORDER BY created_at ASC LIMIT 200'
    );
    this.deleteMessagesStmt = db.prepare('DELETE FROM memory_messages WHERE profile_id = ?');
    this.insertItemStmt = db.prepare(
      `INSERT INTO memory_items (id, profile_id, category, title, content, confidence, source_message_id, created_at, updated_at)
       VALUES (@id, @profile_id, @category, @title, @content, @confidence, @source_message_id, @created_at, @updated_at)`
    );
    this.listItemsStmt = db.prepare('SELECT * FROM memory_items WHERE profile_id = ? ORDER BY category, created_at ASC');
    this.getItemStmt = db.prepare('SELECT * FROM memory_items WHERE id = ?');
    this.updateItemStmt = db.prepare(
      'UPDATE memory_items SET title = ?, content = ?, confidence = ?, updated_at = ? WHERE id = ?'
    );
    this.deleteItemStmt = db.prepare('DELETE FROM memory_items WHERE id = ?');
  }

  // ---- Messages ----

  appendMessage(message: MemoryMessage, profileId: string): void {
    this.insertMessageStmt.run({ ...message, profile_id: profileId });
  }

  listMessages(profileId: string): MemoryMessage[] {
    return this.listMessagesStmt.all(profileId) as MemoryMessage[];
  }

  // Clears the chat transcript for a profile. Saved memory items are untouched.
  deleteMessages(profileId: string): void {
    this.deleteMessagesStmt.run(profileId);
  }

  // ---- Items ----

  insertItems(items: MemoryItem[], profileId: string): MemoryItem[] {
    const insertAll = db.transaction((rows: MemoryItem[]) => {
      for (const item of rows) this.insertItemStmt.run({ ...item, profile_id: profileId });
    });
    insertAll(items);
    return items;
  }

  listItems(profileId: string): MemoryItem[] {
    return this.listItemsStmt.all(profileId) as MemoryItem[];
  }

  getItem(id: string): MemoryItem | undefined {
    return this.getItemStmt.get(id) as MemoryItem | undefined;
  }

  updateItem(id: string, title: string, content: string, confidence: string, updatedAt: string): void {
    this.updateItemStmt.run(title, content, confidence, updatedAt, id);
  }

  deleteItem(id: string): void {
    this.deleteItemStmt.run(id);
  }
}

export const memoryRepository = new MemoryRepository();
