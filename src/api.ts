import type {
  ATSReport,
  CharacterMemoryView,
  CopilotConfig,
  McpCatalogEntry,
  McpServerInput,
  McpServerStatus,
  McpServerView,
  MemoryItem,
  MemoryMessage,
  MemoryProposal,
  Personality,
  Profile,
  ProfilesView,
  PromptView,
  ResumeMessage,
  ResumeSession,
  ResumeVersion,
  SessionDocument,
  SettingsView,
  Template
} from '../shared/types.ts';

// Single client for the backend API. The frontend never talks to OpenRouter
// directly and never holds the API key.
//
// Resolve where the API lives. An explicit VITE_API_BASE always wins.
//
// - Packaged app: Express serves the page itself, so a same-origin relative
//   path is correct (and there is no separate port).
// - Dev: the Vite page (:3501) talks to the Node backend (:3500) DIRECTLY — no
//   proxy — relying on the server's CORS. We reuse the hostname the page was
//   loaded with (so it matches whatever the user typed) but force "localhost"
//   to 127.0.0.1: the dev backend binds IPv4 127.0.0.1, while browsers often
//   resolve "localhost" to the IPv6 loopback ::1 — where nothing is listening.
function resolveBase(): string {
  const explicit = import.meta.env.VITE_API_BASE;
  if (explicit) return explicit;
  if (!import.meta.env.DEV) return '/api';
  const host = window.location.hostname || '127.0.0.1';
  const safeHost = host === 'localhost' ? '127.0.0.1' : host;
  return `http://${safeHost}:3500/api`;
}

const BASE = resolveBase();

interface RequestOptions {
  method?: string;
  body?: unknown;
}

// Gateway-style statuses worth retrying: the upstream hiccuped rather than the
// request truly running. A genuine app error (our handlers return 400) is NOT
// retried. We only retry these for idempotent GETs — re-sending a POST/PATCH is
// unsafe (it may have already run server-side), and our own per-request timeout
// now returns a 504 for a stalled handler, which must NOT trigger a re-run of an
// expensive agent turn.
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

// Per-attempt time budget. Mutating/agent routes (POST/PATCH/etc.) can legitimately
// run for a while — a resume draft is a ~140s generation and the server caps a
// request at 200s — so this sits just above the server's own cap, letting the
// server answer with its clear error first instead of the client timing out with a
// generic one. Plain reads should be near-instant. Without this the fetch has no
// deadline, so a stalled server would leave the UI loading forever.
const MUTATION_TIMEOUT_MS = 210_000;
const READ_TIMEOUT_MS = 20_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  // Built once; body is an already-serialized string, so it's safe to reuse
  // across retry attempts. The signal is rebuilt per attempt below.
  const options: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const timeoutMs = method === 'GET' ? READ_TIMEOUT_MS : MUTATION_TIMEOUT_MS;

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      // Fresh signal each attempt — a fired AbortSignal can't be reused.
      response = await fetch(`${BASE}${path}`, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // The server accepted the request but never answered in time. Do NOT
      // retry — a mutating call may have already run server-side — surface it.
      const name = (error as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error('The server took too long to respond. Please try again.');
      }
      // Network/transport failure — typically a stale socket reused after the
      // app sat idle. The request never reached the server; retry on a fresh
      // connection before giving up.
      if (attempt < MAX_ATTEMPTS) {
        await wait(attempt * 150);
        continue;
      }
      throw new Error('Could not reach the local server. Please try again.');
    }

    if (!response.ok) {
      if (method === 'GET' && RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await wait(attempt * 150);
        continue;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      const error = new Error(data.error || `Request failed (${response.status})`) as Error & { status?: number };
      error.status = response.status; // lets callers distinguish e.g. a 409 from other failures
      throw error;
    }

    return response.json() as Promise<T>;
  }
}

// Optional live-event callbacks a streaming turn can push alongside its prose
// deltas: plan = the live "Next Steps" checklist body; status = the agent's
// current step/tool; steerAck = a steered message was accepted (deferred when it
// will seed the next turn rather than fold into this one).
export interface StreamHandlers {
  onPlan?: (body: string) => void;
  onStatus?: (status: { step: number; tool?: string }) => void;
  onSteerAck?: (text: string, deferred?: boolean) => void;
}

