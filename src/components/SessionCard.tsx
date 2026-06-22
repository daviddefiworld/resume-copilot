import { useState } from 'react';
import { ArrowRight, Briefcase } from 'lucide-react';
import type { SessionSuggestion } from '../../shared/types.ts';

interface SessionCardProps {
  suggestion: SessionSuggestion;
  // Open a dedicated job-hunt workspace seeded from this suggestion. The handler
  // navigates away into the new session, so the card just latches "opening".
  onStart: (suggestion: SessionSuggestion) => void | Promise<void>;
}

const DEFAULT_NOTE =
  'Open a focused workspace for this one role — research, outreach, and a tailored resume all live there.';

// The copilot's "start a job hunt" offer, rendered from a ```session block. The
// companion chat is for the big picture; when the talk turns to one concrete role,
// this card lets the user spin up its own workspace in a click.
export default function SessionCard({ suggestion, onStart }: SessionCardProps) {
  const [opening, setOpening] = useState(false);

  async function start(): Promise<void> {
    if (opening) return;
    setOpening(true);
    try {
      await onStart(suggestion);
    } catch {
      // The handler surfaces its own error; let the user try again.
      setOpening(false);
    }
  }

  return (
    <div className="sessionCard" role="group" aria-label={`Start a job hunt: ${suggestion.title}`}>
      <div className="sessionCardIcon" aria-hidden="true"><Briefcase size={16} /></div>
      <div className="sessionCardBody">
        <div className="sessionCardTitle">{suggestion.title}</div>
        <div className="sessionCardNote">{suggestion.note ?? DEFAULT_NOTE}</div>
      </div>
      <button type="button" className="sessionCardBtn" onClick={start} disabled={opening}>
        {opening ? 'Opening…' : <>Start job hunt <ArrowRight size={14} /></>}
      </button>
    </div>
  );
}
