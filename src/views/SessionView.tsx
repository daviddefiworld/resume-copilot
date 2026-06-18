import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Cat, Check, FolderOpen, PanelRightOpen, Wand2 } from 'lucide-react';
import { api } from '../api.ts';
import Chat from '../components/Chat.tsx';
import ResumePanel from '../components/ResumePanel.tsx';
import Workspace from '../components/Workspace.tsx';
import { resumeToText } from '../resumeText.ts';
import type { ATSPrefill } from '../App.tsx';
import type { ResumeMessage, ResumeSession, ResumeVersion, SessionDocument, Template } from '../../shared/types.ts';

interface SessionViewProps {
  sessionId: string;
  templates: Template[];
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
export default function SessionView({ sessionId, templates, onSessionChanged, onOpenAts, initialMessage, onInitialMessageSent }: SessionViewProps) {
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
  // The live "Next Steps" plan body pushed mid-turn (null = show the persisted doc),
  // and the agent's current step/tool, for the live task list + a working indicator.
  const [livePlan, setLivePlan] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<{ step: number; tool?: string } | null>(null);
  const [error, setError] = useState('');
  // Guards the first-message send against StrictMode's double-invoked mount
  // effect, which would otherwise send (and persist) the message twice.
  const sentInitial = useRef(false);
  // Open the Workspace once per turn when the live plan first arrives, so the live
  // checklist is visible — without fighting the user if they then close the panel.
  const autoOpenedPlan = useRef(false);

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
      if (list.length > 0) setShowResume(true);
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

  async function send(content: string, approvedCalls: string[] = []): Promise<void> {
    const priorVersions = versions.list.length;
    const priorDocs = documents.length;
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, session_id: sessionId, role: 'user', content, created_at: '' }]);
    setBusy(true);
    setStreaming('');
    setLivePlan(null);
    setLiveStatus(null);
    autoOpenedPlan.current = false;
    setError('');
    // Steers that couldn't fold into this turn (came in too late, or a canvas turn):
    // collected here and re-sent as a fresh turn once this one settles, so they get answered.
    const deferred: string[] = [];
    try {
      await api.sendSessionMessageStream(sessionId, content, (text) => setStreaming((prev) => prev + text), approvedCalls, {
        onPlan: (body) => {
          setLivePlan(body);
          // Reveal the Workspace the first time a live plan appears this turn (the
          // panel is closed by default), but don't reopen it if the user closes it.
          if (body.trim() && !autoOpenedPlan.current) {
            autoOpenedPlan.current = true;
            setShowWorkspace(true);
          }
        },
        onStatus: setLiveStatus,
        onSteerAck: (text, isDeferred) => { if (isDeferred) deferred.push(text); }
      });
      // Commit the persisted reply AND tear down the streaming/live state in the same
      // synchronous block, so the live bubble never lingers as a duplicate while
      // the follow-up refreshes (versions/documents) run on later round-trips.
      const msgs = await api.getSessionMessages(sessionId);
      setStreaming('');
      setLivePlan(null);
      setLiveStatus(null);
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
      // Answer any steer that was deferred to the next turn by running it now.
      if (deferred.length) await send(deferred.join('\n\n'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Safety net for the error path; idempotent on the success path above.
      setBusy(false);
      setStreaming('');
      setLivePlan(null);
      setLiveStatus(null);
    }
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

  const subtitle = [session.company_name, session.location].filter(Boolean).join(' · ') || 'Tell Sox about the job';

  // External calls Sox tried to make but the approval gate refused, taken from the
  // latest assistant turn. Each becomes an "Approve & send" button that re-runs the
  // turn authorizing exactly that call (by its fingerprint token), once.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const pendingApprovals: { token: string; tool: string }[] = [];
  const seenTokens = new Set<string>();
  for (const t of lastAssistant?.tool_trace ?? []) {
    if (t.needsApproval && t.approvalToken && !seenTokens.has(t.approvalToken)) {
      seenTokens.add(t.approvalToken);
      pendingApprovals.push({ token: t.approvalToken, tool: t.tool });
    }
  }
  const shortToolName = (name: string): string => name.split(/__|\./).pop() || name;

  // A short "what Sox is doing now" line for the pending bubble, from live status.
  const statusText = busy && liveStatus
    ? (liveStatus.tool ? `Using ${shortToolName(liveStatus.tool)}…` : 'Thinking…')
    : undefined;

  const actions = (
    <>
      <button className="chip" onClick={draft} disabled={busy}><Wand2 size={14} /> Generate draft</button>
      <button className="chip" onClick={() => setShowWorkspace((s) => !s)}>
        <FolderOpen size={14} /> Workspace{documents.length > 0 ? ` (${documents.length})` : ''}
      </button>
      {versions.list.length > 0 && (
        <button className="chip" onClick={() => setShowResume(true)}><PanelRightOpen size={14} /> View resume</button>
      )}
      {pendingApprovals.map(({ token, tool }) => (
        <button
          key={token}
          className="chip approve"
          disabled={busy}
          title={`Authorize Sox to run ${tool} exactly as shown`}
          onClick={() => void send(`Approved — go ahead and run ${shortToolName(tool)} exactly as shown.`, [token])}
        >
          <Check size={14} /> Approve &amp; send: {shortToolName(tool)}
        </button>
      ))}
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
              {session.title || 'New job hunt'}
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
            onSteer={steer}
            statusText={statusText}
            busy={busy}
            streamingText={streaming}
            assistantName="Sox"
            assistantAvatar={<Cat size={16} />}
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
