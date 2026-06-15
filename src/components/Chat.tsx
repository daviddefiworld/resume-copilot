import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import type { ChatRole, ToolTraceEntry } from '../../shared/types.ts';
import Markdown from './Markdown.tsx';
import ToolTrace from './ToolTrace.tsx';

export interface ChatBubbleMessage {
  id: string;
  role: ChatRole;
  content: string;
  // Tool calls the agent made for this turn, shown above the reply.
  tool_trace?: ToolTraceEntry[];
}

interface ChatProps {
  messages: ChatBubbleMessage[];
  onSend: (text: string) => Promise<void> | void;
  busy: boolean;
  placeholder?: string;
  assistantName?: string;
  assistantAvatar?: ReactNode;
  // CSS background for the assistant avatar — lets each personality colour its
  // own avatar. Falls back to the app accent when absent.
  personaGradient?: string;
  emptyState?: ReactNode;
  actions?: ReactNode;
  disclaimer?: string;
}

// ChatGPT-style conversation: a centered scrolling thread with an avatar +
// Markdown for the assistant and right-aligned bubbles for the user, plus a
// rounded composer pinned to the bottom. The parent owns the messages.
export default function Chat({
  messages,
  onSend,
  busy,
  placeholder,
  assistantName = 'Sox',
  assistantAvatar,
  personaGradient,
  emptyState,
  actions,
  disclaimer
}: ChatProps) {
  // Per-personality avatar colour, applied via a CSS variable so the message
  // avatars and typing indicator all pick it up.
  const avatarStyle = personaGradient ? { background: personaGradient } : undefined;
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    await onSend(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event);
    }
  }

  const isEmpty = messages.length === 0 && !busy;

  const composer = (
    <div className="composerWrap">
      {actions && <div className="composerActions">{actions}</div>}
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="composerInput"
          value={text}
          rows={1}
          placeholder={placeholder || 'Message Sox…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composerBar">
          <span className="composerKbd">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </span>
          <button type="submit" className="sendBtn" disabled={busy || !text.trim()} aria-label="Send">
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
      {disclaimer && <p className="composerNote">{disclaimer}</p>}
    </div>
  );

  // Empty start state mirrors ChatGPT's new-chat layout: greeting + composer
  // sit together, vertically centered. Once the thread has messages the
  // composer drops to its usual pinned-bottom position.
  if (isEmpty && emptyState) {
    return (
      <div className="chat empty">
        <div className="chatEmpty">
          <div className="chatEmptyInner">
            {emptyState}
            {composer}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="chatThread">
        <div className="thread">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="turn user">
                <div className="userBubble">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="turn assistant">
                <div className="avatar" style={avatarStyle}>{assistantAvatar}</div>
                <div className="turnBody">
                  <div className="turnName">{assistantName}</div>
                  <ToolTrace entries={m.tool_trace} />
                  <Markdown>{m.content}</Markdown>
                </div>
              </div>
            )
          )}
          {busy && (
            <div className="turn assistant">
              <div className="avatar" style={avatarStyle}>{assistantAvatar}</div>
              <div className="turnBody">
                <div className="turnName">{assistantName}</div>
                <div className="typing"><span /><span /><span /></div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {composer}
    </div>
  );
}
