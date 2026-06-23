import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FolderOpen, PanelRightOpen, Wand2 } from 'lucide-react';
import { api, isStopped } from '../api.ts';
import { foldActivity } from '../agentActivity.ts';
import Chat from '../components/Chat.tsx';
import ResumePanel from '../components/ResumePanel.tsx';
import Workspace from '../components/Workspace.tsx';
import { personaVisual, PersonaMark } from '../personaVisual.tsx';
import { resumeToText } from '../resumeText.ts';
import type { ATSPrefill } from '../App.tsx';
import type { AgentActivity, Personality, ResumeMessage, ResumeSession, ResumeVersion, SessionDocument, Template } from '../../shared/types.ts';

interface SessionViewProps {
  sessionId: string;
  templates: Template[];
  // The copilot personalities, so the session shows its own character's avatar.
  personas: Personality[];
  onSessionChanged: () => void;
  onOpenAts: (prefill: ATSPrefill) => void;
  // The first message of a freshly created session, not yet sent. When present,
  // SessionView renders it optimistically and sends it on mount.
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}

interface ResumeVersionState {
  list: ResumeVersion[];
  selectedId: string | null;
}

// Remembers the resume format the user last chose, so the next draft starts there.
const TEMPLATE_KEY = 'resumeTemplate';

