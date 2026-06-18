import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../api.ts';
import Markdown from './Markdown.tsx';
import { usePanelWidth } from '../hooks/usePanelWidth.ts';
import type { SessionDocument } from '../../shared/types.ts';

interface WorkspaceProps {
  sessionId: string;
  documents: SessionDocument[];
  // The live "Next Steps" plan body pushed mid-turn; when set, it is shown as a
  // live checklist at the top and the persisted Next Steps card is hidden to avoid
  // a stale duplicate. null when the agent isn't actively rewriting the plan.
  livePlan?: string | null;
  // Reload the documents in the parent after a manual edit/create/delete.
  onChanged: () => void;
  onClose: () => void;
}

interface DraftFields {
  title: string;
  content: string;
}

const NEXT_STEPS_TITLE = 'Next Steps';
const isNextSteps = (title: string): boolean => title.trim().toLowerCase() === NEXT_STEPS_TITLE.toLowerCase();

type PlanStatus = 'pending' | 'doing' | 'done' | 'approval' | 'other';
interface ParsedPlan { phase?: string; now?: string; items: { status: PlanStatus; text: string }[]; }

const STATUS_GLYPH: Record<PlanStatus, string> = { pending: '○', doing: '◐', done: '✓', approval: '!', other: '•' };

// Parse the "Next Steps" checklist convention (Phase:/Now:/- [ ]/[~]/[x]/[!]) into
// structured items. Returns null when the body isn't in checklist shape, so the
// caller can fall back to plain Markdown.
function parsePlan(body: string): ParsedPlan | null {
  const mark: Record<string, PlanStatus> = { ' ': 'pending', '~': 'doing', x: 'done', '!': 'approval' };
  let phase: string | undefined;
  let now: string | undefined;
  const items: { status: PlanStatus; text: string }[] = [];
  for (const line of body.split('\n')) {
    const item = line.match(/^\s*-\s*\[([ ~xX!])\]\s+(.+)$/);
    if (item) { items.push({ status: mark[item[1].toLowerCase()] ?? 'other', text: item[2].trim() }); continue; }
    const p = line.match(/^\s*Phase:\s*(.+)$/i); if (p) { phase = p[1].trim(); continue; }
    const n = line.match(/^\s*Now:\s*(.+)$/i); if (n) { now = n[1].trim(); }
  }
  return items.length ? { phase, now, items } : null;
}

