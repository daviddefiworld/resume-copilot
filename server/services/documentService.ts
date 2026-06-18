import { randomUUID } from 'crypto';
import { documentRepository } from '../repositories/documentRepository.ts';
import type { LocalTool } from './agentRunner.ts';
import type { OpenAITool, SessionDocument } from '../../shared/types.ts';

interface DocumentFields {
  title?: string;
  content?: string;
}

// The one durable plan document per session. A fixed title so set_next_steps and
// nextStepsContext always resolve the same doc (findByTitle is case-insensitive).
const NEXT_STEPS_TITLE = 'Next Steps';

// Cap on how much of the plan is injected into the prompt each turn, mirroring the
// agent's TOOL_RECAP_CAP, so the plan can't grow the per-turn context without bound.
const NEXT_STEPS_INJECT_CAP = 4000;

// Checklist markers for the rendered plan, matching the convention the playbook
// prescribes. '[!]' flags an action that needs the user's explicit approval.
const STATUS_MARK: Record<string, string> = {
  pending: '[ ]',
  doing: '[~]',
  done: '[x]',
  approval: '[!]'
};

// Owns the per-session workspace: the living documents Sox keeps for a job hunt
// (company brief, role detail, key people, outreach log, next steps — the agent
// decides which). Two faces: a plain CRUD surface for the UI, and a set of
// `LocalTool`s the agent calls mid-conversation to maintain the workspace itself.
class DocumentService {
  list(sessionId: string): SessionDocument[] {
    return documentRepository.list(sessionId);
  }

  get(id: string): SessionDocument {
    const doc = documentRepository.get(id);
    if (!doc) throw new Error('Document not found.');
    return doc;
  }

  create(sessionId: string, fields: DocumentFields): SessionDocument {
    const title = String(fields.title || '').trim();
    if (!title) throw new Error('A document title is required.');
    const now = new Date().toISOString();
    const doc: SessionDocument = {
      id: randomUUID(),
      session_id: sessionId,
      title,
      content: String(fields.content ?? ''),
      created_at: now,
      updated_at: now
    };
    documentRepository.insert(doc);
    return doc;
  }

  update(id: string, fields: DocumentFields): SessionDocument {
    const existing = this.get(id);
    const title = fields.title !== undefined ? String(fields.title).trim() || existing.title : existing.title;
    const content = fields.content !== undefined ? String(fields.content) : existing.content;
    documentRepository.update(id, title, content, new Date().toISOString());
    return this.get(id);
  }

  delete(id: string): void {
    documentRepository.delete(id);
  }

  // Create a document, or replace the body of the one already titled `title`
  // (case-insensitive) in this session. The agent's main "remember this" verb.
  upsertByTitle(sessionId: string, title: string, content: string): SessionDocument {
    const clean = title.trim();
    if (!clean) throw new Error('A document title is required.');
    const existing = documentRepository.findByTitle(sessionId, clean);
    if (existing) {
      documentRepository.update(existing.id, clean, content, new Date().toISOString());
      return this.get(existing.id);
    }
    return this.create(sessionId, { title: clean, content });
  }

  // Append a section to a document (creating it if absent), so logging a new
  // contact or a sent email doesn't require rewriting the whole document.
  appendByTitle(sessionId: string, title: string, content: string): SessionDocument {
    const clean = title.trim();
    if (!clean) throw new Error('A document title is required.');
    // The plan keeps a structured, bounded shape — it is owned by set_next_steps,
    // never grown by free-form appends.
    if (clean.toLowerCase() === NEXT_STEPS_TITLE.toLowerCase()) {
      throw new Error('Use set_next_steps to update the "Next Steps" plan, not append_to_document.');
    }
    const existing = documentRepository.findByTitle(sessionId, clean);
    if (!existing) return this.create(sessionId, { title: clean, content });
    const merged = existing.content.trim() ? `${existing.content.trim()}\n\n${content}` : content;
    documentRepository.update(existing.id, clean, merged, new Date().toISOString());
    return this.get(existing.id);
  }

