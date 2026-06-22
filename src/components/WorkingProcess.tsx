import { Check, Loader2 } from 'lucide-react';
import type { AgentActivity } from '../../shared/types.ts';

// The agent's live "working process" for the current turn: an accumulating list
// of what it's doing — thinking, then each tool it runs — shown in the pending
// bubble before the reply streams. Completed steps tick off; the last one spins.
export default function WorkingProcess({ steps }: { steps: AgentActivity[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="working" role="status" aria-live="polite">
      {steps.map((step) => (
        <div key={step.id} className={`workStep ${step.done ? 'done' : 'active'}`}>
          <span className="workIcon">
            {step.done ? <Check size={13} /> : <Loader2 size={13} className="workSpin" />}
          </span>
          <span className="workLabel">{step.label}{step.done ? '' : '…'}</span>
        </div>
      ))}
    </div>
  );
}
