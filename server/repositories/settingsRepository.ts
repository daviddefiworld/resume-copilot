import type { Statement } from 'better-sqlite3';
import { db } from '../database/connection.ts';

interface SettingRow {
  value: string;
}

// Data access for the settings key-value table. No business rules here —
// environment fallbacks and the public view live in the service layer.
class SettingsRepository {
  private readonly getStmt: Statement;
  private readonly setStmt: Statement;
  private readonly deleteStmt: Statement;

  constructor() {
    this.getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    this.setStmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    this.deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
  }

  get(key: string): string | undefined {
    const row = this.getStmt.get(key) as SettingRow | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.setStmt.run(key, value);
  }

  delete(key: string): void {
    this.deleteStmt.run(key);
  }
}

export const settingsRepository = new SettingsRepository();