  // A compact snapshot of the workspace injected into the session chat as a
  // system message, so Sox always knows which documents exist and keeps them
  // current. Full contents stay out of the per-turn prompt (the agent reads them
  // on demand via list_documents) to keep the context small.
  promptContext(sessionId: string): string {
    const docs = this.list(sessionId);
    if (docs.length === 0) {
      return (
        'WORKSPACE — this job-hunt session has no documents yet. You maintain a real workspace for it. ' +
        'As you learn or produce anything worth keeping, create/maintain living documents with your ' +
        'document tools (upsert_document, append_to_document): e.g. a company brief, role detail, key ' +
        'people, an outreach log, and concrete next steps. Never lose a fact — company, role, names, ' +
        'emails, links, dates all belong in the right document. You decide which documents to keep.'
      );
    }
    const lines = docs.map((d) => `- "${d.title}" (updated ${d.updated_at.slice(0, 10)}, ${d.content.length} chars)`);
    return (
      'WORKSPACE — living documents you maintain for this session (keep them current with your document tools):\n' +
      lines.join('\n') +
      '\nUpdate the relevant document whenever you learn or produce something worth keeping; ' +
      'call list_documents to read their full contents when you need detail. Keep the "Next Steps" plan ' +
      'current with set_next_steps.'
    );
  }

  // The session's durable plan document (full body), injected into the chat each
  // turn so Sox always sees its own committed plan without a list_documents
  // round-trip. '' when there is no plan yet (the prompt then nudges Sox to make one).
  nextStepsContext(sessionId: string): string {
    const doc = documentRepository.findByTitle(sessionId, NEXT_STEPS_TITLE);
    const content = doc && doc.content.trim() ? doc.content : '';
    return content.length > NEXT_STEPS_INJECT_CAP ? `${content.slice(0, NEXT_STEPS_INJECT_CAP)}\n…(truncated)` : content;
  }

