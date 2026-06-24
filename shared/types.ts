// Domain types shared by the backend and the frontend. Type-only — this file
// has no runtime exports, so every import of it must use `import type`.

export type Confidence = 'confirmed' | 'unverified';

export type MemoryCategory =
  | 'contact_details' | 'profile_summary' | 'work_experience' | 'projects' | 'skills' | 'education'
  | 'certifications' | 'achievements' | 'career_goals' | 'role_preferences'
  | 'company_preferences' | 'constraints' | 'writing_preferences' | 'sensitive_exclusions';

// 'tool' is only used in-flight during an agent loop (a tool-result message sent
// back to the model). Persisted messages are always 'user' or 'assistant'.
export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

// One tool call the model decided to make (OpenAI/OpenRouter function-calling
// shape). `arguments` is a JSON string the model produced.
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  // Present on an assistant message that is requesting tool calls, and echoed
  // back unchanged so the model can match results to its requests.
  tool_calls?: ToolCall[];
  // Set on a 'tool' message: which tool call this result answers, and its name.
  tool_call_id?: string;
  name?: string;
}

// One selectable answer the agent offers for a quick-pick question. `label` is
// the text both shown on the chip and sent back as the user's reply when picked;
// `description` is an optional one-line hint under it.
export interface AgentQuestionOption {
  label: string;
  description?: string;
}

// A structured "choose an answer" the agent embeds in its reply as a fenced
// ```ask block. The chat parses it out of the prose and renders it as a
// select-card (clickable chips + a free-text "Other" field) so the user can
// answer in one click. Purely a UI affordance — the chosen label is sent back as
// an ordinary user message, so nothing else in the pipeline needs to know about it.
export interface AgentQuestion {
  question: string;
  // A very short chip label for the card (e.g. "Role", "Timezone"). Optional.
  header?: string;
  // When true the user can pick several options before sending; default single-pick.
  multiSelect?: boolean;
  options: AgentQuestionOption[];
}

// A structured "start a job hunt" the copilot embeds in its reply as a fenced
// ```session block when the conversation turns to one specific opportunity. The
// chat parses it out of the prose and renders an action card whose button opens a
// dedicated job-hunt session seeded with `kickoff` as its first message — so the
// focused work on one role lives in its own workspace, not the companion chat.
export interface SessionSuggestion {
  // The session label, usually "Company — Role".
  title: string;
  // The first message to seed the new session with, written in the user's voice
  // (the role, the company, and any job description gathered so far) so the new
  // workspace starts warm instead of from scratch.
  kickoff: string;
  // An optional one-line nudge shown on the card under the title.
  note?: string;
  // The concrete job/company identity the copilot already gathered, carried into
  // the new session so it starts with the target known instead of re-deriving it
  // from the kickoff prose. All optional — included only when actually known.
  company?: string;
  role?: string;
  location?: string;
  jobDescription?: string;
  // A posting or company URL, if the copilot found one.
  link?: string;
}

// One step in the agent's live "working process" for the current turn — what it
// is doing right now (thinking, or running a named tool), shown in the pending
// bubble so the user can watch it work. Built on the client from the run's
// `status` events and discarded when the turn lands; never persisted.
export interface AgentActivity {
  // Stable per-turn ordinal, used as the React key.
  id: number;
  // Human label, e.g. "Thinking" or "Using web_search".
  label: string;
  // True once a later step has started — done steps show a tick, the last is live.
  done: boolean;
  // The tool this step is running, when it's a tool step (absent for "Thinking").
  // Lets the UI tell an in-flight tool call apart from the model writing prose.
  tool?: string;
}

// An OpenAI/OpenRouter-style function tool exposed to the model. `parameters`
// is the tool's JSON Schema (an MCP tool's inputSchema maps straight onto it).
export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  tone: string;
  critiqueIntensity: string;
  reasoningStyle: string;
  resumeBias: string;
  // True for the built-in presets shipped with the app; false/absent for
  // personalities the user created. Only custom ones can be edited or deleted.
  builtin?: boolean;
  // Which fictional AI copilot (or none) the preset is modelled on — shown as a
  // small caption in the picker. Purely cosmetic.
  inspiration?: string;
  // A deep characterization woven into the chat system prompt: who this
  // character is, how they see the world, and how they relate to the user — so
  // they read as a real personality with a point of view, not a generic bot.
  // Optional; custom personalities lean on tone/reasoning instead. Like every
  // other personality field, essence shapes VOICE only, never the guardrails.
  essence?: string;
  // The character's personal pledge to the user, in their own voice — the same
  // shared mission (land a great remote software-development job) stated the way
  // THIS character would. Shown in the chat greeting and the picker, and woven
  // into the prompt so the copilot reads as a committed ally, not a Q&A bot.
  mission?: string;
  // Visual identity, so the copilot's brand mark and chat avatar take on the
  // personality's feel. `icon` is a key into the frontend icon registry (e.g.
  // 'cat', 'shield'); `accent` is a hex colour used for the mark's gradient.
  // Both optional — the UI falls back to a default robot + a colour from the id.
  icon?: string;
  accent?: string;
  // Optional avatar image — a path like '/personalities/sox.webp' or a URL.
  // When set it renders in place of `icon` everywhere the mark shows; a failed
  // load falls back to the icon. Built-ins ship images under /personalities.
  image?: string;
}

