import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { api } from '../api.ts';
import type { PromptView } from '../../shared/types.ts';

// Manage every system prompt the app sends to the model. Each prompt can be
// edited and saved (overriding the built-in default) or reset back to default.
// Dynamic data is injected at runtime via {{tokens}} — keep those in place.
export default function PromptsSettings() {
  const [prompts, setPrompts] = useState<PromptView[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPrompts().then(load).catch((e: Error) => setError(e.message));
  }, []);

  function load(list: PromptView[]): void {
    setPrompts(list);
    setDraft(Object.fromEntries(list.map((p) => [p.key, p.value])));
  }

  function apply(updated: PromptView): void {
    setPrompts((ps) => ps.map((p) => (p.key === updated.key ? updated : p)));
    setDraft((d) => ({ ...d, [updated.key]: updated.value }));
  }

  async function save(key: string): Promise<void> {
    setBusyKey(key);
    setError('');
    setSavedKey(null);
    try {
      apply(await api.savePrompt(key, draft[key] ?? ''));
      setSavedKey(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(key: string): Promise<void> {
    setBusyKey(key);
    setError('');
    setSavedKey(null);
    try {
      apply(await api.resetPrompt(key));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="promptsPane">
      <p className="hint">
        These are the exact system prompts Sox uses. Edit one to change how the AI behaves; the
        <code> {'{{tokens}}'} </code> are filled in with live data (your personality, memory, the job)
        — leave them in place. Saving the unchanged default keeps it marked as default.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="promptsList">
        {prompts.map((p) => {
          const dirty = (draft[p.key] ?? '') !== p.value;
          const working = busyKey === p.key;
          return (
            <section key={p.key} className="promptCard">
              <div className="promptHead">
                <div>
                  <strong>{p.label}</strong>
                  <p className="promptDesc">{p.description}</p>
                </div>
                <span className={`tag ${p.isDefault ? 'unverified' : 'update'}`}>
                  {p.isDefault ? 'Default' : 'Customized'}
                </span>
              </div>

              {p.tokens.length > 0 && (
                <div className="promptTokens">
                  {p.tokens.map((t) => <code key={t}>{t}</code>)}
                </div>
              )}

              <textarea
                className="promptText"
                rows={Math.min(18, Math.max(4, (draft[p.key] ?? '').split('\n').length + 1))}
                value={draft[p.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                spellCheck={false}
              />

              <div className="promptActions">
                {savedKey === p.key && !dirty && <span className="ok">Saved.</span>}
                <button className="ghost" onClick={() => reset(p.key)} disabled={working || p.isDefault}>
                  <RotateCcw size={14} /> Reset to default
                </button>
                <button onClick={() => save(p.key)} disabled={working || !dirty}>
                  <Save size={14} /> Save
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
