// Domain types shared by the backend and the frontend. Type-only — this file
// has no runtime exports, so every import of it must use `import type`.

export type Confidence = 'confirmed' | 'unverified';

export type MemoryCategory =
  | 'contact_details' | 'profile_summary' | 'work_experience' | 'projects' | 'skills' | 'education'
  | 'certifications' | 'achievements' | 'career_goals' | 'role_preferences'
  | 'company_preferences' | 'constraints' | 'writing_preferences' | 'sensitive_exclusions';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  tone: string;
  critiqueIntensity: string;
  reasoningStyle: string;
  resumeBias: string;
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

export interface MemoryMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
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
}

export interface ResumeSession {
  id: string;
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
