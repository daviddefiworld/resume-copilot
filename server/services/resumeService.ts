import { randomUUID } from 'crypto';
import { resumeRepository } from '../repositories/resumeRepository.ts';
import type { RawSession, RawVersion } from '../repositories/resumeRepository.ts';
import { openRouter } from './openRouterService.ts';
import { agentRunner } from './agentRunner.ts';
import { settingsService } from './settingsService.ts';
import { memoryService } from './memoryService.ts';
import { profileService } from './profileService.ts';
import { getPersonality } from '../data/personalities.ts';
import { getTemplate } from '../data/templates.ts';
import {
  jobAnalysisPrompt,
  jobTargetExtractionPrompt,
  resumeCanvasTurnSystem,
  resumeChatSystem,
  resumeDraftPrompt
} from './prompts.ts';
import type {
  ChatRole,
  JobAnalysis,
  ResumeContent,
  ResumeDraft,
  ResumeMessage,
  ResumeSession,
  ResumeStrategy,
  ResumeVersion,
  ToolTraceEntry
} from '../../shared/types.ts';

export interface NewSessionInput {
  title?: string;
  initial_message?: string;
  personality_id?: string;
  company_name?: string;
  job_title?: string;
  job_description?: string;
  location?: string;
  company_notes?: string;
}

type TargetFields = Partial<Pick<ResumeSession,
  'title' | 'personality_id' | 'company_name' | 'job_title' | 'job_description' | 'location' | 'company_notes'>>;

interface TargetExtract {
  company_name: string;
  job_title: string;
  location: string;
  job_description: string;
  company_notes: string;
}

class ResumeTitle {
  static fromInitialMessage(message: string): string {
    const normalized = message
      .replace(/\s+/g, ' ')
      .replace(/^#+\s*/, '')
      .trim();
    if (!normalized) return 'Untitled role';

    const sentence = normalized.split(/[.!?\n]/).find(Boolean) ?? normalized;
    const title = sentence
      .replace(/^(i\s+am\s+applying\s+(for|to)|applying\s+(for|to)|job\s+description\s*:)\s+/i, '')
      .trim();
    return title.length > 48 ? `${title.slice(0, 45).trim()}...` : title;
  }
}

// One canvas chat turn: a reply, plus an optional resume edit.
interface CanvasTurn {
  reply?: string;
  edited?: boolean;
  content?: ResumeContent;
  strategy?: ResumeStrategy;
}

// The assistant message that accompanies a freshly generated draft. The strategy
// lives in the chat (canvas-style), not on the document panel.
function draftSummary(version: ResumeVersion): string {
  const s = version.strategy;
  const parts: string[] = [`**Here's your tailored resume — version ${version.version_number}.** It's open on the right.`];
  if (s.positioning) parts.push(s.positioning);
  if (s.emphasizedEvidence?.length) parts.push(`**Emphasized:** ${s.emphasizedEvidence.join('; ')}`);
  if (s.missingSignals?.length) parts.push(`**Worth adding:** ${s.missingSignals.join('; ')}`);
  parts.push('Tell me what to change — e.g. *“tighten the summary”* or *“add more on the API work”* — and I\'ll update it here.');
  return parts.join('\n\n');
}

// Target-specific resume work: sessions, their chat, job analysis, and the
// structured resume versions. Reads memory but never writes it. Hydrates raw
// repository rows into domain shapes and delegates AI work to OpenRouter.
class ResumeService {
  // ---- Sessions / job target ----

  createSession(input: NewSessionInput): ResumeSession {
    const profileId = profileService.activeId();
    if (!profileId) throw new Error('Create a profile first.');
    const initialTitle = ResumeTitle.fromInitialMessage(String(input.initial_message || ''));
    const session = {
      id: randomUUID(),
      profile_id: profileId,
      title: String(input.title || input.job_title || initialTitle).trim(),
      personality_id: input.personality_id || 'strategic_minimalist',
      company_name: String(input.company_name || '').trim(),
      job_title: String(input.job_title || '').trim(),
      job_description: String(input.job_description || '').trim(),
      location: String(input.location || '').trim(),
      company_notes: String(input.company_notes || '').trim(),
      created_at: new Date().toISOString()
    };
    resumeRepository.insertSession(session);
    return this.getSession(session.id);
  }

