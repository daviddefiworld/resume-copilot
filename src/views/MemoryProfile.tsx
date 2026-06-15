import { useEffect, useState } from 'react';
import { Pencil, Save, Trash2, X } from 'lucide-react';
import { api } from '../api.ts';
import type { MemoryItemFields } from '../api.ts';
import type { Confidence, MemoryItem } from '../../shared/types.ts';

// "Your story" — view and manually edit the long-term memory the copilot has
// saved about the user, grouped by category.
export default function MemoryProfile({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryItemFields>({});
  const [error, setError] = useState('');

  function load(): void {
    api.getMemoryItems().then(setItems).catch((e: Error) => setError(e.message));
  }

  useEffect(load, [refreshKey]);

  async function remove(id: string): Promise<void> {
    await api.deleteMemoryItem(id);
    load();
  }

  function startEdit(item: MemoryItem): void {
    setEditing(item.id);
    setDraft({ title: item.title, content: item.content, confidence: item.confidence });
  }

  async function saveEdit(id: string): Promise<void> {
    await api.updateMemoryItem(id, draft);
    setEditing(null);
    load();
  }

  const groups = items.reduce<Record<string, MemoryItem[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle">Your story</div>
          <span className="paneSub">What your copilot knows about you. Edit or delete anything that's off.</span>
        </div>
      </header>

      <div className="paneScroll">
        <div className="centerColumn">
          {error && <p className="error">{error}</p>}
          {items.length === 0 && <p className="hint">Nothing here yet. Chat with your copilot to build it.</p>}

          {Object.entries(groups).map(([category, list]) => (
            <section key={category} className="memoryGroup">
              <h3>{category.replace(/_/g, ' ')}</h3>
              {list.map((item) => (
                <article key={item.id} className="memoryCard">
                  {editing === item.id ? (
                    <div className="memoryEdit">
                      <input value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                      <textarea value={draft.content ?? ''} rows={3}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
                      <select value={draft.confidence ?? 'unverified'}
                        onChange={(e) => setDraft({ ...draft, confidence: e.target.value as Confidence })}>
                        <option value="confirmed">confirmed</option>
                        <option value="unverified">unverified</option>
                      </select>
                      <div className="cardActions">
                        <button className="ghost" onClick={() => setEditing(null)}><X size={14} /></button>
                        <button onClick={() => saveEdit(item.id)}><Save size={14} /> Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="memoryCardTop">
                        <strong>{item.title}</strong>
                        <span className={`tag ${item.confidence}`}>{item.confidence}</span>
                      </div>
                      <p>{item.content}</p>
                      <div className="cardActions">
                        <button className="ghost" onClick={() => startEdit(item)}><Pencil size={14} /></button>
                        <button className="ghost danger" onClick={() => remove(item.id)}><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
