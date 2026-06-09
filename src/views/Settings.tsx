import { useEffect, useState } from 'react';
import { FileText, KeyRound, Save, SlidersHorizontal, UserRound } from 'lucide-react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import PromptsSettings from '../components/PromptsSettings.tsx';
import ProfilesSettings from '../components/ProfilesSettings.tsx';
import type { Profile, SettingsView } from '../../shared/types.ts';

type Tab = 'general' | 'profiles' | 'prompts';

interface SettingsProps {
  onChange?: (s: SettingsView) => void;
  profiles: Profile[];
  activeProfileId: string | null;
  onCreateProfile: (name: string) => Promise<void>;
  onActivateProfile: (id: string) => Promise<void>;
  onRenameProfile: (id: string, name: string) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
}

// Settings: General (OpenRouter key + models), Profiles (separate memories), and
// Prompts (editable system prompts). The API key lives on the server; the
// frontend only ever learns whether one is set.
export default function Settings({
  onChange,
  profiles,
  activeProfileId,
  onCreateProfile,
  onActivateProfile,
  onRenameProfile,
  onDeleteProfile
}: SettingsProps) {
  // Profiles first — it's the most-used setting (switching whose memory drives resumes).
  const [tab, setTab] = useState<Tab>('profiles');
  const [status, setStatus] = useState<SettingsView>({ hasApiKey: false, model: '', model2: '' });
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [model2, setModel2] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSettings().then((s) => {
      setStatus(s);
      setModel(s.model);
      setModel2(s.model2);
    });
  }, []);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    setSaved(false);
    try {
      const body: { model: string; model2: string; apiKey?: string } = { model, model2 };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const updated = await api.saveSettings(body);
      setStatus(updated);
      setApiKey('');
      setSaved(true);
      onChange?.(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const subtitle =
    tab === 'general'
      ? 'Your API key is stored on the server, never sent back to the browser.'
      : tab === 'profiles'
        ? 'Each profile keeps its own memory and resumes. Switch the active one here.'
        : 'Edit the system prompts that drive Sox. Changes take effect immediately.';

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle">Settings</div>
          <span className="paneSub">{subtitle}</span>
        </div>
      </header>

      <div className="settingsLayout">
        <nav className="settingsNav">
          <button className={tab === 'profiles' ? 'on' : ''} onClick={() => setTab('profiles')}>
            <UserRound size={16} /> Profiles
          </button>
          <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>
            <SlidersHorizontal size={16} /> General
          </button>
          <button className={tab === 'prompts' ? 'on' : ''} onClick={() => setTab('prompts')}>
            <FileText size={16} /> Prompts
          </button>
        </nav>

        <div className="settingsContent">
        {tab === 'profiles' ? (
          <ProfilesSettings
            profiles={profiles}
            activeProfileId={activeProfileId}
            onCreate={onCreateProfile}
            onActivate={onActivateProfile}
            onRename={onRenameProfile}
            onDelete={onDeleteProfile}
          />
        ) : tab === 'general' ? (
          <form className="settingsForm" onSubmit={save}>
            {error && <p className="error">{error}</p>}
            {saved && <p className="ok">Saved.</p>}

            <label>
              OpenRouter API key
              <div className="keyField">
                <KeyRound size={15} />
                <input
                  type="password"
                  value={apiKey}
                  placeholder={status.hasApiKey ? '•••••••• (set — leave blank to keep)' : 'sk-or-…'}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <small className={status.hasApiKey ? 'ok' : 'warn'}>
                {status.hasApiKey ? 'A key is configured.' : 'No key configured — AI features are disabled.'}
              </small>
            </label>

            <label>
              Primary model
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="anthropic/claude-3.7-sonnet" />
              <small>Used for chat, reading the job, and analysis.</small>
            </label>

            <label>
              Advanced model <span className="optional">(optional)</span>
              <input value={model2} onChange={(e) => setModel2(e.target.value)} placeholder="Leave blank to use the primary model" />
              <small>A higher-accuracy model used to write the resume and to extract &amp; update memory. Blank → uses the primary model.</small>
            </label>

            <button type="submit"><Save size={15} /> Save settings</button>
          </form>
        ) : (
          <PromptsSettings />
        )}
        </div>
      </div>
    </div>
  );
}