  listSessions(): ResumeSession[] {
    const profileId = profileService.activeId();
    if (!profileId) return [];
    return resumeRepository.listSessions(profileId).map((s) => this.hydrateSession(s));
  }

  getSession(id: string): ResumeSession {
    const session = resumeRepository.getSession(id);
    if (!session) throw new Error('Resume session not found.');
    return this.hydrateSession(session);
  }

  updateTarget(id: string, fields: TargetFields): ResumeSession {
    const s = resumeRepository.getSession(id);
    if (!s) throw new Error('Resume session not found.');
    resumeRepository.updateSession({
      id,
      profile_id: s.profile_id,
      title: fields.title ?? s.title,
      personality_id: fields.personality_id ?? s.personality_id,
      company_name: fields.company_name ?? s.company_name,
      job_title: fields.job_title ?? s.job_title,
      job_description: fields.job_description ?? s.job_description,
      location: fields.location ?? s.location,
      company_notes: fields.company_notes ?? s.company_notes,
      created_at: s.created_at
    });
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    resumeRepository.deleteSession(id);
  }

  private hydrateSession(session: RawSession): ResumeSession {
    return { ...session, analysis: session.analysis ? (JSON.parse(session.analysis) as JobAnalysis) : null };
  }

  // ---- Resume chat ----

  listMessages(sessionId: string): ResumeMessage[] {
    return resumeRepository.listMessages(sessionId);
  }

  async sendMessage(sessionId: string, content: string): Promise<ResumeMessage> {
    const session = this.getSession(sessionId);
    const text = String(content || '').trim();
    if (!text) throw new Error('Message is required.');

    this.appendMessage(sessionId, 'user', text);

    const personality = getPersonality(session.personality_id);
    const memory = memoryService.buildMemoryText(session.profile_id || profileService.activeId() || '');
    const history = this.listMessages(sessionId).map((m) => ({ role: m.role, content: m.content }));
    const latest = resumeRepository.getLatestVersion(sessionId);

    // No draft yet → plain conversation (asks for the job, then the company).
    // Runs as an agent so installed MCP tools are available while scoping the
    // role (e.g. researching the company); the step prompt is unchanged.
    if (!latest) {
      const result = await agentRunner.run([
        { role: 'system', content: resumeChatSystem({ personality, target: session, hasMemory: Boolean(memory) }) },
        ...history
      ]);
      return this.appendMessage(sessionId, 'assistant', result.content, result.trace);
    }

    // Canvas mode: a draft is open. The same chat both answers questions and
    // edits the resume when asked, updating the canvas as a side effect.
    const current: ResumeDraft = {
      content: JSON.parse(latest.content) as ResumeContent,
      strategy: JSON.parse(latest.strategy) as ResumeStrategy
    };
    // The structured edit turn stays tool-free: editing the resume needs strict
    // JSON, and resume content must come only from confirmed memory.
    try {
      const turn = await openRouter.json<CanvasTurn>(
        [{ role: 'system', content: resumeCanvasTurnSystem({ personality, current, memory }) }, ...history],
        { model: settingsService.finalModel() }
      );
      const reply = (turn.reply || 'Done.').trim();
      if (turn.edited && turn.content) {
        this.saveVersion(sessionId, { content: turn.content, strategy: turn.strategy ?? current.strategy }, latest.template_id);
      }
      return this.appendMessage(sessionId, 'assistant', reply);
    } catch {
      // If the structured turn fails, fall back to a plain conversational reply,
      // which may use MCP tools to answer the user's question.
      const result = await agentRunner.run([
        { role: 'system', content: resumeChatSystem({ personality, target: session, hasMemory: Boolean(memory) }) },
        ...history
      ]);
      return this.appendMessage(sessionId, 'assistant', result.content, result.trace);
    }
  }

  private appendMessage(sessionId: string, role: ChatRole, content: string, trace?: ToolTraceEntry[]): ResumeMessage {
    const message: ResumeMessage = {
      id: randomUUID(),
      session_id: sessionId,
      role,
      content,
      created_at: new Date().toISOString(),
      tool_trace: trace
    };
    resumeRepository.appendMessage(message);
    return message;
  }

  // ---- Job analysis ----

