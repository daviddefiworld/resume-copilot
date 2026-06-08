import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import Sidebar from './components/Sidebar.tsx';
import type { View } from './components/Sidebar.tsx';
import CopilotChat from './views/CopilotChat.tsx';
import MemoryProfile from './views/MemoryProfile.tsx';
import SessionView from './views/SessionView.tsx';
import Settings from './views/Settings.tsx';
import Home from './views/Home.tsx';
import type { ResumeSession, Template } from '../shared/types.ts';

// App shell: a fixed ChatGPT-style sidebar plus the active pane. The shell owns
// the session list and the high-level selection (which view, which session).
export default function App() {
  const [view, setView] = useState<View>('home');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ResumeSession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [memoryKey, setMemoryKey] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(true);

  const loadSessions = useCallback(async () => {
    setSessions(await api.getSessions());
  }, []);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => {});
    api.getSettings().then((s) => setHasApiKey(s.hasApiKey)).catch(() => {});
    loadSessions().catch(() => {});
  }, [loadSessions]);

  async function newResume(): Promise<void> {
    const session = await api.createSession({});
    await loadSessions();
    setActiveSessionId(session.id);
  }

  function selectView(next: View): void {
    setActiveSessionId(null);
    setView(next);
  }

  function selectSession(id: string): void {
    setActiveSessionId(id);
  }

  async function deleteSession(id: string): Promise<void> {
    await api.deleteSession(id);
    if (activeSessionId === id) setActiveSessionId(null);
    await loadSessions();
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        hasApiKey={hasApiKey}
        onNewResume={newResume}
        onSelectView={selectView}
        onSelectSession={selectSession}
        onDeleteSession={deleteSession}
      />

      <main className="main">
        {activeSessionId ? (
          <SessionView
            key={activeSessionId}
            sessionId={activeSessionId}
            templates={templates}
            onSessionChanged={loadSessions}
          />
        ) : view === 'copilot' ? (
          <CopilotChat onMemorySaved={() => setMemoryKey((k) => k + 1)} />
        ) : view === 'memory' ? (
          <MemoryProfile refreshKey={memoryKey} />
        ) : view === 'settings' ? (
          <Settings onChange={(s) => setHasApiKey(s.hasApiKey)} />
        ) : (
          <Home onNewResume={newResume} onCopilot={() => selectView('copilot')} />
        )}
      </main>
    </div>
  );
}
