import { useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import type { Profile } from '../../shared/types.ts';
import ConfirmDialog from './ConfirmDialog.tsx';

interface ProfilesSettingsProps {
  profiles: Profile[];
  activeProfileId: string | null;
  onCreate: (name: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

// Manage profiles: create, switch (click a row), rename, and delete. Each
// profile owns a separate memory + resume set, so switching here changes the
// whole world the rest of the app works with.
export default function ProfilesSettings({
  profiles,
  activeProfileId,
  onCreate,
  onActivate,
  onRename,
  onDelete
}: ProfilesSettingsProps) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);

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

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await onCreate(name);
      setNewName('');
    });
  }

  function startEdit(profile: Profile): void {
    setEditingId(profile.id);
    setEditName(profile.name);
  }

  async function saveEdit(id: string): Promise<void> {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    await run(() => onRename(id, name));
  }

  async function confirmDelete(): Promise<void> {
    const profile = pendingDelete;
    setPendingDelete(null);
    if (!profile) return;
    await run(() => onDelete(profile.id));
  }

  return (
    <div className="profilesPane">
      <p className="hint">
        Each profile has its own memory and resumes. Switching profiles changes which memory Sox uses
        when generating a resume.
      </p>

      {error && <p className="error">{error}</p>}

      <form className="profileCreate" onSubmit={create}>
        <input value={newName} placeholder="New profile name" onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="pillBtn" disabled={!newName.trim() || busy}>
          <Plus size={15} /> Create profile
        </button>
      </form>

      <div className="profileList">
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const editing = editingId === profile.id;
          return (
            <div
              key={profile.id}
              className={`profileRow ${active ? 'active' : ''} ${!active && !editing ? 'switchable' : ''}`}
              role={active || editing ? undefined : 'button'}
              tabIndex={active || editing ? undefined : 0}
              title={active ? undefined : `Switch to ${profile.name}`}
              onClick={() => {
                if (active || editing || busy) return;
                void run(() => onActivate(profile.id));
              }}
              onKeyDown={(e) => {
                if (active || editing) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void run(() => onActivate(profile.id));
                }
              }}
            >
              <span className="profileRowIcon"><UserRound size={16} /></span>
              {editing ? (
                <input
                  className="profileEditInput"
                  autoFocus
                  value={editName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => void saveEdit(profile.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveEdit(profile.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="profileRowName">{profile.name}</span>
              )}
              {active && <span className="tag confirmed">Active</span>}
              <div className="profileRowActions" onClick={(e) => e.stopPropagation()}>
                <button className="ghost" onClick={() => startEdit(profile)} disabled={busy} aria-label="Rename">
                  <Pencil size={14} />
                </button>
                {profiles.length > 1 && (
                  <button className="ghost danger" onClick={() => setPendingDelete(profile)} disabled={busy} aria-label="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          danger
          title="Delete profile?"
          message={`"${pendingDelete.name}" and all of its memory and resumes will be permanently removed. This can't be undone.`}
          confirmLabel="Delete profile"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
