import { useEffect, useState } from 'react';
import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { api } from '../api.ts';
import Chat from '../components/Chat.tsx';
import ConfirmDialog from '../components/ConfirmDialog.tsx';
import { personaVisual } from '../personaVisual.tsx';
import type { MemoryMessage, MemoryProposal, Personality } from '../../shared/types.ts';

// The Sox copilot: a warm, ChatGPT-style memory chat. Conversation builds
// long-term career memory; "Review what I learned" extracts candidate items the
// user confirms before anything is saved.
export default function CopilotChat({ persona, onMemorySaved }: { persona: Personality | null; onMemorySaved?: () => void }) {
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<MemoryProposal[] | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    api.getMemoryMessages().then(setMessages).catch((e: Error) => setError(e.message));
  }, []);

  // The active personality (chosen in Settings → Personality) names the copilot
  // and colours its avatar + greeting mark, so the chat feels like "them".
  const personaName = persona?.name ?? 'Sox';
  const visual = personaVisual(persona);

  async function send(content: string): Promise<void> {
    setError('');
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content, created_at: '' }]);
    setBusy(true);
    try {
      await api.sendMemoryMessage(content, persona?.id ?? 'sox');
      setMessages(await api.getMemoryMessages());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restart(): Promise<void> {
    setConfirmRestart(false);
    setError('');
    setBusy(true);
    try {
      await api.clearMemoryMessages();
      setMessages([]);
      setProposals(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const result = await api.proposeMemory();
      setProposals(result.items);
      setPicked(Object.fromEntries(result.items.map((_, i) => [i, true])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
      setError((e as Error).message);
    }
  }

  const emptyState = (
    <div className="greeting">
      <div className="greetingMark" style={{ background: visual.gradient }}><visual.Icon size={30} /></div>
      <h1>Hi, I'm {personaName}.</h1>
      <p className="greetingLead">
        {persona?.mission ?? "I'm your copilot for landing a great remote dev role — then growing you toward the top of the field. I'm in your corner the whole way."}
      </p>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="paneTitle">
          <span className="paneTitleMark" style={{ background: visual.gradient }}><visual.Icon size={13} /></span>
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
      </header>

      {error && <p className="error">{error}</p>}

      <Chat
        messages={messages}
        onSend={send}
        busy={busy}
        assistantName={personaName}
        assistantAvatar={<visual.Icon size={16} />}
        personaGradient={visual.gradient}
        placeholder={`Message ${personaName}…`}
        emptyState={emptyState}
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
