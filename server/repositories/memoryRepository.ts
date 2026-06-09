import { db, type Statement } from '../database/connection.ts';
import type { MemoryItem, MemoryMessage } from '../../shared/types.ts';

// Data access for memory chat messages and confirmed memory items. Pure
// persistence: it stores and returns rows; ids, timestamps, and AI logic
// belong to the service layer.
class MemoryRepository {
  private readonly insertMessageStmt: Statement;
  private readonly listMessagesStmt: Statement;
  private readonly insertItemStmt: Statement;
  private readonly listItemsStmt: Statement;
  private readonly getItemStmt: Statement;
  private readonly updateItemStmt: Statement;
  private readonly deleteItemStmt: Statement;

  constructor() {
    this.insertMessageStmt = db.prepare(
      'INSERT INTO memory_messages (id, role, content, created_at) VALUES (@id, @role, @content, @created_at)'
    );
    this.listMessagesStmt = db.prepare('SELECT * FROM memory_messages ORDER BY created_at ASC LIMIT 200');
    this.insertItemStmt = db.prepare(
      `INSERT INTO memory_items (id, category, title, content, confidence, source_message_id, created_at, updated_at)
       VALUES (@id, @category, @title, @content, @confidence, @source_message_id, @created_at, @updated_at)`
    );
    this.listItemsStmt = db.prepare('SELECT * FROM memory_items ORDER BY category, created_at ASC');
    this.getItemStmt = db.prepare('SELECT * FROM memory_items WHERE id = ?');
    this.updateItemStmt = db.prepare(
      'UPDATE memory_items SET title = ?, content = ?, confidence = ?, updated_at = ? WHERE id = ?'
    );
    this.deleteItemStmt = db.prepare('DELETE FROM memory_items WHERE id = ?');
  }

  // ---- Messages ----

  appendMessage(message: MemoryMessage): void {
    this.insertMessageStmt.run(message);
  }

  listMessages(): MemoryMessage[] {
    return this.listMessagesStmt.all() as MemoryMessage[];
  }

  // ---- Items ----

  insertItems(items: MemoryItem[]): MemoryItem[] {
    const insertAll = db.transaction((rows: MemoryItem[]) => {
      for (const item of rows) this.insertItemStmt.run(item);
    });
    insertAll(items);
    return items;
  }

  listItems(): MemoryItem[] {
    return this.listItemsStmt.all() as MemoryItem[];
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