// One streaming chat POST over Server-Sent Events. `onDelta` fires for each text
// chunk as the reply is generated; the promise resolves with the final persisted
// message the server sends in its `done` event. Not retried — a chat POST isn't
// idempotent — and uses the mutation timeout, which sits above the server's own
// per-turn budget so a real reply is never cut short.
async function streamRequest<T>(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  handlers: StreamHandlers = {},
  signal?: AbortSignal
): Promise<T> {
  // The fetch aborts on either the per-request timeout OR the caller's stop signal.
  const composite = signal ? AbortSignal.any([AbortSignal.timeout(MUTATION_TIMEOUT_MS), signal]) : AbortSignal.timeout(MUTATION_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: composite
    });
  } catch (error) {
    if (signal?.aborted) throw stopError(); // user pressed Stop before the stream opened
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error('The server took too long to respond. Please try again.');
    }
    throw new Error('Could not reach the local server. Please try again.');
  }

  // A transport-level failure before the stream opened (server down, 404). Once
  // the SSE stream is open the server reports errors as an `error` event instead.
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: T | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; each carries one `data:` payload.
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const dataLine = buffer.slice(0, boundary).split('\n').find((l) => l.startsWith('data:'));
        buffer = buffer.slice(boundary + 2);
        if (!dataLine) continue;
        let event: { type: string; text?: string; message?: T; error?: string; body?: string; step?: number; tool?: string; deferred?: boolean };
        try {
          event = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        if (event.type === 'delta' && event.text) onDelta(event.text);
        else if (event.type === 'plan') handlers.onPlan?.(event.body ?? '');
        else if (event.type === 'status') handlers.onStatus?.({ step: event.step ?? 0, tool: event.tool });
        else if (event.type === 'steer_ack') handlers.onSteerAck?.(event.text ?? '', event.deferred);
        else if (event.type === 'done') final = event.message;
        else if (event.type === 'error') throw new Error(event.error || 'The response failed.');
      }
    }
  } catch (error) {
    // User pressed Stop mid-stream: surface a swallow-able marker, not an error.
    if (signal?.aborted) throw stopError();
    throw error;
  }

  if (final === undefined) {
    if (signal?.aborted) throw stopError();
    throw new Error('The response ended unexpectedly. Please try again.');
  }
  return final;
}

// A stop is a user action, not a failure — callers swallow it (clear the busy
// state and resync) rather than showing an error. isStopped() identifies it.
function stopError(): Error {
  return Object.assign(new Error('Generation stopped.'), { stopped: true });
}

export function isStopped(error: unknown): boolean {
  return Boolean((error as { stopped?: boolean } | null)?.stopped);
}

export interface MemoryItemFields {
  title?: string;
  content?: string;
  confidence?: MemoryItem['confidence'];
}

export interface CreateSessionInput extends Partial<ResumeSession> {
  initial_message?: string;
}

