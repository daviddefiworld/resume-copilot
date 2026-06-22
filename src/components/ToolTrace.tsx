import { useState } from 'react';
import { Check, ChevronRight, Wrench, X } from 'lucide-react';
import type { ToolTraceEntry } from '../../shared/types.ts';

// Renders the tool calls an agent made for one assistant turn, above its reply.
// Each call is a collapsed row (server · tool + ok/fail) that expands to show the
// input the model sent and the raw result it got back.
export default function ToolTrace({ entries }: { entries?: ToolTraceEntry[] }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="toolTrace">
      {entries.map((entry, i) => (
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
