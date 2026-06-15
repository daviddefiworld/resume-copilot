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

// Transport-level failures worth retrying: the request never reached our route
// handler, so re-sending on a fresh connection is safe (even for POSTs). A
// genuine app error (our handlers return 400) is NOT retried. 503 is what the
// Vite proxy now returns when its upstream socket drops; 502/504 cover other
// gateway hiccups.
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  // Built once; body is an already-serialized string, so it's safe to reuse
  // across retry attempts.
  const options: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, options);
    } catch (error) {
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
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await wait(attempt * 150);
        continue;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return response.json() as Promise<T>;
  }
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
  clearMemoryMessages: () => request<{ ok: true }>('/memory/messages', { method: 'DELETE' }),
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
  sendSessionMessage: (id: string, content: string) =>
    request<ResumeMessage>(`/sessions/${id}/messages`, { method: 'POST', body: { content } }),

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