  // The agent-facing tools for one session. Bound to the sessionId so the agent
  // never has to pass (or guess) it. Returned to the agent runner as LocalTools.
  // `onPlanChange` (when given) fires with the freshly-saved "Next Steps" body
  // each time set_next_steps runs, so the UI can update the plan live mid-turn.
  tools(sessionId: string, onPlanChange?: (body: string) => void): LocalTool[] {
    const asObject = (raw: unknown): Record<string, unknown> =>
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

    return [
      {
        definition: defineTool(
          'upsert_document',
          'Create a workspace document, or fully replace the one with the same title. Use for a company ' +
            'brief, role detail, key-people notes, an outreach draft, a next-steps plan, etc. Titles are ' +
            'free-form — you decide what documents this job hunt needs.',
          {
            title: { type: 'string', description: 'Document title, e.g. "Company Brief" or "Key People".' },
            content: { type: 'string', description: 'Full Markdown content for the document.' }
          },
          ['title', 'content']
        ),
        run: async (raw) => {
          const a = asObject(raw);
          const title = String(a.title ?? '').trim();
          if (!title) return { text: 'A document title is required.', ok: false };
          const doc = this.upsertByTitle(sessionId, title, String(a.content ?? ''));
          return { text: `Saved document "${doc.title}".`, ok: true };
        }
      },
      {
        definition: defineTool(
          'append_to_document',
          'Append a section to a workspace document, creating it if it does not exist. Use to log a new ' +
            'contact, a sent or drafted email, or an added note without rewriting the whole document.',
          {
            title: { type: 'string', description: 'Title of the document to append to (created if missing).' },
            content: { type: 'string', description: 'Markdown to append as a new section.' }
          },
          ['title', 'content']
        ),
        run: async (raw) => {
          const a = asObject(raw);
          const title = String(a.title ?? '').trim();
          const content = String(a.content ?? '');
          if (!title) return { text: 'A document title is required.', ok: false };
          if (!content.trim()) return { text: 'Nothing to append.', ok: false };
          const doc = this.appendByTitle(sessionId, title, content);
          return { text: `Appended to "${doc.title}".`, ok: true };
        }
      },
      {
        definition: defineTool(
          'list_documents',
          "List this session's workspace documents with their full current contents.",
          {},
          []
        ),
        run: async () => {
          const docs = this.list(sessionId);
          if (docs.length === 0) return { text: 'No documents yet.', ok: true };
          const body = docs
            .map((d) => `### ${d.title}\n(updated ${d.updated_at.slice(0, 10)})\n\n${d.content || '(empty)'}`)
            .join('\n\n---\n\n');
          return { text: body, ok: true };
        }
      },
      {
        definition: defineTool(
          'delete_document',
          'Delete a workspace document by title. Use sparingly — only when a document is truly obsolete.',
          { title: { type: 'string', description: 'Title of the document to delete.' } },
          ['title']
        ),
        run: async (raw) => {
          const a = asObject(raw);
          const title = String(a.title ?? '').trim();
          const existing = documentRepository.findByTitle(sessionId, title);
          if (!existing) return { text: `No document titled "${title}".`, ok: false };
          this.delete(existing.id);
          return { text: `Deleted "${existing.title}".`, ok: true };
        }
      },
      {
        // The durable plan. A dedicated tool (not a raw upsert) so the "Next Steps"
        // document keeps a consistent, parseable shape and always lands on the one
        // canonical title.
        definition: {
          type: 'function',
          function: {
            name: 'set_next_steps',
            description:
              'Create or replace the session\'s "Next Steps" plan — the durable checklist that drives ' +
              'the hunt across turns. Provide phase, the single current focus (now), and the ordered ' +
              'items; mark any action that needs the user\'s explicit approval with status "approval".',
            parameters: {
              type: 'object',
              properties: {
                phase: { type: 'string', description: 'Current stage, e.g. "3. Role / JD analysis".' },
                now: { type: 'string', description: 'The single current focus, one line.' },
                items: {
                  type: 'array',
                  description: 'The plan items in priority order.',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string', description: 'The action.' },
                      status: {
                        type: 'string',
                        enum: ['pending', 'doing', 'done', 'approval'],
                        description: 'pending, doing, done, or approval (needs the user\'s explicit go-ahead before you run it).'
                      }
                    },
                    required: ['text', 'status']
                  }
                },
                body: { type: 'string', description: 'Optional: full Markdown plan to store verbatim instead of phase/now/items.' }
              },
              required: []
            }
          }
        },
        run: async (raw) => {
          const a = asObject(raw);
          let body = typeof a.body === 'string' ? a.body.trim() : '';
          if (!body) {
            const lines: string[] = [];
            if (a.phase) lines.push(`Phase: ${String(a.phase)}`);
            if (a.now) lines.push(`Now: ${String(a.now)}`);
            if (lines.length) lines.push('');
            for (const entry of Array.isArray(a.items) ? a.items : []) {
              const item = asObject(entry);
              const text = String(item.text ?? '').trim();
              if (!text) continue;
              lines.push(`- ${STATUS_MARK[String(item.status)] ?? '[ ]'} ${text}`);
            }
            body = lines.join('\n').trim();
          }
          if (!body) return { text: 'Nothing to write to the plan.', ok: false };
          const doc = this.upsertByTitle(sessionId, NEXT_STEPS_TITLE, body);
          // The saved body is authoritative (a synchronous SQLite write), so the
          // live UI never shows a stale read.
          onPlanChange?.(doc.content);
          return { text: `Updated "${doc.title}".`, ok: true };
        }
      }
    ];
  }
}

// Build an OpenAI/OpenRouter function-tool definition from a flat property map.
function defineTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string }>,
  required: string[]
): OpenAITool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

export const documentService = new DocumentService();