// The user's copilot configuration: which personality drives the main chat.
export interface CopilotConfig {
  personalityId: string;
}

// What a single character has come to know, for the active profile. `notes` is
// the character's own evolving sense of the user (durable across chat
// restarts); `summary` is a running recap of the current conversation (reset
// when the chat is restarted). Surfaced read-only in Settings → Personality.
export interface CharacterMemoryView {
  personalityId: string;
  notes: string;
  summary: string;
  messageCount: number;
  updatedAt: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  accent: string;
  nameSize: number;
  headingSize: number;
  bodySize: number;
  headingCase: 'upper' | 'title';
  rule: boolean;
  sectionOrder: ResumeSectionKey[];
  // Optional layout/typography knobs. Absent means the single-column sans-serif
  // default, so existing templates need no changes.
  layout?: 'single' | 'sidebar';
  font?: 'sans' | 'serif';
  // For the sidebar layout: which sections live in the left rail. Everything
  // else (plus the name header) renders in the main column.
  sidebarSections?: ResumeSectionKey[];
}

export type ResumeSectionKey = 'summary' | 'skills' | 'experience' | 'projects' | 'education';

// ---- Persisted records ----

// A named identity with its own isolated memory and resume sessions. Switching
// the active profile swaps the entire memory + resume world the app works with.
export interface Profile {
  id: string;
  name: string;
  created_at: string;
}

export interface ProfilesView {
  profiles: Profile[];
  activeId: string | null;
}

export interface MemoryMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  // Tool calls the agent made while producing this message (assistant only).
  tool_trace?: ToolTraceEntry[];
}

export interface MemoryItem {
  id: string;
  category: MemoryCategory | string;
  title: string;
  content: string;
  confidence: Confidence;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResumeMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  // Tool calls the agent made while producing this message (assistant only).
  tool_trace?: ToolTraceEntry[];
}

// A living workspace artifact for one job-hunt session — company notes, role
// detail, key people, an outreach log, next steps, etc. The agent decides what
// documents to keep (their titles are free-form) and maintains them with its
// document tools; the user can also view, edit, and delete them in the sidebar.
export interface SessionDocument {
  id: string;
  session_id: string;
  title: string;
  content: string; // Markdown
  created_at: string;
  updated_at: string;
}

export interface ResumeSession {
  id: string;
  profile_id: string;
  title: string;
  personality_id: string;
  company_name: string;
  job_title: string;
  job_description: string;
  location: string;
  company_notes: string;
  analysis: JobAnalysis | null;
  created_at: string;
}

export interface JobAnalysis {
  mustHaves: string[];
  niceToHaves: string[];
  coreResponsibilities: string[];
  keywords: string[];
  companySignals: string[];
  hiringIntent: string;
}

// ---- Structured resume content ----

export interface ResumeContact {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
}

