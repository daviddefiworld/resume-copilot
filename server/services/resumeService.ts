import { randomUUID } from 'crypto';
import { resumeRepository } from '../repositories/resumeRepository.ts';
import type { RawSession, RawVersion } from '../repositories/resumeRepository.ts';
import { openRouter } from './openRouterService.ts';
import type { StreamDelta } from './openRouterService.ts';
import { agentRunner, historyWithToolContext } from './agentRunner.ts';
import type { AgentResult, LocalTool } from './agentRunner.ts';
import { documentService } from './documentService.ts';
import { runRegistry } from './runRegistry.ts';
import type { RunEvent, RunHandle } from './runRegistry.ts';
import { settingsService } from './settingsService.ts';
import { memoryService } from './memoryService.ts';
import { profileService } from './profileService.ts';
import { personalityService } from './personalityService.ts';
import { characterMemoryService } from './characterMemoryService.ts';
import { getTemplate } from '../data/templates.ts';
import {
  jobAnalysisPrompt,
  jobTargetExtractionPrompt,
  resumeCanvasTurnSystem,
  resumeChatSystem,
  resumeDraftPrompt
} from './prompts.ts';
import type {
  ChatMessage,
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

// Whether an OpenRouter failure is a hard transport/timeout/auth error that a
// second attempt won't fix. The canvas turn falls back to a plain agent reply
// only for recoverable JSON/format errors; for these we re-throw so the real
// reason surfaces immediately instead of silently doubling the latency.
function isHardAiFailure(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  // A user stop ('Cancelled') must propagate, not fall back to a fresh agent reply.
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'Cancelled') return true;
  const message = ((error as { message?: string })?.message ?? '').toLowerCase();
  return message.includes('timed out')
    || message.includes('could not reach openrouter')
    || message.includes('api key is not set');
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
      personality_id: input.personality_id || 'sox',
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
    return this.runChat(sessionId, content, () => {}, (messages, localTools, steer) =>
      agentRunner.run(messages, { localTools, steer }));
  }

  // Streaming counterpart: in plain conversation (no draft yet) the reply streams
  // token-by-token through `onDelta`. Canvas mode runs a strict-JSON edit turn
  // that can't be streamed, so its reply lands whole — onDelta is simply never
  // called and the finished message arrives at once. `pushEvent` sends live
  // plan/status/steer_ack events down the open SSE stream.
  async sendMessageStream(
    sessionId: string,
    content: string,
    onDelta: StreamDelta,
    pushEvent: (event: RunEvent) => void = () => {},
    signal?: AbortSignal
  ): Promise<ResumeMessage> {
    return this.runChat(sessionId, content, pushEvent, (messages, localTools, steer) =>
      agentRunner.runStream(messages, { localTools, steer, signal }, onDelta), signal);
  }

  // Queue a steering message onto the session's in-flight run, so the agent folds
  // it in at its next step. Throws a NotRunning error (the controller maps it to a
  // 409, and the client then falls back to a fresh normal turn) when no run is
  // accepting — including during teardown and in canvas mode between drains.
  queueSteer(sessionId: string, content: string): { queued: boolean } {
    const text = String(content || '').trim();
    if (!text) throw new Error('Message is required.');
    const handle = runRegistry.get(sessionId);
    if (!handle || !handle.acceptingSteers) {
      const error = new Error('Sox is not in the middle of a turn for this session.');
      error.name = 'NotRunning';
      throw error;
    }
    handle.enqueue(text);
    return { queued: true };
  }

  private async runChat(
    sessionId: string,
    content: string,
    pushEvent: (event: RunEvent) => void,
    run: (messages: ChatMessage[], localTools: LocalTool[], steer: RunHandle) => Promise<AgentResult>,
    signal?: AbortSignal
  ): Promise<ResumeMessage> {
    const session = this.getSession(sessionId);
    const text = String(content || '').trim();
    if (!text) throw new Error('Message is required.');

    // One monotonic timestamp source for the whole run, so every row this turn
    // writes (the user message, any mid-turn steers, the assistant reply) gets a
    // strictly-increasing created_at — FIFO order then survives reload regardless of
    // clock resolution (ORDER BY created_at ASC).
    let tick = Date.now() - 1;
    const nextTs = (): string => new Date(++tick).toISOString();
    // How many steers were folded in and persisted mid-turn — so the error path
    // knows whether a committed steer would be left without a following assistant.
    let consumedSteers = 0;

    // Register the run BEFORE persisting anything, so a concurrent-run rejection
    // can't leave an orphan user message. persistSteer writes a consumed steer as a
    // role:'user' row (stamped from the same monotonic source); pushEvent rides the
    // open SSE stream.
    const handle = runRegistry.register(sessionId, {
      persistSteer: (steerText) => { consumedSteers++; this.appendMessage(sessionId, 'user', steerText, undefined, nextTs()); },
      pushEvent
    });

    try {
      this.appendMessage(sessionId, 'user', text, undefined, nextTs());

      const personality = personalityService.get(session.personality_id);
      const profileId = session.profile_id || profileService.activeId() || '';
      const memory = memoryService.buildMemoryText(profileId);
      // The character's own evolving memory of this user (durable notes + recap),
      // so the session copilot is as informed and in-character as the Copilot chat.
      const character = characterMemoryService.contextText(profileId, personality.id);
      const history = historyWithToolContext(this.listMessages(sessionId));
      const latest = resumeRepository.getLatestVersion(sessionId);

      // The session's living workspace: a system snapshot of its documents plus the
      // tools Sox uses to maintain them. set_next_steps fires onPlanChange so the
      // "Next Steps" checklist updates live mid-turn over the SSE stream.
      const localTools = documentService.tools(sessionId, (body) => handle.pushEvent({ type: 'plan', body }));
      const workspace: ChatMessage = { role: 'system', content: documentService.promptContext(sessionId) };
      // The durable plan, fed back in so Sox sees and advances its own committed
      // plan each turn instead of relying on lossy chat recap.
      const nextSteps = documentService.nextStepsContext(sessionId);

      // Compute the reply (the agent loop, or a canvas JSON edit), but persist it at
      // the END so the turn-boundary steer handling and timestamp ordering are in one place.
      let reply: { content: string; trace?: ToolTraceEntry[] };
      if (!latest) {
        // No draft yet → plain conversation, run as a steerable agent.
        const result = await run([
          { role: 'system', content: resumeChatSystem({ personality, target: session, memory, character, nextSteps }) },
          workspace,
          ...history
        ], localTools, handle);
        reply = { content: result.content, trace: result.trace };
      } else {
        // Canvas mode: a draft is open. A strict-JSON edit turn (tool-free, not
        // steerable mid-turn — any steer arriving here is deferred to the next turn).
        const current: ResumeDraft = {
          content: JSON.parse(latest.content) as ResumeContent,
          strategy: JSON.parse(latest.strategy) as ResumeStrategy
        };
        try {
          const turn = await openRouter.json<CanvasTurn>(
            [{ role: 'system', content: resumeCanvasTurnSystem({ personality, current, memory, character }) }, ...history],
            { model: settingsService.finalModel(), signal }
          );
          if (turn.edited && turn.content) {
            this.saveVersion(sessionId, { content: turn.content, strategy: turn.strategy ?? current.strategy }, latest.template_id);
          }
          reply = { content: (turn.reply || 'Done.').trim() };
        } catch (error) {
          // A genuine timeout/network/auth failure won't be fixed by re-running.
          if (isHardAiFailure(error)) throw error;
          // A format/JSON hiccup: fall back to a plain conversational (steerable) reply.
          const result = await run([
            { role: 'system', content: resumeChatSystem({ personality, target: session, memory, character, nextSteps }) },
            workspace,
            ...history
          ], localTools, handle);
          reply = { content: result.content, trace: result.trace };
        }
      }

      // End of turn: stop accepting steers and persist the assistant reply. A steer
      // that arrived after the loop's last drain (or during a non-steerable canvas
      // turn) could NOT be folded into this reply — rather than park it as an orphan
      // user row, we signal it `deferred` so the client re-sends it as a fresh turn
      // that actually gets answered.
      handle.acceptingSteers = false;
      // Never persist a reply that claims a document write the trace doesn't back.
      const safeContent = documentService.reconcileClaims(reply.content, reply.trace);
      const assistant = this.appendMessage(sessionId, 'assistant', safeContent, reply.trace, nextTs());
      // Name the session after its company the moment the conversation reveals it.
      // Runs only while the company is still unknown (so it fires early, then stops),
      // and is best-effort so it can never break the turn. The reply text is already
      // on screen via streamed deltas, so this brief extraction is not felt.
      if (!session.company_name.trim()) {
        try { await this.extractTarget(sessionId); } catch { /* session naming is best-effort */ }
      }
      for (const steerText of handle.drain()) {
        handle.pushEvent({ type: 'steer_ack', text: steerText, deferred: true });
      }
      return assistant;
    } catch (error) {
      // The run threw AFTER the loop may have already persisted an in-flight steer
      // (e.g. a hard auth/parse error on the next model call). Write a following
      // assistant row so that committed steer is never left without a reply, then
      // still surface the failure. Only when a steer was actually consumed, so a
      // plain failed turn keeps its existing "no assistant row" behavior.
      handle.acceptingSteers = false;
      // A user stop saves no reply (it was their choice). A genuine failure after a
      // committed steer still gets a following assistant row so the steer isn't orphaned.
      if (consumedSteers > 0 && (error as Error)?.name !== 'Cancelled') {
        this.appendMessage(sessionId, 'assistant', 'I hit a problem and stopped before finishing — please try again.', undefined, nextTs());
      }
      throw error;
    } finally {
      runRegistry.release(sessionId, handle.runId);
    }
  }

  private appendMessage(sessionId: string, role: ChatRole, content: string, trace?: ToolTraceEntry[], createdAt?: string): ResumeMessage {
    const message: ResumeMessage = {
      id: randomUUID(),
      session_id: sessionId,
      role,
      content,
      created_at: createdAt ?? new Date().toISOString(),
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

    const hadCompany = Boolean(session.company_name.trim());
    const company = pick(t.company_name, session.company_name);
    const jobTitle = pick(t.job_title, session.job_title);
    // Name the session after its company the FIRST time the conversation reveals it;
    // before that, track the job title; once it has been company-named, leave the
    // title alone so a later manual rename sticks.
    let title = session.title;
    if (company && !hadCompany) title = company;
    else if (!hadCompany) title = jobTitle || session.title;

    return this.updateTarget(sessionId, {
      company_name: company,
      job_title: jobTitle,
      location: pick(t.location, session.location),
      job_description: pick(t.job_description, session.job_description),
      company_notes: pick(t.company_notes, session.company_notes),
      title
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
    const personality = personalityService.get(session.personality_id);
    // The resume content itself uses the final-resume model (falls back to primary).
    // It's a single large structured-JSON generation, so it legitimately runs longer
    // than the 90s default — give it a wider per-call ceiling (still under the route's
    // own asyncHandler cap) so a slow final model finishes instead of being aborted.
    const draft = await openRouter.json<ResumeDraft>(
      resumeDraftPrompt({ personality, analysis: session.analysis as JobAnalysis, memory, target: session }),
      { model: settingsService.finalModel(), timeoutMs: 140_000 }
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