// Render a plan body as a checklist; falls back to Markdown when it isn't one.
function PlanChecklist({ body, live }: { body: string; live?: boolean }) {
  const plan = parsePlan(body);
  if (!plan) return <Markdown>{body}</Markdown>;
  return (
    <div className="planList">
      {plan.phase && <div className="planPhase">{plan.phase}{live && <span className="planLive">live</span>}</div>}
      {plan.now && <div className="planNow">{plan.now}</div>}
      <ul className="planItems">
        {plan.items.map((it, i) => (
          <li key={i} className={`planItem ${it.status}`}>
            <span className="planBox">{STATUS_GLYPH[it.status]}</span>
            <span className="planText">{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Short, locale-aware timestamp for a document's last update.
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// The job-hunt workspace: the living documents Sox keeps for this session
// (company, role, key people, outreach, next steps — it decides which). Each
// card folds; the user can also hand-edit, add, or delete documents. Sox updates
// them as it works, so this stays a real, current workspace, not a transcript.
export default function Workspace({ sessionId, documents, livePlan, onChanged, onClose }: WorkspaceProps) {
  // Collapsed-card ids. Default is expanded, so new artifacts are visible; the
  // user folds the ones they don't want open.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFields>({ title: '', content: '' });
  const [adding, setAdding] = useState(false);
  const [newDoc, setNewDoc] = useState<DraftFields>({ title: '', content: '' });
  const [error, setError] = useState('');
  // Drag-resizable from the left edge, like the resume panel; width persists.
  const { width, isDragging, onResizeStart, reset } = usePanelWidth('workspacePanelWidth', 360, 280);

  // While the agent is actively rewriting the plan, show it live and hide the
  // (now-stale) persisted Next Steps card.
  const live = livePlan && livePlan.trim() ? livePlan : null;

  function toggle(id: string): void {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }

  function startEdit(doc: SessionDocument): void {
    setEditing(doc.id);
    setDraft({ title: doc.title, content: doc.content });
    setCollapsed((c) => ({ ...c, [doc.id]: false }));
  }

  async function saveEdit(id: string): Promise<void> {
    setError('');
    try {
      await api.updateDocument(id, { title: draft.title, content: draft.content });
      setEditing(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string): Promise<void> {
    setError('');
    try {
      await api.deleteDocument(id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addDoc(): Promise<void> {
    const title = newDoc.title.trim();
    if (!title) return;
    setError('');
    try {
      await api.createDocument(sessionId, { title, content: newDoc.content });
      setAdding(false);
      setNewDoc({ title: '', content: '' });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside className="workspaceSide" style={{ width }}>
      {isDragging && <div className="dragShield" />}
      <div
        className="resumeResizer"
        onMouseDown={onResizeStart}
        onDoubleClick={reset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace panel"
      />
      <header className="resumeSideHead">
        <strong>Workspace</strong>
        <div className="canvasControls">
          <button className="ghost" onClick={() => setAdding((a) => !a)} aria-label="Add document"><Plus size={16} /></button>
          <button className="ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
      </header>

      <div className="workspaceBody">
        {error && <p className="error">{error}</p>}

        {live && (
          <article className="docCard live">
            <div className="docCardHead">
              <span className="docToggle static">
                <FileText size={14} />
                <span className="docTitle">Next Steps</span>
                <span className="planLive">live</span>
              </span>
            </div>
            <div className="docCardBody">
              <PlanChecklist body={live} live />
            </div>
          </article>
        )}

        {adding && (
          <article className="docCard">
            <div className="memoryEdit">
              <input
                placeholder="Document title (e.g. Company Brief)"
                value={newDoc.title}
                autoFocus
                onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
              />
              <textarea
                placeholder="Markdown content…"
                rows={4}
                value={newDoc.content}
                onChange={(e) => setNewDoc({ ...newDoc, content: e.target.value })}
              />
              <div className="cardActions">
                <button className="ghost" onClick={() => { setAdding(false); setNewDoc({ title: '', content: '' }); }}><X size={14} /></button>
                <button onClick={addDoc} disabled={!newDoc.title.trim()}><Save size={14} /> Add</button>
              </div>
            </div>
          </article>
        )}

        {documents.length === 0 && !adding && (
          <p className="hint">
            No documents yet. As you chat about the job, Sox builds a workspace here —
            company brief, role detail, key people, outreach, next steps.
          </p>
        )}

        {documents.map((doc) => {
          // The live card above is the current Next Steps; skip the stale persisted one.
          if (live && isNextSteps(doc.title)) return null;
          const isOpen = !collapsed[doc.id];
          const isEditing = editing === doc.id;
          return (
            <article key={doc.id} className="docCard">
              <div className="docCardHead">
                <button className="docToggle" onClick={() => toggle(doc.id)} aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <FileText size={14} />
                  <span className="docTitle">{doc.title}</span>
                </button>
                <div className="cardActions">
                  <button className="ghost" onClick={() => startEdit(doc)} aria-label="Edit"><Pencil size={13} /></button>
                  <button className="ghost danger" onClick={() => remove(doc.id)} aria-label="Delete"><Trash2 size={13} /></button>
                </div>
              </div>

              {isOpen && (
                isEditing ? (
                  <div className="memoryEdit">
                    <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    <textarea value={draft.content} rows={8} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
                    <div className="cardActions">
                      <button className="ghost" onClick={() => setEditing(null)}><X size={14} /></button>
                      <button onClick={() => saveEdit(doc.id)}><Save size={14} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="docCardBody">
                    <div className="docMeta">Updated {when(doc.updated_at)}</div>
                    {!doc.content.trim()
                      ? <p className="hint">Empty.</p>
                      : isNextSteps(doc.title)
                        ? <PlanChecklist body={doc.content} />
                        : <Markdown>{doc.content}</Markdown>}
                  </div>
                )
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