export interface ResumeExperience {
  role: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface ResumeProject {
  name: string;
  description: string;
  bullets: string[];
}

export interface ResumeEducation {
  credential: string;
  institution: string;
  period: string;
}

export interface ResumeContent {
  contact?: ResumeContact;
  headline?: string;
  summary?: string;
  skills?: string[];
  experience?: ResumeExperience[];
  projects?: ResumeProject[];
  education?: ResumeEducation[];
}

export interface ResumeStrategy {
  positioning: string;
  emphasizedEvidence: string[];
  reducedEvidence: string[];
  missingSignals: string[];
}

export interface ResumeDraft {
  content: ResumeContent;
  strategy: ResumeStrategy;
}

export interface ResumeVersion {
  id: string;
  session_id: string;
  version_number: number;
  template_id: string;
  content: ResumeContent;
  strategy: ResumeStrategy;
  is_final: boolean;
  created_at: string;
}

export interface SettingsView {
  hasApiKey: boolean;
  // Primary model: used for chat, job extraction, and analysis.
  model: string;
  // Optional second model: used to produce the final resume (draft + revision).
  // Blank means "use the primary model".
  model2: string;
}

// Running totals of OpenRouter API consumption, shown in Settings → General.
// `cost` is the actual USD OpenRouter reported across all calls; `updatedAt` is
// the ISO time of the most recent recorded call (null when nothing tracked yet).
export interface UsageView {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
  updatedAt: string | null;
}

export interface MemoryProposal {
  // 'update' overwrites the existing item named by `id`; 'new' (or absent)
  // inserts a fresh item.
  action?: 'new' | 'update';
  id?: string;
  category: string;
  title: string;
  content: string;
  confidence: Confidence;
  sourceMessageId?: string | null;
}

// ---- ATS score analyzer ----

export type ATSBand = 'strong' | 'moderate' | 'weak' | 'poor';
export type ATSImportance = 'critical' | 'high' | 'normal';

// One scored dimension of the match. `weight` is its fixed contribution to the
// overall score (the server owns the weights, not the model), `score` is 0–100.
export interface ATSCategory {
  key: string;
  label: string;
  weight: number;
  score: number;
  notes: string;
}

// A keyword/skill the job calls for, and whether it literally appears in the
// resume. Real ATS matching is literal — "implied" does not count.
export interface ATSKeywordHit {
  term: string;
  present: boolean;
  importance: ATSImportance;
}

// A hard, gating requirement from the job (years, degree, certification) and
// whether the resume satisfies it.
export interface ATSRequirement {
  requirement: string;
  met: boolean;
  evidence: string;
}

export interface ATSReport {
  overallScore: number; // 0–100, weighted from the categories (computed server-side)
  band: ATSBand;
  verdict: string;
  categories: ATSCategory[];
  keywords: ATSKeywordHit[];
  requirements: ATSRequirement[];
  recommendations: string[];
}

// One editable system prompt, as exposed to the Settings → Prompts tab.
export interface PromptView {
  key: string;
  label: string;
  description: string;
  tokens: string[];
  value: string;
  isDefault: boolean;
}

// ---- MCP servers & agent tools ----

// How the app reaches an MCP server. 'stdio' spawns a local process
// (command/args/env); 'http' connects to a remote Streamable HTTP (or SSE) URL.
export type McpTransport = 'stdio' | 'http';

// A configured MCP server. Only the fields for its transport are meaningful.
export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;                  // stdio: the executable, e.g. "npx"
  args: string[];                   // stdio: its arguments
  env: Record<string, string>;      // stdio: extra environment variables
  url: string;                      // http: the server endpoint
  headers: Record<string, string>; // http: auth/other headers
  enabled: boolean;
  created_at: string;
}

// What the app knows about a server's live connection. Refreshed whenever the
// agent connects to it or the user clicks "Test".
export interface McpServerStatus {
  connected: boolean;
  toolCount: number;
  tools: string[];
  error: string | null;
  // Server-level usage guidance returned on `initialize` (the MCP `instructions`
  // field). A server uses it to teach a generic client how to use its tools
  // together; we forward it to the model. null when the server sends none, or
  // before the first successful connect.
  instructions: string | null;
}

export interface McpServerView extends McpServer {
  status: McpServerStatus;
}

// The payload for creating or updating a server (no id/status/timestamps).
export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

// A value the user must supply before a catalog server works (an API key, a
// path). 'env' sets an environment variable; 'arg' appends a positional arg.
export interface McpCatalogField {
  key: string;
  label: string;
  placeholder?: string;
  target: 'env' | 'arg';
}

// A one-click installable server in the built-in catalog.
export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requires?: McpCatalogField[];
  docsUrl?: string;
}

// One tool invocation the agent made during a turn, surfaced inline in chat so
// the user can see what the agent did.
export interface ToolTraceEntry {
  server: string;
  tool: string;
  args: unknown;
  // The readable result text (content blocks + structured data, flattened).
  result: string;
  // The COMPLETE raw response object, pretty-printed JSON — every field the tool
  // returned (all content blocks, structuredContent, metadata, errors), not just
  // the flattened text. Shown in chat so the full data is visible. MCP calls only;
  // absent for local/workspace tools (their result is whole).
  raw?: string;
  ok: boolean;
}

// A job-hunt handoff requested from outside the app (the Lazybidder dashboard's
// "Apply with Copilot" button). Parked by the fixed-port integration bridge and
// picked up by the renderer, which opens a workspace seeded with `message`.
export interface IntegrationIntent {
  job_id: string;
  // The kickoff message the new session opens with, e.g.
  // "I wanna apply this job with jobid <job_id>".
  message: string;
  created_at: string;
}
