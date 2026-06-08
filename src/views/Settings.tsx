import { useEffect, useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import PromptsSettings from '../components/PromptsSettings.tsx';
import type { SettingsView } from '../../shared/types.ts';

type Tab = 'general' | 'prompts';

// Settings: a General tab (OpenRouter key + model slugs) and a Prompts tab for
// editing the system prompts. The API key lives on the server; the frontend only
// ever learns whether one is set.
export default function Settings({ onChange }: { onChange?: (s: SettingsView) => void }) {
  const [tab, setTab] = useState<Tab>('general');
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

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle">Settings</div>
          <span className="paneSub">
            {tab === 'general'
              ? 'Your API key is stored on the server, never sent back to the browser.'
              : 'Edit the system prompts that drive Sox. Changes take effect immediately.'}
          </span>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === 'general' ? 'on' : ''}`} onClick={() => setTab('general')}>General</button>
          <button className={`tab ${tab === 'prompts' ? 'on' : ''}`} onClick={() => setTab('prompts')}>Prompts</button>
        </div>
      </header>

      <div className="paneScroll">
        {tab === 'general' ? (
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
  );
}
