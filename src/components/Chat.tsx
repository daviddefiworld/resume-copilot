import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import type { AgentActivity, ChatRole, SessionSuggestion, ToolTraceEntry } from '../../shared/types.ts';
import { parseReply, stripAgentBlocks } from '../agentQuestions.ts';
import Markdown from './Markdown.tsx';
import QuestionCard from './QuestionCard.tsx';
import SessionCard from './SessionCard.tsx';
import ToolTrace from './ToolTrace.tsx';
import WorkingProcess from './WorkingProcess.tsx';

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
  // The reply being streamed in right now, shown live in the pending assistant
  // bubble. Empty while busy means "thinking" (typing dots) — e.g. before the
  // first token, or a turn that can't stream (resume-canvas edits).
  streamingText?: string;
  // When provided, sending WHILE busy steers the in-flight turn instead of being
  // blocked: the text is handed to onSteer (the agent folds it in at its next
  // step) rather than onSend. Without it, the composer stays blocked while busy.
  onSteer?: (text: string) => void;
  // The agent's live "working process" for the in-flight turn (thinking + each
  // tool it runs), shown in the pending bubble before the reply streams.
  activity?: AgentActivity[];
  // When provided, a Stop button appears while busy to cancel the in-flight turn.
  onStop?: () => void;
  // When provided, a ```session block in a reply renders as a "Start job hunt"
  // action card; clicking it opens a dedicated workspace for that role. Only the
  // companion chat passes this — a resume session never offers to spawn another.
  onStartSession?: (suggestion: SessionSuggestion) => void | Promise<void>;
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
  disclaimer,
  streamingText,
  onSteer,
  activity = [],
  onStop,
  onStartSession
}: ChatProps) {
  // Per-personality avatar colour, applied via a CSS variable so the message
  // avatars and typing indicator all pick it up.
  const avatarStyle = personaGradient ? { background: personaGradient } : undefined;
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, streamingText]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // True when a send right now would steer the in-flight turn rather than start one.
  const steering = busy && !!onSteer;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (busy && !onSteer) return; // no steering available → stay blocked while busy
    setText('');
    if (busy) {
      onSteer?.(value);
      return;
    }
    await onSend(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event);
    } else if (event.key === 'Escape' && busy && onStop && !(steering && text.trim())) {
      // Only stop when the Stop button is the visible affordance — while a steer
      // message is typed the button shows Send/Steer, so Esc must not kill the turn.
      event.preventDefault();
      onStop();
    }
  }

  const isEmpty = messages.length === 0 && !busy;

  // While streaming, hide any (possibly half-written) ```ask / ```session block so
  // its raw JSON never flashes — the card renders once the message is persisted.
  const liveProse = stripAgentBlocks(streamingText ?? '');

  // True when the latest step is a tool call still in flight: the model is blocked
  // waiting on it, so no prose is streaming right now even though a preface may
  // already be on screen.
  const lastStep = activity[activity.length - 1];
  const runningTool = !!lastStep && !lastStep.done && !!lastStep.tool;
  // While the model is actively writing prose (a preface or the final answer) with
  // no tool in flight, settle every step so the working list reads "done → here's
  // the reply" instead of leaving a "Thinking…" spinner stranded above the text.
  const answering = !!liveProse && !runningTool;
  const workSteps = answering ? activity.map((a) => ({ ...a, done: true })) : activity;

  const composer = (
    <div className="composerWrap">
      {actions && <div className="composerActions">{actions}</div>}
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="composerInput"
          value={text}
          rows={1}
          placeholder={steering ? `Steer ${assistantName} while it works…` : (placeholder || 'Message Sox…')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composerBar">
          <span className="composerKbd">
            {busy && onStop && !(steering && text.trim())
              ? <>Working… <kbd>Esc</kbd> or tap stop to halt</>
              : steering
                ? <><kbd>Enter</kbd> to steer · it folds in at the next step</>
                : <><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</>}
          </span>
          {busy && onStop && !(steering && text.trim()) ? (
            // Empty composer (or no steering) while busy → Stop cancels the turn.
            <button type="button" className="sendBtn stop" onClick={onStop} aria-label="Stop">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className={`sendBtn${steering ? ' steering' : ''}`} disabled={!text.trim() || (busy && !onSteer)} aria-label={steering ? 'Steer' : 'Send'}>
              <ArrowUp size={18} />
            </button>
          )}
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
          {messages.map((m, index) =>
            m.role === 'user' ? (
              <div key={m.id} className="turn user">
                <div className="userBubble">{m.content}</div>
              </div>
            ) : (
              <AssistantTurn
                key={m.id}
                message={m}
                assistantName={assistantName}
                assistantAvatar={assistantAvatar}
                avatarStyle={avatarStyle}
                // The picker is live only on the final message while nothing is
                // running; an earlier or mid-turn question is shown read-only.
                interactive={index === messages.length - 1 && !busy}
                // The reply that followed, used only to tick what was picked.
                answer={messages[index + 1]?.role === 'user' ? messages[index + 1].content : undefined}
                onAnswer={onSend}
                onStartSession={onStartSession}
              />
            )
          )}
          {busy && (
            <div className="turn assistant">
              <div className="avatar" style={avatarStyle}>{assistantAvatar}</div>
              <div className="turnBody">
                <div className="turnName">{assistantName}</div>
                {/* The agent's working process — thinking + each tool it runs — kept
                    visible in the chat for the whole turn so the window mirrors the
                    composer's "Working…", with the reply streaming beneath it. */}
                {workSteps.length > 0
                  ? <WorkingProcess steps={workSteps} />
                  : !liveProse && <div className="typing"><span /><span /><span /></div>}
                {liveProse && <Markdown>{liveProse}</Markdown>}
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

interface AssistantTurnProps {
  message: ChatBubbleMessage;
  assistantName: string;
  assistantAvatar?: ReactNode;
  avatarStyle?: { background: string };
  interactive: boolean;
  answer?: string;
  onAnswer: (text: string) => Promise<void> | void;
  onStartSession?: (suggestion: SessionSuggestion) => void | Promise<void>;
}

// One assistant turn: its tool trace, the reply prose, any quick-pick question,
// and any "start a job hunt" offer the agent embedded — all parsed out of the
// prose and rendered as interactive cards below it.
function AssistantTurn({ message, assistantName, assistantAvatar, avatarStyle, interactive, answer, onAnswer, onStartSession }: AssistantTurnProps) {
  const { prose, questions, session } = parseReply(message.content);
  // The contract is one quick-pick block per reply; if the model ever emits more,
  // render only the final (operative) one. A single card can't deadlock answering
  // or cross-attribute the one following reply to the wrong question.
  const question = questions[questions.length - 1];
  return (
    <div className="turn assistant">
      <div className="avatar" style={avatarStyle}>{assistantAvatar}</div>
      <div className="turnBody">
        <div className="turnName">{assistantName}</div>
        <ToolTrace entries={message.tool_trace} />
        {prose && <Markdown>{prose}</Markdown>}
        {session && onStartSession && (
          <SessionCard suggestion={session} onStart={onStartSession} />
        )}
        {question && (
          <QuestionCard
            question={question}
            interactive={interactive}
            answer={answer}
            onAnswer={onAnswer}
          />
        )}
      </div>
    </div>
  );
}
