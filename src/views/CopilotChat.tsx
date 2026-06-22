import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { api } from '../api.ts';
import { copilotTurn } from '../copilotTurn.ts';
import Chat from '../components/Chat.tsx';
import ConfirmDialog from '../components/ConfirmDialog.tsx';
import { personaVisual, PersonaMark } from '../personaVisual.tsx';
import type { MemoryProposal, Personality, SessionSuggestion } from '../../shared/types.ts';

// The Sox copilot: a warm, companion-style chat. The conversation is for the big
// picture — getting to know each other, life, and strategy — and builds long-term
// memory; "Review what I learned" extracts candidate items the user confirms
// before anything is saved. When the talk turns to one concrete role, Sox can
// offer (via onStartSession) to open a dedicated job-hunt workspace for it.
export default function CopilotChat({
  profileId,
  persona,
  onMemorySaved,
  onStartSession
}: {
  profileId: string | null;
  persona: Personality | null;
  onMemorySaved?: () => void;
  onStartSession?: (suggestion: SessionSuggestion) => void | Promise<void>;
}) {
  // The chat turn (messages, busy, streaming, activity, error) lives in a
  // module-level store so an in-flight turn survives navigating away and back —
  // see copilotTurn.ts. UI-only state stays local.
  const turn = useSyncExternalStore(copilotTurn.subscribe, copilotTurn.getState);
  const { messages, streaming, activity, error } = turn;
  const [proposals, setProposals] = useState<MemoryProposal[] | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [confirmRestart, setConfirmRestart] = useState(false);
  // Busy for the non-turn actions (review/restart/save), kept separate from the
  // streaming turn's own busy so neither blocks the other unexpectedly.
  const [working, setWorking] = useState(false);
  const busy = turn.busy || working;

  // Load (or, on profile switch, reset and reload) this profile's conversation.
  // The store ignores a re-mount that lands mid-turn, so returning to the pane
  // keeps the live stream instead of wiping it.
  useEffect(() => {
    if (profileId) void copilotTurn.init(profileId);
  }, [profileId]);

  // The active personality (chosen in Settings → Personality) names the copilot
  // and colours its avatar + greeting mark, so the chat feels like "them".
  const personaName = persona?.name ?? 'Sox';
  const visual = personaVisual(persona);

  function send(content: string): void {
    void copilotTurn.send(content, persona?.id ?? 'sox');
  }

  // Stop the in-flight turn: aborts the request and cancels the run server-side.
  function stop(): void {
    copilotTurn.stop();
  }

  async function restart(): Promise<void> {
    setConfirmRestart(false);
    copilotTurn.setError('');
    setWorking(true);
    try {
      await api.clearMemoryMessages();
      copilotTurn.clear();
      setProposals(null);
    } catch (e) {
      copilotTurn.setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function review(): Promise<void> {
    copilotTurn.setError('');
    setWorking(true);
    try {
      const result = await api.proposeMemory();
      setProposals(result.items);
      setPicked(Object.fromEntries(result.items.map((_, i) => [i, true])));
    } catch (e) {
      copilotTurn.setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function saveConfirmed(): Promise<void> {
    if (!proposals) return;
    const items = proposals.filter((_, i) => picked[i]);
    if (items.length === 0) {
      setProposals(null);
      return;
    }
    try {
      await api.saveMemoryItems(items);
      setProposals(null);
      onMemorySaved?.();
    } catch (e) {
      copilotTurn.setError((e as Error).message);
    }
  }

  const emptyState = (
    <div className="greeting">
      <PersonaMark persona={persona} size={30} className="greetingMark" />
      <h1>Hi, I'm {personaName}.</h1>
      <p className="greetingLead">
        {persona?.mission ?? "I'm your copilot for landing a great remote dev role — then growing you toward the top of the field. I'm in your corner the whole way."}
      </p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader centered">
        <div className="paneHeaderInner">
          <div className="paneTitle">
            <PersonaMark persona={persona} size={18} className="paneTitleMark" zoomable />
            Chat with {personaName}
          </div>
          <div className="headerActions">
            <button className="pillBtn ghost" onClick={() => setConfirmRestart(true)} disabled={busy}>
              <RotateCcw size={15} /> Restart
            </button>
            <button className="pillBtn" onClick={review} disabled={busy}>
              <Sparkles size={15} /> Review what I learned
            </button>
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <Chat
        messages={messages}
        onSend={send}
        onStop={stop}
        activity={activity}
        busy={busy}
        streamingText={streaming}
        assistantName={personaName}
        assistantAvatar={<PersonaMark persona={persona} size={20} bare />}
        personaGradient={visual.gradient}
        placeholder={`Message ${personaName}…`}
        emptyState={emptyState}
        onStartSession={onStartSession}
        disclaimer={`${personaName} only saves what you confirm. Nothing is stored until you review it.`}
      />

      {confirmRestart && (
        <ConfirmDialog
          title="Start a new chat?"
          message="This clears the current conversation. Your saved memory stays untouched."
          confirmLabel="Start new chat"
          onConfirm={() => void restart()}
          onCancel={() => setConfirmRestart(false)}
        />
      )}

      {proposals && (
        <div className="modalBackdrop" onClick={() => setProposals(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save to memory?</h3>
            <p className="modalSub">Sox pulled these out of your chat. Pick what's accurate.</p>
            {proposals.length === 0 && <p className="hint">Nothing new yet — keep chatting with Sox.</p>}
            <div className="proposalList">
              {proposals.map((item, i) => (
                <label key={i} className={`proposal ${picked[i] ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[i])}
                    onChange={(e) => setPicked({ ...picked, [i]: e.target.checked })}
                  />
                  <div>
                    <div className="proposalTop">
                      <strong>{item.title}</strong>
                      <span className={`tag ${item.action === 'update' ? 'update' : 'new'}`}>
                        {item.action === 'update' ? 'Update' : 'New'}
                      </span>
                      <span className={`tag ${item.confidence}`}>{item.confidence}</span>
                    </div>
                    <small>{item.category}</small>
                    <p>{item.content}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="modalActions">
              <button className="ghost" onClick={() => setProposals(null)}><X size={15} /> Cancel</button>
              <button onClick={saveConfirmed} disabled={proposals.length === 0}><Check size={15} /> Save selected</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
