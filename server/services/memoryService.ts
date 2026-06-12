import { randomUUID } from 'crypto';
import { memoryRepository } from '../repositories/memoryRepository.ts';
import { openRouter } from './openRouterService.ts';
import { agentRunner } from './agentRunner.ts';
import { settingsService } from './settingsService.ts';
import { profileService } from './profileService.ts';
import { getPersonality } from '../data/personalities.ts';
import { memoryInterviewSystem, memoryExtractionPrompt } from './prompts.ts';
import type { ChatRole, MemoryItem, MemoryMessage, MemoryProposal, ToolTraceEntry } from '../../shared/types.ts';

interface ExtractionResult {
  items?: MemoryProposal[];
}

// Long-term career memory: the memory chat transcript and confirmed memory
// items. This is the ONLY place long-term memory is written. Generates ids and
// timestamps, runs AI extraction, and delegates persistence to the repository.
// Every operation is scoped to a profile — the chat/items UI works on the active
// profile; resume generation passes the session's own profile explicitly.
class MemoryService {
  // The active profile. The Copilot chat and Memory view always operate on it.
  private requireActiveProfile(): string {
    const id = profileService.activeId();
    if (!id) throw new Error('No active profile yet. Create one first.');
    return id;
  }

  listMessages(): MemoryMessage[] {
    return memoryRepository.listMessages(this.requireActiveProfile());
  }

  // Restart the chat: wipe the transcript for the active profile. Confirmed
  // memory items are deliberately left intact — only the conversation resets.
  clearMessages(): void {
    memoryRepository.deleteMessages(this.requireActiveProfile());
  }

  // Append the user's message, generate the agent's reply, store and return it.
  async sendMessage(content: string, personalityId: string): Promise<MemoryMessage> {
    const text = String(content || '').trim();
    if (!text) throw new Error('Message is required.');

    const profileId = this.requireActiveProfile();
    this.append('user', text, profileId);

    const personality = getPersonality(personalityId);
    // Give Sox the profile's saved memory so it builds on what it already knows
    // instead of re-asking. Read-only here — memory is still written only via the
    // confirm/extract flow.
    const memory = this.buildMemoryText(profileId);
    const history = memoryRepository.listMessages(profileId).map((m) => ({ role: m.role, content: m.content }));
    // Run as an agent so Sox can use any installed MCP tools mid-interview. The
    // interview/guardrail instructions stay in the system prompt unchanged.
    const result = await agentRunner.run([
      { role: 'system', content: memoryInterviewSystem(personality, memory) },
      ...history
    ]);

    return this.append('assistant', result.content, profileId, result.trace);
  }

  private append(role: ChatRole, content: string, profileId: string, trace?: ToolTraceEntry[]): MemoryMessage {
    const message: MemoryMessage = { id: randomUUID(), role, content, created_at: new Date().toISOString(), tool_trace: trace };
    memoryRepository.appendMessage(message, profileId);
    return message;
  }

  // Extract candidate memory items from the recent transcript, reconciled against
  // what is already saved so existing items get updated instead of duplicated.
  // Runs on the higher-accuracy model. Returns proposals for the user to confirm
  // — nothing is saved here.
  async proposeUpdates(): Promise<{ items: MemoryProposal[] }> {
    const profileId = this.requireActiveProfile();
    const recent = memoryRepository.listMessages(profileId).slice(-30);
    if (recent.length === 0) return { items: [] };
    const transcript = recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const existing = this.buildMemoryTextWithIds(profileId);
    const result = await openRouter.json<ExtractionResult>(
      memoryExtractionPrompt(transcript, existing),
      { model: settingsService.advancedModel() }
    );
    const existingItems = memoryRepository.listItems(profileId);
    const known = new Set(existingItems.map((i) => i.id));
    // Index existing items by category + normalized title to catch duplicates the
    // model proposes as "new" when an equivalent item already exists.
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const byTitle = new Map(existingItems.map((i) => [`${norm(i.category)}::${norm(i.title)}`, i.id]));

    const items = (Array.isArray(result.items) ? result.items : [])
      .filter((i) => i && i.category && i.title && i.content)
      .map((i) => {
        // Trust the model's update only when it names a memory id we actually have.
        let action: 'new' | 'update' = i.action === 'update' && typeof i.id === 'string' && known.has(i.id) ? 'update' : 'new';
        let id = action === 'update' ? i.id : undefined;
        // Backstop dedup: a "new" item whose category+title already exists becomes
        // an update to that item, so re-stated facts refresh the old entry rather
        // than piling up a near-duplicate.
        if (action === 'new') {
          const match = byTitle.get(`${norm(i.category)}::${norm(i.title)}`);
          if (match) {
            action = 'update';
            id = match;
          }
        }
        return { ...i, action, id } as MemoryProposal;
      });
    return { items };
  }

  // Persist confirmed items chosen by the user. A proposal flagged as an update
  // overwrites the existing item it names; everything else is inserted as new.
  saveItems(proposals: MemoryProposal[]): MemoryItem[] {
    if (!Array.isArray(proposals)) throw new Error('items must be an array.');
    const profileId = this.requireActiveProfile();
    const now = new Date().toISOString();
    const saved: MemoryItem[] = [];
    for (const p of proposals) {
      const confidence = p.confidence === 'confirmed' ? 'confirmed' : 'unverified';
      if (p.action === 'update' && p.id && memoryRepository.getItem(p.id)) {
        saved.push(this.updateItem(p.id, { title: p.title, content: p.content, confidence }));
      } else {
        const [item] = memoryRepository.insertItems([{
          id: randomUUID(),
          category: p.category,
          title: p.title,
          content: p.content,
          confidence,
          source_message_id: p.sourceMessageId ?? null,
          created_at: now,
          updated_at: now
        }], profileId);
        saved.push(item);
      }
    }
    return saved;
  }

  listItems(): MemoryItem[] {
    return memoryRepository.listItems(this.requireActiveProfile());
  }

  updateItem(id: string, fields: Partial<Pick<MemoryItem, 'title' | 'content' | 'confidence'>>): MemoryItem {
    const existing = memoryRepository.getItem(id);
    if (!existing) throw new Error('Memory item not found.');
    memoryRepository.updateItem(
      id,
      fields.title ?? existing.title,
      fields.content ?? existing.content,
      fields.confidence ?? existing.confidence,
      new Date().toISOString()
    );
    return memoryRepository.getItem(id) as MemoryItem;
  }

  deleteItem(id: string): void {
    memoryRepository.deleteItem(id);
  }

  // A plain-text rendering of a profile's memory, for resume prompts. The caller
  // passes the session's own profile so each resume builds from its profile's
  // memory. '' when empty.
  buildMemoryText(profileId: string): string {
    const items = memoryRepository.listItems(profileId);
    if (items.length === 0) return '';
    return items
      .map((i) => `[${i.category}] (${i.confidence}) ${i.title}: ${i.content}`)
      .join('\n');
  }

  // Like buildMemoryText but tags each item with its id, so the extraction step
  // can target an existing item for an update. '' when empty.
  private buildMemoryTextWithIds(profileId: string): string {
    const items = memoryRepository.listItems(profileId);
    if (items.length === 0) return '';
    return items
      .map((i) => `(id: ${i.id}) [${i.category}] (${i.confidence}) ${i.title}: ${i.content}`)
      .join('\n');
  }
}

export const memoryService = new MemoryService();
