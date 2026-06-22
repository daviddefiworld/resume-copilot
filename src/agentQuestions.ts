import type { AgentQuestion, AgentQuestionOption, SessionSuggestion } from '../shared/types.ts';

// The agent marks interactive elements by appending a fenced block tagged `ask`
// (a quick-pick question) or `session` (an offer to open a job-hunt workspace),
// whose body is JSON. The chat parses those blocks out of the reply, hides the
// raw JSON, and renders an interactive card in their place. This module is the
// single source of truth for that markup contract — both the live stream and the
// persisted message run through it, so what the user sees never includes raw JSON.

export interface ParsedReply {
  // The reply prose with every recognised agent block removed.
  prose: string;
  // The questions extracted from `ask` blocks, in the order they appeared.
  questions: AgentQuestion[];
  // The job-hunt offer from a `session` block, if one was present (the last wins).
  session?: SessionSuggestion;
}

// Matches one complete fenced ```ask or ```session block, capturing the tag and
// its JSON body. The body sits on the line(s) after the opening fence and runs to
// a CLOSING FENCE ON ITS OWN LINE. Anchoring the close to a line boundary (rather
// than the first ``` anywhere) is what lets the JSON itself contain ``` — e.g. a
// question about a ```code``` snippet — without the body being truncated mid-string.
// Built fresh per call so the global regex's lastIndex never leaks between calls.
function blockRe(): RegExp {
  return /```[ \t]*(ask|session)\b[^\n]*\n([\s\S]*?)\n[ \t]*```(?=\r?\n|$)/gi;
}

// A loose regex for an OPENING fence of either tag, used to drop a trailing block
// that is still streaming in (opened but not yet closed).
function openFenceRe(): RegExp {
  return /```[ \t]*(?:ask|session)\b/i;
}

// Parse one block body into a question, or null if it isn't a usable one. Kept
// tolerant: options may be plain strings or { label, description } objects, and
// anything malformed (bad JSON, no question, no options) yields null so the
// caller can leave the original text untouched rather than dropping content.
function parseQuestion(body: string): AgentQuestion | null {
  let data: unknown;
  try {
    data = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.question !== 'string' || !obj.question.trim()) return null;

  const rawOptions = Array.isArray(obj.options) ? obj.options : [];
  const options: AgentQuestionOption[] = [];
  for (const raw of rawOptions) {
    if (typeof raw === 'string' && raw.trim()) {
      options.push({ label: raw.trim() });
    } else if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.label === 'string' && o.label.trim()) {
        options.push({
          label: o.label.trim(),
          description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined
        });
      }
    }
  }
  if (options.length === 0) return null;

  return {
    question: obj.question.trim(),
    header: typeof obj.header === 'string' && obj.header.trim() ? obj.header.trim() : undefined,
    multiSelect: obj.multiSelect === true,
    options
  };
}

// Parse one `session` block body into a job-hunt offer, or null if unusable. Both
// a title and a kickoff message are required — without them the card has nothing
// to open — so a malformed block is left in the prose rather than dropped.
function parseSession(body: string): SessionSuggestion | null {
  let data: unknown;
  try {
    data = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const kickoff = typeof obj.kickoff === 'string' ? obj.kickoff.trim() : '';
  if (!title || !kickoff) return null;
  // Optional structured target details — carried into the session when present.
  const str = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return {
    title,
    kickoff,
    note: str('note'),
    company: str('company'),
    role: str('role'),
    location: str('location'),
    jobDescription: str('jobDescription'),
    link: str('link')
  };
}

// Collapse the runs of blank lines a removed block can leave behind, then trim.
// Deliberately does NOT touch trailing spaces on a line — two trailing spaces are
// a Markdown hard line break, and stripping them would silently drop intended <br>s.
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Split a finished assistant reply into its prose and any quick-pick questions.
// A block that fails to parse is left in the prose verbatim (so it just renders
// as an ordinary code block) — we never silently lose text the model wrote.
export function parseReply(content: string): ParsedReply {
  const text = content ?? '';
  if (!text.includes('```')) return { prose: text.trim(), questions: [] };

  const questions: AgentQuestion[] = [];
  let session: SessionSuggestion | undefined;
  let prose = '';
  let last = 0;
  for (const match of text.matchAll(blockRe())) {
    const tag = (match[1] ?? '').toLowerCase();
    const body = match[2] ?? '';
    // Parse by tag; a block that fails to parse is left where it sits, in the prose.
    if (tag === 'ask') {
      const question = parseQuestion(body);
      if (!question) continue;
      questions.push(question);
    } else if (tag === 'session') {
      const suggestion = parseSession(body);
      if (!suggestion) continue;
      session = suggestion; // last valid offer wins
    } else {
      continue;
    }
    prose += text.slice(last, match.index);
    last = match.index + match[0].length;
  }
  prose += text.slice(last);
  return { prose: tidy(prose), questions, session };
}

// Strip ```ask / ```session blocks from a partial, still-streaming reply so their
// raw JSON never flashes on screen. Removes any complete blocks, then drops a
// trailing block that has been opened but not yet closed (the JSON arriving token
// by token), leaving only the clean prose to show until the message is persisted.
export function stripAgentBlocks(content: string): string {
  const text = content ?? '';
  if (!text.includes('```')) return text;
  let out = text.replace(blockRe(), '');
  const open = out.search(openFenceRe());
  if (open !== -1) out = out.slice(0, open);
  return tidy(out);
}
