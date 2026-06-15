import { useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { Brain, Check, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import type { CharacterMemoryView, Personality } from '../../shared/types.ts';
import { PERSONA_ACCENTS, PERSONA_ICON_KEYS, PERSONA_ICONS, personaVisual } from '../personaVisual.tsx';
import ConfirmDialog from './ConfirmDialog.tsx';

// Settings → Personality. Browse the fictional-AI copilots on the left; the
// selected one opens in a detail panel on the right with its traits and what it
// remembers about you. Any personality — built-in (like Sox) or your own — can
// be edited; built-ins keep a "Reset to default" so edits are never permanent.
// Personality changes the copilot's voice and style only — the honesty
// guardrails are universal, so a custom personality can never be made to
// fabricate or manipulate.
//
// The personality list and the active selection are owned by the app shell and
// passed in, so this view always reflects the live copilot — selecting,
// creating, editing, or deleting refreshes that shared state via `onChanged`.
const BLANK = {
  name: '',
  description: '',
  tone: '',
  critiqueIntensity: 'medium',
  reasoningStyle: '',
  resumeBias: '',
  mission: '',
  icon: 'bot',
  accent: PERSONA_ACCENTS[4]
};

type PersonaForm = typeof BLANK;
type EditState = { mode: 'create' } | { mode: 'edit'; id: string; builtin: boolean };

function toForm(p: Personality): PersonaForm {
  return {
    name: p.name ?? '',
    description: p.description ?? '',
    tone: p.tone ?? '',
    critiqueIntensity: p.critiqueIntensity ?? 'medium',
    reasoningStyle: p.reasoningStyle ?? '',
    resumeBias: p.resumeBias ?? '',
    mission: p.mission ?? '',
    icon: p.icon ?? 'bot',
    accent: p.accent ?? PERSONA_ACCENTS[4]
  };
}

interface PersonalitySettingsProps {
  personas: Personality[];
  activeId: string;
  onChanged: () => Promise<void>;
}

export default function PersonalitySettings({ personas, activeId, onChanged }: PersonalitySettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Which personality is open in the detail panel (just viewing — separate from
  // which one is the active copilot). Empty falls back to the active one.
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [form, setForm] = useState<PersonaForm>({ ...BLANK });
  const [pendingDelete, setPendingDelete] = useState<Personality | null>(null);
  // What the selected character remembers about the user (read-only, evolves as
  // you chat). Loaded for whichever personality is open in the panel.
  const [memory, setMemory] = useState<CharacterMemoryView | null>(null);
  const [pendingForget, setPendingForget] = useState(false);

  const active = personas.find((p) => p.id === activeId) ?? null;
  const selected = personas.find((p) => p.id === selectedId) ?? active;

  useEffect(() => {
    const id = selected?.id;
    if (!id) {
      setMemory(null);
      return;
    }
    let cancelled = false;
    api
      .getCharacterMemory(id)
      .then((m) => {
        if (!cancelled) setMemory(m);
      })
      .catch(() => {
        if (!cancelled) setMemory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function view(id: string): void {
    setSelectedId(id);
    setEditing(null);
  }

  async function activate(): Promise<void> {
    if (!selected || selected.id === activeId || busy) return;
    await run(async () => {
      await api.setCopilotPersonality(selected.id);
      await onChanged();
    });
  }

  function startCreate(): void {
    setForm({ ...BLANK });
    setEditing({ mode: 'create' });
  }

  function startEdit(): void {
    if (!selected) return;
    setForm(toForm(selected));
    setEditing({ mode: 'edit', id: selected.id, builtin: Boolean(selected.builtin) });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!form.name.trim() || !editing) return;
    await run(async () => {
      if (editing.mode === 'edit') {
        const updated = await api.updatePersonality(editing.id, form);
        await onChanged();
        setSelectedId(updated.id);
      } else {
        const created = await api.createPersonality(form);
        await api.setCopilotPersonality(created.id);
        await onChanged();
        setSelectedId(created.id);
      }
      setEditing(null);
    });
  }

  async function resetToDefault(): Promise<void> {
    if (!editing || editing.mode !== 'edit') return;
    await run(async () => {
      const reset = await api.resetPersonality(editing.id);
      await onChanged();
      setForm(toForm(reset));
    });
  }

  async function confirmDelete(): Promise<void> {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    await run(async () => {
      await api.deletePersonality(target.id);
      if (selectedId === target.id) setSelectedId('');
      await onChanged();
    });
  }

  async function forgetMemory(): Promise<void> {
    setPendingForget(false);
    if (!selected) return;
    await run(async () => {
      await api.clearCharacterMemory(selected.id);
      setMemory(await api.getCharacterMemory(selected.id));
    });
  }

  return (
    <div className="personaPane">
      <p className="hint">
        Your copilot can take on the personality of a great fictional AI — or one you invent. This
        changes how it talks and pushes you, never the facts: every personality follows the same
        honesty rules.
      </p>

      {error && <p className="error">{error}</p>}

      {editing ? (
        renderForm()
      ) : (
        <div className="personaLayout">
          <div className="personaCol">
            <div className="personaGrid">
              {personas.map((p) => {
                const visual = personaVisual(p);
                return (
                  <div
                    key={p.id}
                    className={`personaCard ${p.id === selected?.id ? 'selected' : ''} ${p.id === activeId ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => view(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        view(p.id);
                      }
                    }}
                  >
                    <div className="personaTop">
                      <span className="personaMark" style={{ background: visual.gradient }}><visual.Icon size={17} /></span>
                      <strong>{p.name}</strong>
                      {p.id === activeId && <span className="tag confirmed"><Check size={11} /> Active</span>}
                      {!p.builtin && <span className="tag new">Custom</span>}
                    </div>
                    {p.inspiration && <small className="personaFrom">{p.inspiration}</small>}
                    <p>{p.description}</p>
                  </div>
                );
              })}
            </div>

            <button className="pillBtn ghost personaAddBtn" onClick={startCreate} disabled={busy}>
              <Plus size={15} /> Create a personality
            </button>
          </div>

          {selected && renderDetail(selected)}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          danger
          title="Delete personality?"
          message={`"${pendingDelete.name}" will be removed. If it's the active copilot, it falls back to Sox.`}
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingForget && selected && (
        <ConfirmDialog
          danger
          title={`Forget what ${selected.name} remembers?`}
          message={`${selected.name}'s evolving notes about you will be cleared. Your saved "Your story" memory is not affected.`}
          confirmLabel="Forget"
          onConfirm={() => void forgetMemory()}
          onCancel={() => setPendingForget(false)}
        />
      )}
    </div>
  );

  // ---- The right-hand detail panel: traits + this character's memory ----
  function renderDetail(p: Personality): ReactElement {
    const visual = personaVisual(p);
    const isActive = p.id === activeId;
    return (
      <aside className="personaDetail">
        <div className="personaDetailHead">
          <span className="personaMark lg" style={{ background: visual.gradient }}><visual.Icon size={22} /></span>
          <div className="personaDetailName">
            <strong>{p.name}</strong>
            {p.inspiration && <small className="personaFrom">{p.inspiration}</small>}
            <div className="personaDetailTags">
              {isActive && <span className="tag confirmed"><Check size={11} /> Active copilot</span>}
              <span className={`tag ${p.builtin ? '' : 'new'}`}>{p.builtin ? 'Built-in' : 'Custom'}</span>
            </div>
          </div>
        </div>

        <p className="personaDetailDesc">{p.description}</p>
        {p.mission && <p className="personaMission">“{p.mission}”</p>}

        <div className="personaDetailDials">
          <div><b>Tone</b><span>{p.tone}</span></div>
          <div><b>Critique</b><span>{p.critiqueIntensity}</span></div>
          {p.reasoningStyle && <div><b>Reasoning</b><span>{p.reasoningStyle}</span></div>}
          {p.resumeBias && <div><b>Resume bias</b><span>{p.resumeBias}</span></div>}
        </div>

        <div className="personaDetailActions">
          {!isActive && (
            <button className="pillBtn" disabled={busy} onClick={() => void activate()}>
              <Check size={15} /> Use as copilot
            </button>
          )}
          <button className="pillBtn ghost" disabled={busy} onClick={startEdit}>
            <Pencil size={15} /> Edit
          </button>
          {!p.builtin && (
            <button className="pillBtn ghost danger" disabled={busy} onClick={() => setPendingDelete(p)}>
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>

        <div className="characterMemory inPanel">
          <div className="characterMemoryHead">
            <h3><Brain size={16} /> What {p.name} remembers about you</h3>
            {memory?.notes?.trim() && (
              <button className="ghost danger" disabled={busy} onClick={() => setPendingForget(true)}>
                <Trash2 size={14} /> Forget
              </button>
            )}
          </div>
          <p className="hint">
            {p.name} keeps its own evolving sense of you — separate from “Your story”, built up
            automatically as you chat.
          </p>
          {memory?.notes?.trim() ? (
            <pre className="characterNotes">{memory.notes.trim()}</pre>
          ) : (
            <p className="characterNotesEmpty">
              Nothing yet — keep chatting and {p.name} will start to remember how you work and what
              you’re after.
            </p>
          )}
          {memory?.updatedAt && (
            <small className="characterMemoryMeta">Last updated {new Date(memory.updatedAt).toLocaleString()}</small>
          )}
        </div>
      </aside>
    );
  }

  // ---- Create / edit form (shared) ----
  function renderForm(): ReactElement {
    const isEdit = editing?.mode === 'edit';
    const builtin = editing?.mode === 'edit' && editing.builtin;
    const PreviewIcon = PERSONA_ICONS[form.icon] ?? PERSONA_ICONS.bot;
    return (
      <form className="settingsForm personaForm" onSubmit={submit}>
        <h3>
          {isEdit ? <><Pencil size={16} /> Edit {form.name.trim() || 'personality'}</> : <><Sparkles size={16} /> New personality</>}
        </h3>
        {builtin && (
          <p className="hint personaBuiltinNote">
            This is a built-in personality. Your edits are saved as an override — use “Reset to
            default” any time to restore the original.
          </p>
        )}

        <div className="personaPreviewRow">
          <span className="personaMark lg" style={{ background: personaVisual({ id: 'preview', name: form.name, icon: form.icon, accent: form.accent } as Personality).gradient }}>
            <PreviewIcon size={22} />
          </span>
          <div>
            <strong>{form.name.trim() || 'Your personality'}</strong>
            <small>Pick a look — this is how it shows up in the sidebar and chat.</small>
          </div>
        </div>

        <label>
          Icon
          <div className="iconPicker">
            {PERSONA_ICON_KEYS.map((key) => {
              const Icon = PERSONA_ICONS[key];
              return (
                <button
                  type="button"
                  key={key}
                  className={`iconSwatch ${form.icon === key ? 'on' : ''}`}
                  aria-label={key}
                  onClick={() => setForm({ ...form, icon: key })}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </label>

        <label>
          Colour
          <div className="colorPicker">
            {PERSONA_ACCENTS.map((c) => (
              <button
                type="button"
                key={c}
                className={`colorSwatch ${form.accent === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setForm({ ...form, accent: c })}
              />
            ))}
          </div>
        </label>

        <label>
          Name
          <input
            autoFocus
            value={form.name}
            placeholder="e.g. The Closer"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Description
          <input
            value={form.description}
            placeholder="One line on who this copilot is."
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Tone
          <input
            value={form.tone}
            placeholder="e.g. calm, dry, and exacting"
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </label>
        <label>
          Critique intensity
          <select value={form.critiqueIntensity} onChange={(e) => setForm({ ...form, critiqueIntensity: e.target.value })}>
            <option value="low">low — gentle and reassuring</option>
            <option value="medium">medium — honest but supportive</option>
            <option value="high">high — blunt, challenges everything</option>
          </select>
        </label>
        <label>
          Reasoning style
          <input
            value={form.reasoningStyle}
            placeholder="How it thinks through your hunt."
            onChange={(e) => setForm({ ...form, reasoningStyle: e.target.value })}
          />
        </label>
        <label>
          Resume bias <span className="optional">(how it writes)</span>
          <input
            value={form.resumeBias}
            placeholder="e.g. tight, evidence-only bullets"
            onChange={(e) => setForm({ ...form, resumeBias: e.target.value })}
          />
        </label>
        <label>
          Mission <span className="optional">(its pledge to you, in its voice)</span>
          <textarea
            value={form.mission}
            rows={2}
            placeholder="e.g. We're getting you a remote dev job you love — I'm with you the whole way."
            onChange={(e) => setForm({ ...form, mission: e.target.value })}
          />
        </label>

        <div className="personaFormActions">
          <button type="button" className="pillBtn ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          {builtin && (
            <button type="button" className="pillBtn ghost" onClick={() => void resetToDefault()} disabled={busy}>
              <RotateCcw size={15} /> Reset to default
            </button>
          )}
          <button type="submit" className="pillBtn" disabled={!form.name.trim() || busy}>
            <Check size={15} /> {isEdit ? 'Save changes' : 'Create & use'}
          </button>
        </div>
      </form>
    );
  }
}