  // Pull the target job out of the session conversation and save it. The user
  // gives the job in plain chat, so we read it back from the transcript rather
  // than from a form. Existing fields win over blanks the model returns.
  async extractTarget(sessionId: string): Promise<ResumeSession> {
    const session = this.getSession(sessionId);
    const messages = resumeRepository.listMessages(sessionId);
    if (messages.length === 0) return session;

    const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const t = await openRouter.json<Partial<TargetExtract>>(jobTargetExtractionPrompt(transcript));
    const pick = (next: string | undefined, current: string) => (next?.trim() ? next.trim() : current);

    return this.updateTarget(sessionId, {
      company_name: pick(t.company_name, session.company_name),
      job_title: pick(t.job_title, session.job_title),
      location: pick(t.location, session.location),
      job_description: pick(t.job_description, session.job_description),
      company_notes: pick(t.company_notes, session.company_notes),
      title: pick(t.job_title, session.job_title) || session.title
    });
  }

  async analyzeJob(sessionId: string): Promise<JobAnalysis> {
    let session = this.getSession(sessionId);
    if (!session.job_description) session = await this.extractTarget(sessionId);
    if (!session.job_description) {
      throw new Error('Tell me about the job first — paste the job description in the chat, then try again.');
    }
    const analysis = await openRouter.json<JobAnalysis>(jobAnalysisPrompt(session));
    resumeRepository.setAnalysis(sessionId, JSON.stringify(analysis));
    return analysis;
  }

  // ---- Resume drafts ----

  async generateDraft(sessionId: string, templateId?: string): Promise<ResumeVersion> {
    let session = this.getSession(sessionId);
    // Build from the session's OWN profile, not necessarily the active one, so a
    // resume always reflects the profile it was created under.
    const profileId = session.profile_id || profileService.activeId();
    const memory = profileId ? memoryService.buildMemoryText(profileId) : '';
    if (!memory) {
      throw new Error('No saved memory yet. Tell Sox about your background in the Copilot chat first.');
    }

    if (!session.analysis) {
      await this.analyzeJob(sessionId);
      session = this.getSession(sessionId); // refresh with the extracted target + analysis
    }
    const personality = getPersonality(session.personality_id);
    // The resume content itself uses the final-resume model (falls back to primary).
    const draft = await openRouter.json<ResumeDraft>(
      resumeDraftPrompt({ personality, analysis: session.analysis as JobAnalysis, memory, target: session }),
      { model: settingsService.finalModel() }
    );
    const version = this.saveVersion(sessionId, draft, getTemplate(templateId).id);

    // Surface the draft as a chat exchange so the session stays one conversation:
    // a user-style request and Sox's strategy reply. The resume itself is the canvas.
    this.appendMessage(sessionId, 'user', 'Generate a resume tailored to this role.');
    this.appendMessage(sessionId, 'assistant', draftSummary(version));
    return version;
  }

  private saveVersion(sessionId: string, draft: ResumeDraft, templateId = 'classic_ats'): ResumeVersion {
    const previous = resumeRepository.getLatestVersion(sessionId);
    const id = randomUUID();
    resumeRepository.insertVersion({
      id,
      session_id: sessionId,
      version_number: previous ? previous.version_number + 1 : 1,
      template_id: previous ? previous.template_id : templateId,
      content: JSON.stringify(draft.content || {}),
      strategy: JSON.stringify(draft.strategy || {}),
      created_at: new Date().toISOString()
    });
    return this.getVersion(id);
  }

  listVersions(sessionId: string): ResumeVersion[] {
    return resumeRepository.listVersions(sessionId).map((v) => this.hydrateVersion(v));
  }

  getVersion(id: string): ResumeVersion {
    const v = resumeRepository.getVersion(id);
    if (!v) throw new Error('Resume version not found.');
    return this.hydrateVersion(v);
  }

  private hydrateVersion(v: RawVersion): ResumeVersion {
    return {
      ...v,
      is_final: Boolean(v.is_final),
      content: JSON.parse(v.content) as ResumeContent,
      strategy: JSON.parse(v.strategy) as ResumeStrategy
    };
  }

  setTemplate(versionId: string, templateId: string): ResumeVersion {
    if (!resumeRepository.getVersion(versionId)) throw new Error('Resume version not found.');
    resumeRepository.setTemplate(versionId, templateId);
    return this.getVersion(versionId);
  }

  markFinal(sessionId: string, versionId: string): ResumeVersion {
    if (!resumeRepository.getVersion(versionId)) throw new Error('Resume version not found.');
    resumeRepository.markFinal(sessionId, versionId);
    return this.getVersion(versionId);
  }
}

export const resumeService = new ResumeService();
