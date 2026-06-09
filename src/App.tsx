import { useCallback, useEffect, useState } from 'react';
import { Cat } from 'lucide-react';
import { api } from './api.ts';
import Chat from './components/Chat.tsx';
import Sidebar from './components/Sidebar.tsx';
import type { View } from './components/Sidebar.tsx';
import CopilotChat from './views/CopilotChat.tsx';
import MemoryProfile from './views/MemoryProfile.tsx';
import SessionView from './views/SessionView.tsx';
import Settings from './views/Settings.tsx';
import Home from './views/Home.tsx';
import ATSAnalyzer from './views/ATSAnalyzer.tsx';
import ProfileSetup from './components/ProfileSetup.tsx';
import type { Profile, ProfilesView, ResumeSession, Template } from '../shared/types.ts';

export interface ATSPrefill {
  resume: string;
  jobDescription: string;
}

// App shell: a fixed ChatGPT-style sidebar plus the active pane. The shell owns
// the session list and the high-level selection (which view, which session).
export default function App() {
  const [view, setView] = useState<View>('home');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStartingResume, setIsStartingResume] = useState(false);
  const [sessions, setSessions] = useState<ResumeSession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [memoryKey, setMemoryKey] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(true);
  // ATS analyzer: optional prefill when deep-linked from a resume, plus a key
  // that remounts the view so its form re-initializes from the new prefill.
  const [atsPrefill, setAtsPrefill] = useState<ATSPrefill | null>(null);
  const [atsKey, setAtsKey] = useState(0);
  // Profiles: each has its own isolated memory + resume sessions. `needProfile`
  // gates the first-run modal that asks for a name when none exist yet.
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [needProfile, setNeedProfile] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessions(await api.getSessions());
  }, []);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => {});
    api.getSettings().then((s) => setHasApiKey(s.hasApiKey)).catch(() => {});
    api.getProfiles().then((p) => {
      setProfiles(p.profiles);
      setActiveProfileId(p.activeId);
      setNeedProfile(p.profiles.length === 0);
    }).catch(() => {});
    loadSessions().catch(() => {});
  }, [loadSessions]);

  // Sync local profile state after any change. When the active profile changes
  // (`switched`), reset the session view and refresh sessions + memory so the
  // app shows the newly active profile's world.
  function applyProfiles(next: ProfilesView, switched: boolean): void {
    setProfiles(next.profiles);
    setActiveProfileId(next.activeId);
    setNeedProfile(next.profiles.length === 0);
    if (switched) {
      setActiveSessionId(null);
      setIsStartingResume(false);
      setMemoryKey((k) => k + 1);
      void loadSessions();
    }
  }

  async function createProfile(name: string): Promise<void> {
    applyProfiles(await api.createProfile(name), true);
  }

  async function activateProfile(id: string): Promise<void> {
    if (id === activeProfileId) return;
    applyProfiles(await api.activateProfile(id), true);
  }

  async function renameProfile(id: string, name: string): Promise<void> {
    await api.renameProfile(id, name);
    applyProfiles(await api.getProfiles(), false);
  }

  async function removeProfile(id: string): Promise<void> {
    applyProfiles(await api.deleteProfile(id), true);
  }

  async function newResume(): Promise<void> {
    setActiveSessionId(null);
    setView('home');
    setIsStartingResume(true);
  }

  async function startResume(content: string): Promise<void> {
    const session = await api.createSession({ initial_message: content });
    await api.sendSessionMessage(session.id, content);
    await loadSessions();
    setIsStartingResume(false);
    setActiveSessionId(session.id);
  }

  function selectView(next: View): void {
    setActiveSessionId(null);
    setIsStartingResume(false);
    // Opening the analyzer from the sidebar starts it blank.
    if (next === 'ats') {
      setAtsPrefill(null);
      setAtsKey((k) => k + 1);
    }
    setView(next);
  }

  // Deep-link into the analyzer with a resume + job description prefilled (from
  // the "Check ATS score" button on a resume).
  function openAts(prefill: ATSPrefill): void {
    setActiveSessionId(null);
    setIsStartingResume(false);
    setAtsPrefill(prefill);
    setAtsKey((k) => k + 1);
    setView('ats');
  }

  function selectSession(id: string): void {
    setIsStartingResume(false);
    setActiveSessionId(id);
  }

  async function renameSession(id: string, title: string): Promise<void> {
    await api.updateSession(id, { title });
    await loadSessions();
  }

  async function deleteSession(id: string): Promise<void> {
    await api.deleteSession(id);
    if (activeSessionId === id) setActiveSessionId(null);
    await loadSessions();
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        hasApiKey={hasApiKey}
        activeProfileName={activeProfile?.name ?? null}
        onNewResume={newResume}
        onSelectView={selectView}
        onSelectSession={selectSession}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
      />

      <main className="main">
        {activeSessionId ? (
          <SessionView
            key={activeSessionId}
            sessionId={activeSessionId}
            templates={templates}
            onSessionChanged={loadSessions}
            onOpenAts={openAts}
          />
        ) : isStartingResume ? (
          <NewResumeStart onSend={startResume} />
        ) : view === 'copilot' ? (
          <CopilotChat key={activeProfileId ?? 'none'} onMemorySaved={() => setMemoryKey((k) => k + 1)} />
        ) : view === 'memory' ? (
          <MemoryProfile key={activeProfileId ?? 'none'} refreshKey={memoryKey} />
        ) : view === 'ats' ? (
          <ATSAnalyzer key={atsKey} prefill={atsPrefill} />
        ) : view === 'settings' ? (
          <Settings
            onChange={(s) => setHasApiKey(s.hasApiKey)}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onCreateProfile={createProfile}
            onActivateProfile={activateProfile}
            onRenameProfile={renameProfile}
            onDeleteProfile={removeProfile}
          />
        ) : (
          <Home onNewResume={newResume} onCopilot={() => selectView('copilot')} />
        )}
      </main>

      {needProfile && <ProfileSetup onCreate={createProfile} />}
    </div>
  );
}

function NewResumeStart({ onSend }: { onSend: (content: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(content: string): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await onSend(content);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const emptyState = (
    <div className="greeting">
      <div className="greetingMark"><Cat size={28} /></div>
      <h1>What are we applying to?</h1>
      <p>Paste the job description or describe the role. Sox will create the resume chat from this first message.</p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle">New resume</div>
          <span className="paneSub">Start with the role, company, or job description</span>
        </div>
      </header>
      {error && <p className="error sidePad">{error}</p>}
      <Chat
        messages={[]}
        onSend={send}
        busy={busy}
        assistantName="Sox"
        assistantAvatar={<Cat size={16} />}
        placeholder="Message Sox about the job..."
        emptyState={emptyState}
        disclaimer="Your first message creates the resume chat and names it automatically."
      />
    </div>
  );
}
