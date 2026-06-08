import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import type { ChatRole } from '../../shared/types.ts';
import Markdown from './Markdown.tsx';

export interface ChatBubbleMessage {
  id: string;
  role: ChatRole;
  content: string;
}

interface ChatProps {
  messages: ChatBubbleMessage[];
  onSend: (text: string) => Promise<void> | void;
  busy: boolean;
  placeholder?: string;
  assistantName?: string;
  assistantAvatar?: ReactNode;
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
  emptyState,
  actions,
  disclaimer
}: ChatProps) {
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

  return (
    <div className="chat">
      {isEmpty && emptyState ? (
        <div className="chatEmpty">{emptyState}</div>
      ) : (
        <div className="chatThread">
          <div className="thread">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="turn user">
                  <div className="userBubble">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="turn assistant">
                  <div className="avatar">{assistantAvatar}</div>
                  <div className="turnBody">
                    <div className="turnName">{assistantName}</div>
                    <Markdown>{m.content}</Markdown>
                  </div>
                </div>
              )
            )}
            {busy && (
              <div className="turn assistant">
                <div className="avatar">{assistantAvatar}</div>
                <div className="turnBody">
                  <div className="turnName">{assistantName}</div>
                  <div className="typing"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}

      <div className="composerWrap">
        {actions && <div className="composerActions">{actions}</div>}
        <form className="composer" onSubmit={submit}>
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            placeholder={placeholder || 'Message Sox…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="sendBtn" disabled={busy || !text.trim()} aria-label="Send">
            <ArrowUp size={18} />
          </button>
        </form>
        {disclaimer && <p className="composerNote">{disclaimer}</p>}
      </div>
    </div>
  );
}
