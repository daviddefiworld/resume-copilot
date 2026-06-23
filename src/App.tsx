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
import type { Personality, Profile, ProfilesView, ResumeSession, SessionSuggestion, Template } from '../shared/types.ts';

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
  // The first message of a brand-new job hunt, handed to its SessionView to send
  // (scoped to the session it belongs to) so the message renders immediately.
  const [pendingMessage, setPendingMessage] = useState<{ sessionId: string; content: string } | null>(null);
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
  // The copilot personality drives the brand mark, chat avatar, and name. Owned
  // here so changing it in Settings updates the whole shell live.
  const [personas, setPersonas] = useState<Personality[]>([]);
  const [personaId, setPersonaId] = useState<string>('');

  const loadSessions = useCallback(async () => {
    setSessions(await api.getSessions());
  }, []);

  const loadPersona = useCallback(async () => {
    const [cfg, people] = await Promise.all([api.getCopilot(), api.getPersonalities()]);
    setPersonas(people);
    setPersonaId(cfg.personalityId);
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
    loadPersona().catch(() => {});
  }, [loadSessions, loadPersona]);

  // Pick up a job-hunt handoff started from the Lazybidder dashboard's "Apply with
  // Copilot" button. The dashboard hits this desktop app's fixed-port bridge, which
  // parks the intent and raises this window; here we poll for it (and re-check the
  // moment the window regains focus, right after it's raised) and open a workspace
  // seeded with the kickoff message — the same path as starting a hunt by hand.
  useEffect(() => {
    // Don't consume handoffs until a profile exists to own the session; the intent
    // stays parked server-side until then.
    if (needProfile || !activeProfileId) return;
    let cancelled = false;

    const checkOnce = async (): Promise<void> => {
      if (cancelled) return;
      try {
        // Consume-on-read on the server makes concurrent polls safe: only one gets
        // the intent, so the focus check and the interval can't double-open it.
        const { intent } = await api.takeIntegrationIntent();
        if (intent && !cancelled) await startResume(intent.message);
      } catch {
        /* bridge poll is best-effort */
      }
    };

    const interval = window.setInterval(() => void checkOnce(), 2500);
    const onFocus = (): void => void checkOnce();
    window.addEventListener('focus', onFocus);
    void checkOnce();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
    // startResume is recreated each render; we deliberately keep this poller
    // subscribed across renders and re-subscribe only when the profile/persona
    // change (the values startResume seeds a session with).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needProfile, activeProfileId, personaId]);

  const activePersona = personas.find((p) => p.id === personaId) ?? personas[0] ?? null;

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

  // Leaving the copilot chat for a job-hunt session (new or existing): fold any
  // un-reflected tail of the conversation into the character's memory now, so a
  // short tail below the regular every-6 reflection cadence isn't lost. Only fires
  // when the copilot chat is the pane on screen; fire-and-forget so it never
  // blocks the navigation it rides on.
  function flushCopilotMemoryOnLeave(): void {
    if (view === 'copilot' && !activeSessionId && !isStartingResume) {
      void api.flushCharacterReflection().catch(() => {});
    }
  }

  async function newResume(): Promise<void> {
    flushCopilotMemoryOnLeave();
    setActiveSessionId(null);
    setView('home');
    setIsStartingResume(true);
  }

  async function startResume(content: string): Promise<void> {
    // Open the workspace (no AI yet) and jump straight into it, handing the first
    // message to the session. SessionView shows it immediately and Sox replies
    // there — instead of blocking on the agent here and landing on a finished
    // thread where the message only appears alongside the reply.
    const session = await api.createSession({ initial_message: content, personality_id: personaId || undefined });
    await loadSessions();
    setPendingMessage({ sessionId: session.id, content });
    setIsStartingResume(false);
    setActiveSessionId(session.id);
  }

  // Spin up a job-hunt session straight from the companion chat: Sox offered it
  // (a ```session block → action card), the user clicked, and we open a workspace
  // pre-named and seeded with the kickoff message it wrote. Same path as
  // startResume, but with the title Sox chose and from the copilot pane (so its
  // un-reflected tail is flushed to memory on the way out).
  async function startJobHuntFromCopilot(suggestion: SessionSuggestion): Promise<void> {
    flushCopilotMemoryOnLeave();
    // Carry the concrete job/company identity the copilot already gathered into the
    // new session, so it opens with the target known instead of re-deriving it from
    // the kickoff prose. A posting/company link rides along in the company notes.
    const session = await api.createSession({
      title: suggestion.title,
      initial_message: suggestion.kickoff,
      personality_id: personaId || undefined,
      company_name: suggestion.company,
      job_title: suggestion.role,
      location: suggestion.location,
      job_description: suggestion.jobDescription,
      company_notes: suggestion.link ? `Job posting: ${suggestion.link}` : undefined
    });
    await loadSessions();
    setPendingMessage({ sessionId: session.id, content: suggestion.kickoff });
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
    flushCopilotMemoryOnLeave();
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
        persona={activePersona}
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
            personas={personas}
            onSessionChanged={loadSessions}
            onOpenAts={openAts}
            initialMessage={pendingMessage?.sessionId === activeSessionId ? pendingMessage.content : null}
            onInitialMessageSent={() => setPendingMessage(null)}
          />
        ) : isStartingResume ? (
          <NewResumeStart onSend={startResume} />
        ) : view === 'copilot' ? (
          <CopilotChat
            key={activeProfileId ?? 'none'}
            profileId={activeProfileId}
            persona={activePersona}
            onMemorySaved={() => setMemoryKey((k) => k + 1)}
            onStartSession={startJobHuntFromCopilot}
          />
        ) : view === 'memory' ? (
          <MemoryProfile key={activeProfileId ?? 'none'} refreshKey={memoryKey} />
        ) : view === 'ats' ? (
          <ATSAnalyzer key={atsKey} prefill={atsPrefill} />
        ) : view === 'settings' ? (
          <Settings
            onChange={(s) => setHasApiKey(s.hasApiKey)}
            personas={personas}
            activePersonaId={personaId}
            onPersonaChange={loadPersona}
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
      <h1>What job are we hunting?</h1>
      <p>Paste the job description or describe the role. Your copilot opens a workspace for this one
        job — research, outreach, and a tailored resume all live here.</p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle">New job hunt</div>
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
        placeholder="Tell your copilot about the job..."
        emptyState={emptyState}
        disclaimer="Your first message opens the job-hunt workspace and names it automatically."
      />
    </div>
  );
}