// One resume session as a plain conversation. The user gives the job in chat —
// no forms. Sox asks for what it needs; the resume artifact opens in a side
// panel once a draft exists.
export default function SessionView({ sessionId, templates, personas, onSessionChanged, onOpenAts, initialMessage, onInitialMessageSent }: SessionViewProps) {
  const [session, setSession] = useState<ResumeSession | null>(null);
  const [messages, setMessages] = useState<ResumeMessage[]>([]);
  const [versions, setVersions] = useState<ResumeVersionState>({ list: [], selectedId: null });
  const [documents, setDocuments] = useState<SessionDocument[]>([]);
  const [showResume, setShowResume] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // The reply currently streaming in, shown live until the saved message lands.
  const [streaming, setStreaming] = useState('');
  // The live "Next Steps" plan body pushed mid-turn (null = show the persisted doc).
  const [livePlan, setLivePlan] = useState<string | null>(null);
  // The agent's live working process for the in-flight turn (thinking + each tool).
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [error, setError] = useState('');
  // Guards the first-message send against StrictMode's double-invoked mount
  // effect, which would otherwise send (and persist) the message twice.
  const sentInitial = useRef(false);
  // Open the Workspace once per turn when the live plan first arrives, so the live
  // checklist is visible — without fighting the user if they then close the panel.
  const autoOpenedPlan = useRef(false);
  // The in-flight turn's abort handle, so the Stop button can cancel it.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setError('');
    api.getSession(sessionId).then(setSession).catch((e: Error) => setError(e.message));
    // Brand-new session: the first message hasn't been sent yet. Send it here so
    // it renders immediately (optimistically) and Sox's reply lands in the thread
    // — rather than the user staring at a blank pane while the agent works.
    if (initialMessage && !sentInitial.current) {
      sentInitial.current = true;
      onInitialMessageSent?.();
      void send(initialMessage);
      return;
    }
    api.getSessionMessages(sessionId).then(setMessages).catch(() => {});
    api.getVersions(sessionId).then((list) => {
      setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
      // Don't auto-open the resume panel on load — it's reachable via the
      // "View resume" action when the user actually wants it.
    }).catch(() => {});
    api.getDocuments(sessionId).then((docs) => {
      setDocuments(docs);
      if (docs.length > 0) setShowWorkspace(true);
    }).catch(() => {});
  }, [sessionId]);

  async function reloadVersions(): Promise<void> {
    const list = await api.getVersions(sessionId);
    setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
  }

  async function reloadDocuments(): Promise<SessionDocument[]> {
    const docs = await api.getDocuments(sessionId);
    setDocuments(docs);
    return docs;
  }

  async function refreshSession(): Promise<void> {
    setSession(await api.getSession(sessionId));
    onSessionChanged();
  }

  async function saveTitle(): Promise<void> {
    if (!session) return;
    const title = titleDraft.trim() || 'Untitled job';
    try {
      const updated = await api.updateSession(sessionId, { title });
      setSession(updated);
      setIsEditingTitle(false); // close only on success, so a failure keeps the editor open to retry
      onSessionChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function editTitle(): void {
    if (!session) return;
    setTitleDraft(session.title || 'Untitled job');
    setIsEditingTitle(true);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') void saveTitle();
    if (event.key === 'Escape') setIsEditingTitle(false);
  }

  async function send(content: string): Promise<void> {
    const priorVersions = versions.list.length;
    const priorDocs = documents.length;
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, session_id: sessionId, role: 'user', content, created_at: '' }]);
    setBusy(true);
    setStreaming('');
    setLivePlan(null);
    setActivity([]);
    autoOpenedPlan.current = false;
    setError('');
    const ac = new AbortController();
    abortRef.current = ac;
    // Steers that couldn't fold into this turn (came in too late, or a canvas turn):
    // collected here and re-sent as a fresh turn once this one settles, so they get answered.
    const deferred: string[] = [];
    try {
      await api.sendSessionMessageStream(sessionId, content, (text) => setStreaming((prev) => prev + text), {
        onPlan: (body) => {
          setLivePlan(body);
          // Reveal the Workspace the first time a live plan appears this turn (the
          // panel is closed by default), but don't reopen it if the user closes it.
          if (body.trim() && !autoOpenedPlan.current) {
            autoOpenedPlan.current = true;
            setShowWorkspace(true);
          }
        },
        onStatus: (s) => setActivity((prev) => foldActivity(prev, s)),
        onSteerAck: (text, isDeferred) => { if (isDeferred) deferred.push(text); }
      }, ac.signal);
      // Commit the persisted reply AND tear down the streaming/live state in the same
      // synchronous block, so the live bubble never lingers as a duplicate while
      // the follow-up refreshes (versions/documents) run on later round-trips.
      const msgs = await api.getSessionMessages(sessionId);
      setStreaming('');
      setLivePlan(null);
      setActivity([]);
      setBusy(false);
      setMessages(msgs);
      // A chat turn can edit the resume (canvas mode) — refresh and open the canvas
      // if a new version appeared.
      const list = await api.getVersions(sessionId);
      setVersions({ list, selectedId: list[list.length - 1]?.id ?? null });
      if (list.length > priorVersions) setShowResume(true);
      // A turn can also create/update workspace documents — refresh them and open
      // the workspace if Sox added one.
      const docs = await reloadDocuments();
      if (docs.length > priorDocs) setShowWorkspace(true);
      // A turn can also rename the session — once the chat reveals the company, the
      // session is named after it — so refresh the header title and the sidebar.
      await refreshSession();
      // Answer any steer that was deferred to the next turn by running it now.
      if (deferred.length) await send(deferred.join('\n\n'));
    } catch (e) {
      // A user stop saved no reply — resync to the persisted user message (and any
      // workspace docs the agent wrote before being stopped), no error shown.
      if (isStopped(e)) {
        try {
          setMessages(await api.getSessionMessages(sessionId));
          await reloadDocuments();
        } catch { /* keep optimistic */ }
      } else {
        setError((e as Error).message);
      }
    } finally {
      // Safety net for the error path; idempotent on the success path above.
      abortRef.current = null;
      setBusy(false);
      setStreaming('');
      setLivePlan(null);
      setActivity([]);
    }
  }

  // Stop the in-flight turn: aborts the request, which closes the SSE stream and
  // cancels the run server-side so nothing finishes (or bills) in the background.
  function stop(): void {
    abortRef.current?.abort();
  }

  // Steer the in-flight turn: queue the message onto the running agent (it folds in
  // at its next step). If no run is accepting it (race / not busy), fall back to a
  // fresh normal turn so the message is never lost.
  async function steer(content: string): Promise<void> {
    const tmpId = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tmpId, session_id: sessionId, role: 'user', content, created_at: '' }]);
    try {
      await api.steerSession(sessionId, content);
    } catch (e) {
      // Drop the optimistic bubble; on a genuine 409 (no run is accepting) send it as
      // a fresh normal turn. Any other failure is surfaced, not silently re-sent.
      setMessages((prev) => prev.filter((m) => m.id !== tmpId));
      if ((e as { status?: number }).status === 409) {
        await send(content);
      } else {
        setError((e as Error).message);
      }
    }
  }

  async function draft(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      // Reuse the format the user last picked so a new resume opens in their
      // preferred template instead of always defaulting to Classic ATS.
      await api.generateDraft(sessionId, localStorage.getItem(TEMPLATE_KEY) ?? undefined);
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
    localStorage.setItem(TEMPLATE_KEY, templateId); // remembered for the next resume build
    setError('');
    try {
      const updated = await api.setTemplate(versions.selectedId, templateId);
      setVersions((v) => ({ ...v, list: v.list.map((x) => (x.id === updated.id ? updated : x)) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Send the current resume + this job into the ATS analyzer, prefilled.
  function checkAts(): void {
    const version = versions.list.find((v) => v.id === versions.selectedId);
    if (!version || !session) return;
    onOpenAts({ resume: resumeToText(version.content), jobDescription: session.job_description || '' });
  }

  if (!session) {
    return <div className="pane"><p className="hint sidePad">Loading…</p></div>;
  }

  // The session's own copilot character, so its avatar/name match the chat the
  // job hunt was started from (falls back to the default until personas load).
  const persona = personas.find((p) => p.id === session.personality_id) ?? null;
  const personaName = persona?.name ?? 'Sox';
  const personaGradient = personaVisual(persona).gradient;

  // The session is named after the company once the chat finds it, so the
  // subtitle carries the role + location rather than repeating the company.
  const subtitle = [session.job_title, session.location].filter(Boolean).join(' · ') || `Tell ${personaName} about the job`;

  const actions = (
    <>
      <button className="chip" onClick={draft} disabled={busy}><Wand2 size={14} /> Generate draft</button>
      <button className="chip" onClick={() => setShowWorkspace((s) => !s)}>
        <FolderOpen size={14} /> Workspace{documents.length > 0 ? ` (${documents.length})` : ''}
      </button>
      {versions.list.length > 0 && (
        <button className="chip" onClick={() => setShowResume(true)}><PanelRightOpen size={14} /> View resume</button>
      )}
    </>
  );

  const emptyState = (
    <div className="greeting">
      <PersonaMark persona={persona} size={30} className="greetingMark" />
      <h1>What are we applying to?</h1>
      <p>Paste the job description to start. I'll ask which company it's for, then
        line it all up against your memory and draft a resume that fits.</p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader centered">
        <div className="paneHeaderInner">
          <div className="sessionHeadRow">
            <PersonaMark persona={persona} size={18} className="paneTitleMark" zoomable />
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
                  {session.title || 'New job hunt'}
                </div>
              )}
              <span className="paneSub">{subtitle}</span>
            </div>
          </div>
        </div>
      </header>

      {error && <p className="error sidePad">{error}</p>}

      <div className="sessionBody">
        <div className="sessionMain">
          <Chat
            messages={messages}
            onSend={send}
            onSteer={steer}
            onStop={stop}
            activity={activity}
            busy={busy}
            streamingText={streaming}
            assistantName={personaName}
            assistantAvatar={<PersonaMark persona={persona} size={20} bare />}
            personaGradient={personaGradient}
            placeholder="Paste the job description, or ask Sox to tweak the resume…"
            emptyState={emptyState}
            actions={actions}
            disclaimer="Sox builds on your memory and fills in realistic detail to fit the job — review before sending."
          />
        </div>

        {showWorkspace && (
          <Workspace
            sessionId={sessionId}
            documents={documents}
            livePlan={busy ? livePlan : null}
            onChanged={() => { void reloadDocuments(); }}
            onClose={() => setShowWorkspace(false)}
          />
        )}

        {showResume && (
          <ResumePanel
            selected={versions.list.find((v) => v.id === versions.selectedId) ?? null}
            templates={templates}
            onChangeTemplate={changeTemplate}
            onClose={() => setShowResume(false)}
            onCheckAts={checkAts}
          />
        )}
      </div>
    </div>
  );
}
