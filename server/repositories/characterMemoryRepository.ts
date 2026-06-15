import { db, type Statement } from '../database/connection.ts';

// One character's persisted memory for a profile. `notes` is the character's
// durable, evolving sense of the user; `summary` is a running recap of the
// current conversation. `reflected_count` records how many transcript messages
// have already been folded into summary/notes, so reflection runs incrementally.
export interface CharacterMemoryRow {
  profile_id: string;
  personality_id: string;
  summary: string;
  notes: string;
  message_count: number;
  reflected_count: number;
  updated_at: string;
}

// Data access for per-(profile, personality) character memory. Pure persistence:
// the service layer owns ids, timestamps, and the AI reflection that produces
// the summary/notes text.
class CharacterMemoryRepository {
  private readonly getStmt: Statement;
  private readonly upsertStmt: Statement;
  private readonly clearStmt: Statement;
  private readonly resetConversationStmt: Statement;

  constructor() {
    this.getStmt = db.prepare(
      'SELECT * FROM character_memory WHERE profile_id = ? AND personality_id = ?'
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO character_memory
         (profile_id, personality_id, summary, notes, message_count, reflected_count, updated_at)
       VALUES (@profile_id, @personality_id, @summary, @notes, @message_count, @reflected_count, @updated_at)
       ON CONFLICT(profile_id, personality_id) DO UPDATE SET
         summary = excluded.summary,
         notes = excluded.notes,
         message_count = excluded.message_count,
         reflected_count = excluded.reflected_count,
         updated_at = excluded.updated_at`
    );
    this.clearStmt = db.prepare(
      'DELETE FROM character_memory WHERE profile_id = ? AND personality_id = ?'
    );
    // On a chat restart the conversation recap no longer applies, so drop the
    // summary and rewind reflection — but keep `notes`, the character's durable
    // knowledge of the user, intact across restarts.
    this.resetConversationStmt = db.prepare(
      `UPDATE character_memory SET summary = '', reflected_count = 0, message_count = 0, updated_at = ?
       WHERE profile_id = ?`
    );
  }

  get(profileId: string, personalityId: string): CharacterMemoryRow | undefined {
    return this.getStmt.get(profileId, personalityId) as CharacterMemoryRow | undefined;
  }

  upsert(row: CharacterMemoryRow): void {
    this.upsertStmt.run({ ...row });
  }

  clear(profileId: string, personalityId: string): void {
    this.clearStmt.run(profileId, personalityId);
  }

  // Reset the conversation recap for every character of a profile (called when
  // the shared transcript is wiped), preserving each character's durable notes.
  resetConversation(profileId: string, updatedAt: string): void {
    this.resetConversationStmt.run(updatedAt, profileId);
  }
}

export const characterMemoryRepository = new CharacterMemoryRepository();
