import { db, type Statement } from '../database/connection.ts';
import type { Profile } from '../../shared/types.ts';

// Data access for profiles. Also owns the cross-table operations that scope
// memory and resume sessions to a profile: adopting orphaned (pre-profile) rows,
// and cascading a profile's data away on delete.
class ProfileRepository {
  private readonly listStmt: Statement;
  private readonly getStmt: Statement;
  private readonly insertStmt: Statement;
  private readonly renameStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly countStmt: Statement;
  private readonly claimMessagesStmt: Statement;
  private readonly claimItemsStmt: Statement;
  private readonly claimSessionsStmt: Statement;
  private readonly deleteMessagesStmt: Statement;
  private readonly deleteItemsStmt: Statement;
  private readonly deleteSessionsStmt: Statement;

  constructor() {
    this.listStmt = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC');
    this.getStmt = db.prepare('SELECT * FROM profiles WHERE id = ?');
    this.insertStmt = db.prepare('INSERT INTO profiles (id, name, created_at) VALUES (@id, @name, @created_at)');
    this.renameStmt = db.prepare('UPDATE profiles SET name = ? WHERE id = ?');
    this.deleteStmt = db.prepare('DELETE FROM profiles WHERE id = ?');
    this.countStmt = db.prepare('SELECT COUNT(*) AS n FROM profiles');
    this.claimMessagesStmt = db.prepare('UPDATE memory_messages SET profile_id = ? WHERE profile_id IS NULL');
    this.claimItemsStmt = db.prepare('UPDATE memory_items SET profile_id = ? WHERE profile_id IS NULL');
    this.claimSessionsStmt = db.prepare('UPDATE resume_sessions SET profile_id = ? WHERE profile_id IS NULL');
    this.deleteMessagesStmt = db.prepare('DELETE FROM memory_messages WHERE profile_id = ?');
    this.deleteItemsStmt = db.prepare('DELETE FROM memory_items WHERE profile_id = ?');
    this.deleteSessionsStmt = db.prepare('DELETE FROM resume_sessions WHERE profile_id = ?');
  }

  list(): Profile[] {
    return this.listStmt.all() as Profile[];
  }

  get(id: string): Profile | undefined {
    return this.getStmt.get(id) as Profile | undefined;
  }

  insert(profile: Profile): void {
    this.insertStmt.run(profile);
  }

  rename(id: string, name: string): void {
    this.renameStmt.run(name, id);
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  // Hand any pre-profile rows (profile_id IS NULL) to this profile, so memory and
  // resumes created before profiles existed aren't orphaned.
  claimOrphans(profileId: string): void {
    const claim = db.transaction(() => {
      this.claimMessagesStmt.run(profileId);
      this.claimItemsStmt.run(profileId);
      this.claimSessionsStmt.run(profileId);
    });
    claim();
  }

  // Delete a profile and everything it owns. Resume sessions cascade to their
  // messages/versions via the schema's ON DELETE CASCADE.
  remove(id: string): void {
    const purge = db.transaction(() => {
      this.deleteSessionsStmt.run(id);
      this.deleteItemsStmt.run(id);
      this.deleteMessagesStmt.run(id);
      this.deleteStmt.run(id);
    });
    purge();
  }
}

export const profileRepository = new ProfileRepository();
