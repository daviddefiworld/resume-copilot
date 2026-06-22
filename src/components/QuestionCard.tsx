import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUp, Check, Pencil } from 'lucide-react';
import type { AgentQuestion } from '../../shared/types.ts';

interface QuestionCardProps {
  question: AgentQuestion;
  // Live (the last message, awaiting an answer) → render the interactive picker.
  // Otherwise the card is read-only: a past question, or one frozen while a turn runs.
  interactive: boolean;
  // The reply that followed this question, if any. Used only to highlight which
  // option(s) were chosen in the read-only state — never to drive behaviour.
  answer?: string;
  // Send the chosen answer as the next user message. Called once per card.
  onAnswer: (text: string) => void;
}

const norm = (s: string): string => s.trim().toLowerCase();

// A select-card for an agent quick-pick question — the chat equivalent of
// Claude Code's "choose an answer" prompt. Single-pick options send on click;
// multi-select gathers picks behind a Send button; an always-present "Other"
// field lets the user type a free-form answer instead. Once answered it freezes
// into a compact recap with the chosen option(s) ticked.
export default function QuestionCard({ question, interactive, answer, onAnswer }: QuestionCardProps) {
  const multi = question.multiSelect === true;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  // Latches the instant the user answers, so the card can't fire twice in the
  // brief window before the parent re-renders it as read-only.
  const [sent, setSent] = useState(false);
  const otherRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otherOpen) otherRef.current?.focus();
  }, [otherOpen]);

  const answered = answer !== undefined && answer !== '';
  const live = interactive && !answered && !sent;

  // Read-only highlight: the recorded answer is one label, or several joined by
  // newlines (sendMulti). Split ONLY on newline and match whole labels, so a
  // label that itself contains a comma (e.g. "Yes, remote only") still ticks.
  const answerParts = answered ? answer.split('\n').map(norm).filter(Boolean) : [];
  const isChosen = (label: string): boolean => answerParts.includes(norm(label));

  function fire(text: string): void {
    const value = text.trim();
    if (!value || !live) return;
    setSent(true);
    onAnswer(value);
  }

  function toggle(label: string): void {
    if (!live) return;
    if (!multi) {
      fire(label);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function sendMulti(): void {
    const parts = [...selected];
    if (otherText.trim()) parts.push(otherText.trim());
    if (parts.length === 0) return;
    // Newline-join so picks stay individually matchable even when a label has a comma.
    fire(parts.join('\n'));
  }

  function onOtherKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (multi) sendMulti();
      else fire(otherText);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOtherOpen(false);
      setOtherText('');
    }
  }

  const isSelected = (label: string): boolean => (live ? selected.has(label) : isChosen(label));
  const canSendMulti = selected.size > 0 || otherText.trim().length > 0;

  return (
    <div className={`askCard ${live ? 'live' : 'resolved'}`} role="group" aria-label={question.question}>
      <div className="askHead">
        {question.header && <span className="askChip">{question.header}</span>}
        <span className="askQuestion">{question.question}</span>
      </div>

      <div className="askOptions">
        {question.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className={`askOption ${isSelected(opt.label) ? 'on' : ''}`}
            aria-pressed={isSelected(opt.label)}
            disabled={!live}
            onClick={() => toggle(opt.label)}
          >
            <span className={`askMark ${multi ? 'box' : 'radio'}`} aria-hidden="true">
              {isSelected(opt.label) && <Check size={13} />}
            </span>
            <span className="askOptionText">
              <span className="askOptionLabel">{opt.label}</span>
              {opt.description && <span className="askOptionDesc">{opt.description}</span>}
            </span>
          </button>
        ))}
      </div>

      {live && (
        <div className="askFooter">
          {otherOpen ? (
            <div className="askOther">
              <input
                ref={otherRef}
                className="askOtherInput"
                value={otherText}
                placeholder="Type your own answer…"
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={onOtherKey}
              />
              {/* Single-select sends the typed text from here; multi-select keeps
                  its persistent Send button (below) as the one submit control. */}
              {!multi && (
                <button
                  type="button"
                  className="askSend"
                  aria-label="Send answer"
                  disabled={!otherText.trim()}
                  onClick={() => fire(otherText)}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="askOtherToggle" onClick={() => setOtherOpen(true)}>
              <Pencil size={13} /> Other…
            </button>
          )}
          {/* Multi-select submit stays visible the whole time the card is live, so
              the pick count and a single Send never vanish when Other opens. */}
          {multi && (
            <button type="button" className="askSendMulti" disabled={!canSendMulti} onClick={sendMulti}>
              Send {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
