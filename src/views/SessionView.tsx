import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Cat, PanelRightOpen, Wand2 } from 'lucide-react';
import { api } from '../api.ts';
import Chat from '../components/Chat.tsx';
import ResumePanel from '../components/ResumePanel.tsx';
import type { ResumeMessage, ResumeSession, ResumeVersion, Template } from '../../shared/types.ts';

interface SessionViewProps {
  sessionId: string;
  templates: Template[];
  onSessionChanged: () => void;
}

interface ResumeVersionState {
  list: ResumeVersion[];
  selectedId: string | null;
}

// One resume session as a plain conversation. The user gives the job in chat —
// no forms. Sox asks for what it needs; the resume artifact opens in a side
// panel once a draft exists.
export default function SessionView({ sessionId, templates, onSessionChanged }: SessionViewProps) {
  const [session, setSession] = useState<ResumeSession | null>(null);
  const [messages, setMessages] = useState<ResumeMessage[]>([]);
  const [versions, setVersions] = useState<ResumeVersionState>({ list: [], selectedId: null });
  const [showResume, setShowResume] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api.getSession(sessionId).then(setSession).catch((e: Error) => setError(e.message));
    api.getSessionMessages(sessionId).then(setMessages).catch(() => {});
    api.getVersions(sessionId).then((list) => {
      setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
      if (list.length > 0) setShowResume(true);
    }).catch(() => {});
  }, [sessionId]);

  async function reloadVersions(): Promise<void> {
    const list = await api.getVersions(sessionId);
    setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
  }

  async function refreshSession(): Promise<void> {
    setSession(await api.getSession(sessionId));
    onSessionChanged();
  }

  async function saveTitle(): Promise<void> {
    if (!session) return;
    const title = titleDraft.trim() || 'Untitled role';
    setIsEditingTitle(false);
    setSession(await api.updateSession(sessionId, { title }));
    onSessionChanged();
  }

  function editTitle(): void {
    if (!session) return;
    setTitleDraft(session.title || 'Untitled role');
    setIsEditingTitle(true);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') void saveTitle();
    if (event.key === 'Escape') setIsEditingTitle(false);
  }

  async function send(content: string): Promise<void> {
    const priorVersions = versions.list.length;
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, session_id: sessionId, role: 'user', content, created_at: '' }]);
    setBusy(true);
    setError('');
    try {
      await api.sendSessionMessage(sessionId, content);
      setMessages(await api.getSessionMessages(sessionId));
      // A chat turn can edit the resume (canvas mode) — refresh the document and
      // open the canvas if a new version appeared.
      const list = await api.getVersions(sessionId);
      setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
      if (list.length > priorVersions) setShowResume(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function draft(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      await api.generateDraft(sessionId);
      setMessages(await api.getSessionMessages(sessionId)); // the draft exchange now lives in the chat
      await reloadVersions();
      await refreshSession();
      setShowResume(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeTemplate(templateId: string): Promise<void> {
    if (!versions.selectedId) return;
    const updated = await api.setTemplate(versions.selectedId, templateId);
    setVersions((v) => ({ ...v, list: v.list.map((x) => (x.id === updated.id ? updated : x)) }));
  }

  if (!session) {
    return <div className="pane"><p className="hint sidePad">Loading…</p></div>;
  }

  const subtitle = [session.company_name, session.location].filter(Boolean).join(' · ') || 'Tell Sox about the job';

  const actions = (
    <>
      <button className="chip" onClick={draft} disabled={busy}><Wand2 size={14} /> Generate draft</button>
      {versions.list.length > 0 && (
        <button className="chip" onClick={() => setShowResume(true)}><PanelRightOpen size={14} /> View resume</button>
      )}
    </>
  );

  const emptyState = (
    <div className="greeting">
      <div className="greetingMark"><Cat size={28} /></div>
      <h1>What are we applying to?</h1>
      <p>Paste the job description to start. I'll ask which company it's for, then
        line it all up against your memory and draft a resume that fits.</p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          {isEditingTitle ? (
            <input
              className="titleInput"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={onTitleKeyDown}
            />
          ) : (
            <div className="paneTitle editableTitle" onDoubleClick={editTitle}>
              {session.title || 'New resume'}
            </div>
          )}
          <span className="paneSub">{subtitle}</span>
        </div>
      </header>

      {error && <p className="error sidePad">{error}</p>}

      <div className="sessionBody">
        <div className="sessionMain">
          <Chat
            messages={messages}
            onSend={send}
            busy={busy}
            assistantName="Sox"
            assistantAvatar={<Cat size={16} />}
            placeholder="Paste the job description, or ask Sox to tweak the resume…"
            emptyState={emptyState}
            actions={actions}
            disclaimer="Sox builds on your memory and fills in realistic detail to fit the job — review before sending."
          />
        </div>

        {showResume && (
          <ResumePanel
            selected={versions.list.find((v) => v.id === versions.selectedId) ?? null}
            templates={templates}
            onChangeTemplate={changeTemplate}
            onClose={() => setShowResume(false)}
          />
        )}
      </div>
    </div>
  );
}
