import type { ToolTraceEntry } from '../../shared/types.ts';

// Chat messages store their agent tool-call trace as a JSON column. These two
// helpers convert between the stored text and the domain array, shared by the
// memory and resume message repositories so the encoding stays identical.

// An empty/absent trace is stored as NULL, not "[]", so old rows and
// tool-free turns read back as `undefined`.
export function serializeTrace(trace: ToolTraceEntry[] | undefined): string | null {
  return trace && trace.length ? JSON.stringify(trace) : null;
}

export function parseTrace(value: string | null): ToolTraceEntry[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ToolTraceEntry[];
    return Array.isArray(parsed) && parsed.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}
