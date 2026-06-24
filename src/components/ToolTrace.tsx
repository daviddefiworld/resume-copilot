import { useState } from 'react';
import { Check, ChevronRight, Wrench, X } from 'lucide-react';
import type { ToolTraceEntry } from '../../shared/types.ts';

// Renders the tool calls an agent made for one assistant turn, above its reply.
// The whole trace stays HIDDEN behind a small toggle so the chat reads as a clean
// conversation; clicking it reveals each call, and each call can then be expanded
// further to show the input the model sent and the raw result it got back.
export default function ToolTrace({ entries }: { entries?: ToolTraceEntry[] }) {
  const [shown, setShown] = useState(false);
  if (!entries || entries.length === 0) return null;
  const count = entries.length;
  return (
    <div className="toolTrace">
      <button className="toolTraceToggle" onClick={() => setShown((s) => !s)} aria-expanded={shown}>
        <Wrench size={12} />
        <span>{shown ? 'Hide' : 'Show'} tool {count === 1 ? 'call' : 'calls'} ({count})</span>
        <ChevronRight size={12} className={`toolChevron ${shown ? 'open' : ''}`} />
      </button>
      {shown && entries.map((entry, i) => (
        <ToolCallRow key={i} entry={entry} />
      ))}
    </div>
  );
}

function ToolCallRow({ entry }: { entry: ToolTraceEntry }) {
  const [open, setOpen] = useState(false);
  const input = formatArgs(entry.args);
  return (
    <div className={`toolCall ${entry.ok ? '' : 'failed'}`}>
      <button className="toolCallHead" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={13} className={`toolChevron ${open ? 'open' : ''}`} />
        <Wrench size={13} />
        <span className="toolCallName">
          <strong>{entry.server}</strong> · {entry.tool}
        </span>
        <span className={`toolBadge ${entry.ok ? 'ok' : 'fail'}`}>
          {entry.ok ? <Check size={12} /> : <X size={12} />}
        </span>
      </button>
      {open && (
        <div className="toolCallBody">
          {input && (
            <>
              <div className="toolLabel">Input</div>
              <pre>{input}</pre>
            </>
          )}
          <div className="toolLabel">Result</div>
          <pre>{entry.result || '(no output)'}</pre>
          {entry.raw && entry.raw.trim() !== entry.result.trim() && (
            <>
              <div className="toolLabel">Full response</div>
              <pre>{entry.raw}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
