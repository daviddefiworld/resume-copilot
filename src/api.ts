import type {
  MemoryItem,
  MemoryMessage,
  MemoryProposal,
  Personality,
  PromptView,
  ResumeMessage,
  ResumeSession,
  ResumeVersion,
  SettingsView,
  Template
} from '../shared/types.ts';

// Single client for the backend API. The frontend never talks to OpenRouter
// directly and never holds the API key.
const BASE = '/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  const options: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, options);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
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
  getTemplates: () => request<Template[]>('/templates'),

  // Editable system prompts
  getPrompts: () => request<PromptView[]>('/prompts'),
  savePrompt: (key: string, value: string) =>
    request<PromptView>(`/prompts/${key}`, { method: 'PUT', body: { value } }),
  resetPrompt: (key: string) => request<PromptView>(`/prompts/${key}`, { method: 'DELETE' }),

  // Memory
  getMemoryMessages: () => request<MemoryMessage[]>('/memory/messages'),
  sendMemoryMessage: (content: string, personalityId: string) =>
    request<MemoryMessage>('/memory/messages', { method: 'POST', body: { content, personalityId } }),
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
  generateDraft: (id: string) => request<ResumeVersion>(`/sessions/${id}/draft`, { method: 'POST' }),
  markFinal: (id: string, versionId: string) =>
    request<ResumeVersion>(`/sessions/${id}/final`, { method: 'POST', body: { versionId } }),

  getVersions: (id: string) => request<ResumeVersion[]>(`/sessions/${id}/versions`),
  setTemplate: (versionId: string, templateId: string) =>
    request<ResumeVersion>(`/versions/${versionId}/template`, { method: 'PATCH', body: { templateId } }),
  exportUrl: (versionId: string, templateId?: string) =>
    `${BASE}/versions/${versionId}/export${templateId ? `?template=${templateId}` : ''}`
};
