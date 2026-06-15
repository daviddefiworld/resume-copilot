import { characterMemoryRepository, type CharacterMemoryRow } from '../repositories/characterMemoryRepository.ts';
import { openRouter } from './openRouterService.ts';
import { settingsService } from './settingsService.ts';
import { characterReflectionPrompt } from './prompts.ts';
import type { CharacterMemoryView, MemoryMessage, Personality } from '../../shared/types.ts';

// When the conversation passes this many messages, the character starts keeping
// a running recap instead of relying on the full transcript every turn.
const SUMMARIZE_AFTER = 10;
// How many new messages accumulate before the character reflects again (folds
// the latest exchange into its recap + notes). Bounds the extra LLM calls.
const REFLECT_EVERY = 6;
// Once a recap exists, how many of the most recent messages still go to the
// model verbatim (older context lives in the recap).
const RECENT_WINDOW = 10;

interface ReflectionResult {
  summary?: string;
  notes?: string;
}

// Gives each character a private, evolving memory of the user, scoped to a
// profile. Two parts: `summary` (a running recap of the current conversation,
// reset when the chat restarts) and `notes` (the character's durable sense of
// the user, kept across restarts). The recap also lets long chats stay within a
// sane context window. This never writes to the user's confirmed "Your story"
// memory — that path stays manual and confirmation-gated.
class CharacterMemoryService {
  private row(profileId: string, personalityId: string): CharacterMemoryRow {
    return (
      characterMemoryRepository.get(profileId, personalityId) ?? {
        profile_id: profileId,
        personality_id: personalityId,
        summary: '',
        notes: '',
        message_count: 0,
        reflected_count: 0,
        updated_at: ''
      }
    );
  }

  // The block injected into the chat system prompt as {{character}}: the
  // character's own notes plus the conversation recap so far. '' when empty.
  contextText(profileId: string, personalityId: string): string {
    const row = this.row(profileId, personalityId);
    const parts: string[] = [];
    if (row.notes.trim()) parts.push(`What you remember about them:\n${row.notes.trim()}`);
    if (row.summary.trim()) parts.push(`Where the conversation is up to:\n${row.summary.trim()}`);
    return parts.join('\n\n');
  }

  // Whether older history can be dropped in favour of the recap, and the recent
  // window to keep verbatim. Lets the chat scale past a long transcript.
  hasRecap(profileId: string, personalityId: string): boolean {
    return Boolean(this.row(profileId, personalityId).summary.trim());
  }

  recentWindow(): number {
    return RECENT_WINDOW;
  }

  summarizeAfter(): number {
    return SUMMARIZE_AFTER;
  }

  // After a turn, fold the conversation into this character's recap + notes when
  // it has grown enough since the last reflection. Best-effort: any failure is
  // swallowed so it can never break the chat itself.
  async maybeReflect(profileId: string, personality: Personality, messages: MemoryMessage[]): Promise<void> {
    const count = messages.length;
    const row = this.row(profileId, personality.id);
    const grownEnough = count >= SUMMARIZE_AFTER && count - row.reflected_count >= REFLECT_EVERY;
    if (!grownEnough) return;

    try {
      const transcript = messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');
      const result = await openRouter.json<ReflectionResult>(
        characterReflectionPrompt({
          personality,
          transcript,
          priorSummary: row.summary,
          priorNotes: row.notes
        }),
        { model: settingsService.advancedModel() }
      );
      characterMemoryRepository.upsert({
        profile_id: profileId,
        personality_id: personality.id,
        summary: String(result.summary ?? row.summary ?? '').trim(),
        notes: String(result.notes ?? row.notes ?? '').trim(),
        message_count: count,
        reflected_count: count,
        updated_at: new Date().toISOString()
      });
    } catch {
      // Reflection is an enhancement, not a requirement — leave memory as-is.
    }
  }

  getView(profileId: string, personalityId: string): CharacterMemoryView {
    const row = characterMemoryRepository.get(profileId, personalityId);
    return {
      personalityId,
      notes: row?.notes ?? '',
      summary: row?.summary ?? '',
      messageCount: row?.message_count ?? 0,
      updatedAt: row?.updated_at || null
    };
  }

  clear(profileId: string, personalityId: string): void {
    characterMemoryRepository.clear(profileId, personalityId);
  }

  // The shared transcript was wiped (chat restart): drop every character's recap
  // for this profile but keep their durable notes about the user.
  onConversationCleared(profileId: string): void {
    characterMemoryRepository.resetConversation(profileId, new Date().toISOString());
  }
}

export const characterMemoryService = new CharacterMemoryService();
