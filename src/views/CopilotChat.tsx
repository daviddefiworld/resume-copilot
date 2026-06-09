import { useEffect, useState } from 'react';
import { Cat, Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { api } from '../api.ts';
import Chat from '../components/Chat.tsx';
import ConfirmDialog from '../components/ConfirmDialog.tsx';
import type { MemoryMessage, MemoryProposal } from '../../shared/types.ts';

// Fixed persona for the copilot — Sox is Sox. The personality dial still tunes
// critique style on the server; we send a sensible default here.
const COPILOT_PERSONALITY = 'critical_mentor';

// Starters are sent verbatim as the user's first message, so they read as
// things the user would actually say — natural openers, not instructions.
const STARTERS = [
  "Let me tell you about my current job and what I'm responsible for.",
  "I want to walk you through a project I'm proud of.",
  "Help me figure out which of my skills belong on a resume.",
  "I'm not sure where to start — ask me a few questions about my work."
];

// The Sox copilot: a warm, ChatGPT-style memory chat. Conversation builds
// long-term career memory; "Review what I learned" extracts candidate items the
// user confirms before anything is saved.
export default function CopilotChat({ onMemorySaved }: { onMemorySaved?: () => void }) {
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<MemoryProposal[] | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    api.getMemoryMessages().then(setMessages).catch((e: Error) => setError(e.message));
  }, []);

  async function send(content: string): Promise<void> {
    setError('');
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content, created_at: '' }]);
    setBusy(true);
    try {
      await api.sendMemoryMessage(content, COPILOT_PERSONALITY);
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
      <div className="greetingMark"><Cat size={30} /></div>
      <h1>Hi, I'm Sox.</h1>
      <p>Your personal career copilot. Tell me about your work and I'll remember the real story —
        so every resume you build later is tailored and true.</p>
      <div className="starters">
        {STARTERS.map((s) => (
          <button key={s} onClick={() => void send(s)}>{s}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="paneTitle"><Cat size={18} /> Copilot chat</div>
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
        assistantName="Sox"
        assistantAvatar={<Cat size={16} />}
        placeholder="Message Sox…"
        emptyState={emptyState}
        disclaimer="Sox only saves what you confirm. Nothing is stored until you review it."
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