export const api = {
  // Config
  getSettings: () => request<SettingsView>('/settings'),
  saveSettings: (body: { apiKey?: string; model?: string; model2?: string }) =>
    request<SettingsView>('/settings', { method: 'POST', body }),
  getPersonalities: () => request<Personality[]>('/personalities'),
  createPersonality: (body: Partial<Personality> & { name: string }) =>
    request<Personality>('/personalities', { method: 'POST', body }),
  updatePersonality: (id: string, body: Partial<Personality> & { name: string }) =>
    request<Personality>(`/personalities/${id}`, { method: 'PATCH', body }),
  // Restore a built-in personality (e.g. Sox) to the version shipped in code.
  resetPersonality: (id: string) => request<Personality>(`/personalities/${id}/reset`, { method: 'POST' }),
  deletePersonality: (id: string) => request<{ ok: true }>(`/personalities/${id}`, { method: 'DELETE' }),
  // What a character remembers about the user (active profile). Read-only here;
  // the chat evolves it automatically.
  getCharacterMemory: (id: string) => request<CharacterMemoryView>(`/personalities/${id}/memory`),
  clearCharacterMemory: (id: string) =>
    request<{ ok: true }>(`/personalities/${id}/memory`, { method: 'DELETE' }),
  // Which personality drives the copilot chat.
  getCopilot: () => request<CopilotConfig>('/copilot'),
  setCopilotPersonality: (personalityId: string) =>
    request<CopilotConfig>('/copilot', { method: 'PUT', body: { personalityId } }),
  getTemplates: () => request<Template[]>('/templates'),

  // Profiles — each has its own isolated memory and resume sessions.
  getProfiles: () => request<ProfilesView>('/profiles'),
  createProfile: (name: string) => request<ProfilesView>('/profiles', { method: 'POST', body: { name } }),
  activateProfile: (id: string) => request<ProfilesView>(`/profiles/${id}/activate`, { method: 'POST' }),
  renameProfile: (id: string, name: string) => request<Profile>(`/profiles/${id}`, { method: 'PATCH', body: { name } }),
  deleteProfile: (id: string) => request<ProfilesView>(`/profiles/${id}`, { method: 'DELETE' }),

  // Editable system prompts
  getPrompts: () => request<PromptView[]>('/prompts'),
  savePrompt: (key: string, value: string) =>
    request<PromptView>(`/prompts/${key}`, { method: 'PUT', body: { value } }),
  resetPrompt: (key: string) => request<PromptView>(`/prompts/${key}`, { method: 'DELETE' }),

  // Memory
  getMemoryMessages: () => request<MemoryMessage[]>('/memory/messages'),
  sendMemoryMessage: (content: string, personalityId: string) =>
    request<MemoryMessage>('/memory/messages', { method: 'POST', body: { content, personalityId } }),
  // Streaming send: `onDelta` receives the reply text as it is generated, and
  // `handlers.onStatus` receives the agent's live "thinking"/tool status so the
  // chat can show its working process.
  sendMemoryMessageStream: (
    content: string,
    personalityId: string,
    onDelta: (text: string) => void,
    handlers: StreamHandlers = {},
    signal?: AbortSignal
  ) => streamRequest<MemoryMessage>('/memory/messages/stream', { content, personalityId }, onDelta, handlers, signal),
  clearMemoryMessages: () => request<{ ok: true }>('/memory/messages', { method: 'DELETE' }),
  // Fold any un-reflected tail of the copilot chat into the character's memory.
  // Fired when leaving the copilot chat for a job-hunt session.
  flushCharacterReflection: () => request<{ ok: true }>('/memory/flush-reflection', { method: 'POST' }),
  proposeMemory: () => request<{ items: MemoryProposal[] }>('/memory/propose', { method: 'POST' }),
  getMemoryItems: () => request<MemoryItem[]>('/memory/items'),
  saveMemoryItems: (items: MemoryProposal[]) =>
    request<MemoryItem[]>('/memory/items', { method: 'POST', body: { items } }),
  updateMemoryItem: (id: string, fields: MemoryItemFields) =>
    request<MemoryItem>(`/memory/items/${id}`, { method: 'PATCH', body: fields }),
  deleteMemoryItem: (id: string) => request<{ ok: true }>(`/memory/items/${id}`, { method: 'DELETE' }),

  // Resume sessions
  getSessions: () => request<ResumeSession[]>('/sessions'),
  createSession: (body: CreateSessionInput) => request<ResumeSession>('/sessions', { method: 'POST', body }),
  getSession: (id: string) => request<ResumeSession>(`/sessions/${id}`),
  updateSession: (id: string, fields: Partial<ResumeSession>) =>
    request<ResumeSession>(`/sessions/${id}`, { method: 'PATCH', body: fields }),
  deleteSession: (id: string) => request<{ ok: true }>(`/sessions/${id}`, { method: 'DELETE' }),

  getSessionMessages: (id: string) => request<ResumeMessage[]>(`/sessions/${id}/messages`),
  sendSessionMessage: (id: string, content: string, approvedCalls: string[] = []) =>
    request<ResumeMessage>(`/sessions/${id}/messages`, { method: 'POST', body: { content, approvedCalls } }),
  // Streaming send: `onDelta` receives the reply text as it is generated. Canvas
  // (resume-edit) turns can't stream, so they arrive whole with no deltas.
  // `approvedCalls` carries one-turn approval tokens for previously-refused calls;
  // `handlers` receives live plan/status/steer-ack events during the turn.
  sendSessionMessageStream: (
    id: string,
    content: string,
    onDelta: (text: string) => void,
    approvedCalls: string[] = [],
    handlers: StreamHandlers = {},
    signal?: AbortSignal
  ) => streamRequest<ResumeMessage>(`/sessions/${id}/messages/stream`, { content, approvedCalls }, onDelta, handlers, signal),
  // Steer the in-flight run for a session: queue a message the agent folds in at
  // its next step. 409 when no run is active (the caller sends a normal turn instead).
  steerSession: (id: string, content: string) =>
    request<{ queued: boolean }>(`/sessions/${id}/steer`, { method: 'POST', body: { content } }),

  // Workspace documents — the living artifacts Sox maintains per session.
  getDocuments: (id: string) => request<SessionDocument[]>(`/sessions/${id}/documents`),
  createDocument: (id: string, body: { title: string; content?: string }) =>
    request<SessionDocument>(`/sessions/${id}/documents`, { method: 'POST', body }),
  updateDocument: (docId: string, body: { title?: string; content?: string }) =>
    request<SessionDocument>(`/documents/${docId}`, { method: 'PATCH', body }),
  deleteDocument: (docId: string) => request<{ ok: true }>(`/documents/${docId}`, { method: 'DELETE' }),

  analyzeJob: (id: string) => request<ResumeSession['analysis']>(`/sessions/${id}/analyze`, { method: 'POST' }),
  generateDraft: (id: string, templateId?: string) =>
    request<ResumeVersion>(`/sessions/${id}/draft`, { method: 'POST', body: { templateId } }),
  markFinal: (id: string, versionId: string) =>
    request<ResumeVersion>(`/sessions/${id}/final`, { method: 'POST', body: { versionId } }),

  getVersions: (id: string) => request<ResumeVersion[]>(`/sessions/${id}/versions`),
  setTemplate: (versionId: string, templateId: string) =>
    request<ResumeVersion>(`/versions/${versionId}/template`, { method: 'PATCH', body: { templateId } }),
  exportUrl: (versionId: string, templateId?: string) =>
    `${BASE}/versions/${versionId}/export${templateId ? `?template=${templateId}` : ''}`,
  // Inline PDF for the live preview — same bytes as export, so what you see is
  // exactly what downloads. The template in the query busts the iframe cache.
  previewUrl: (versionId: string, templateId: string) =>
    `${BASE}/versions/${versionId}/preview?template=${templateId}`,

  // ATS score analyzer — standalone, stateless.
  analyzeATS: (body: { resume: string; jobDescription: string }) =>
    request<ATSReport>('/ats/analyze', { method: 'POST', body }),

  // MCP servers — the tools the chat agent can use.
  getMcpServers: () => request<McpServerView[]>('/mcp/servers'),
  getMcpCatalog: () => request<McpCatalogEntry[]>('/mcp/catalog'),
  addMcpServer: (body: McpServerInput) => request<McpServerView>('/mcp/servers', { method: 'POST', body }),
  importMcpConfig: (config: string) =>
    request<{ added: number; errors: string[] }>('/mcp/import', { method: 'POST', body: { config } }),
  updateMcpServer: (id: string, body: McpServerInput) =>
    request<McpServerView>(`/mcp/servers/${id}`, { method: 'PATCH', body }),
  deleteMcpServer: (id: string) => request<{ ok: true }>(`/mcp/servers/${id}`, { method: 'DELETE' }),
  testMcpServer: (id: string) => request<McpServerStatus>(`/mcp/servers/${id}/test`, { method: 'POST' })
};
