import { useState } from 'react';
import type { FormEvent } from 'react';
import { Cat } from 'lucide-react';

// First-run modal: shown when no profile exists yet. A profile is required
// before any memory or resume work, so there's no way to dismiss this without
// creating one.
export default function ProfileSetup({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(clean);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="greetingMark profileSetupMark"><Cat size={26} /></div>
        <h3>Create your first profile</h3>
        <p className="modalSub">
          A profile keeps its own memory and resumes. You can add more later and switch between them in Settings.
        </p>
        {error && <p className="error">{error}</p>}
        <form className="profileSetupForm" onSubmit={submit}>
          <input
            autoFocus
            value={name}
            placeholder="Profile name (e.g. your name)"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="pillBtn" disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
