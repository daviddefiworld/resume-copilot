import { randomUUID } from 'crypto';
import { memoryRepository } from '../repositories/memoryRepository.ts';
import { openRouter } from './openRouterService.ts';
import { settingsService } from './settingsService.ts';
import { getPersonality } from '../data/personalities.ts';
import { memoryInterviewSystem, memoryExtractionPrompt } from './prompts.ts';
import type { ChatRole, MemoryItem, MemoryMessage, MemoryProposal } from '../../shared/types.ts';

interface ExtractionResult {
  items?: MemoryProposal[];
}

// Long-term career memory: the memory chat transcript and confirmed memory
// items. This is the ONLY place long-term memory is written. Generates ids and
// timestamps, runs AI extraction, and delegates persistence to the repository.
class MemoryService {
  listMessages(): MemoryMessage[] {
    return memoryRepository.listMessages();
  }

  // Append the user's message, generate the agent's reply, store and return it.
  async sendMessage(content: string, personalityId: string): Promise<MemoryMessage> {
    const text = String(content || '').trim();
    if (!text) throw new Error('Message is required.');

    this.append('user', text);

    const personality = getPersonality(personalityId);
    const history = this.listMessages().map((m) => ({ role: m.role, content: m.content }));
    const reply = await openRouter.chat([
      { role: 'system', content: memoryInterviewSystem(personality) },
      ...history
    ]);

    return this.append('assistant', reply);
  }

  private append(role: ChatRole, content: string): MemoryMessage {
    const message: MemoryMessage = { id: randomUUID(), role, content, created_at: new Date().toISOString() };
    memoryRepository.appendMessage(message);
    return message;
  }

  // Extract candidate memory items from the recent transcript, reconciled against
  // what is already saved so existing items get updated instead of duplicated.
  // Runs on the higher-accuracy model. Returns proposals for the user to confirm
  // — nothing is saved here.
  async proposeUpdates(): Promise<{ items: MemoryProposal[] }> {
    const recent = this.listMessages().slice(-30);
    if (recent.length === 0) return { items: [] };
    const transcript = recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const existing = this.buildMemoryTextWithIds();
    const result = await openRouter.json<ExtractionResult>(
      memoryExtractionPrompt(transcript, existing),
      { model: settingsService.advancedModel() }
    );
    const known = new Set(this.listItems().map((i) => i.id));
    const items = (Array.isArray(result.items) ? result.items : [])
      .filter((i) => i && i.category && i.title && i.content)
      .map((i) => {
        // Trust an update only when it names a memory id we actually have.
        const isUpdate = i.action === 'update' && typeof i.id === 'string' && known.has(i.id);
        return { ...i, action: isUpdate ? 'update' : 'new', id: isUpdate ? i.id : undefined } as MemoryProposal;
      });
    return { items };
  }

  // Persist confirmed items chosen by the user. A proposal flagged as an update
  // overwrites the existing item it names; everything else is inserted as new.
  saveItems(proposals: MemoryProposal[]): MemoryItem[] {
    if (!Array.isArray(proposals)) throw new Error('items must be an array.');
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
        }]);
        saved.push(item);
      }
    }
    return saved;
  }

  listItems(): MemoryItem[] {
    return memoryRepository.listItems();
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

  // A plain-text rendering of memory, for resume prompts. '' when empty.
  buildMemoryText(): string {
    const items = this.listItems();
    if (items.length === 0) return '';
    return items
      .map((i) => `[${i.category}] (${i.confidence}) ${i.title}: ${i.content}`)
      .join('\n');
  }

  // Like buildMemoryText but tags each item with its id, so the extraction step
  // can target an existing item for an update. '' when empty.
  private buildMemoryTextWithIds(): string {
    const items = this.listItems();
    if (items.length === 0) return '';
    return items
      .map((i) => `(id: ${i.id}) [${i.category}] (${i.confidence}) ${i.title}: ${i.content}`)
      .join('\n');
  }
}

export const memoryService = new MemoryService();
