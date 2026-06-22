import type { AgentActivity } from '../shared/types.ts';

// Shorten a possibly server-prefixed tool name to its readable tail, e.g.
// "mcp__claude_ai_Gmail__send_email" -> "send_email", "web_search" -> "web_search".
export function shortToolName(name: string): string {
  return name.split(/__|\./).pop() || name;
}

// Fold one live `status` event into the running working-process list. The agent
// emits a status at the top of every step (thinking) and before each tool call;
// we turn each into a step, marking the prior ones done so the list reads as a
// build-up of what it did. A repeat of the current step (same label, still live)
// is collapsed so a burst of identical events doesn't stutter the list.
export function foldActivity(prev: AgentActivity[], status: { step: number; tool?: string }): AgentActivity[] {
  const label = status.tool ? `Using ${shortToolName(status.tool)}` : 'Thinking';
  const last = prev[prev.length - 1];
  if (last && !last.done && last.label === label) return prev;
  const settled = prev.map((a) => (a.done ? a : { ...a, done: true }));
  return [...settled, { id: prev.length, label, done: false, tool: status.tool }];
}
