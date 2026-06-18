import { promptsService, fill } from './promptsService.ts';
import type {
  ChatMessage,
  JobAnalysis,
  Personality,
  ResumeDraft,
  ResumeSession
} from '../../shared/types.ts';

// Prompt builders. One small prompt per AI responsibility, never one giant
// prompt. Every prompt's static text is editable in Settings → Prompts (stored
// via promptsService); these builders only fill the dynamic {{tokens}} —
// personality, memory, the JSON shape — so edits never break the structure.

const GUARDRAILS = (): string => promptsService.get('guardrails');
const RESUME_RICHNESS = (): string => promptsService.get('resume_richness');
const INSIGHT = (): string => promptsService.get('insight');
const MISSION = (): string => promptsService.get('mission');
// The job-hunt strategy Sox follows. Injected into the copilot, resume, and
// canvas prompts as {{playbook}}; always placed before {{guardrails}} so honesty
// and approval-before-send stay the overriding final word.
const PLAYBOOK = (): string => promptsService.get('playbook');

function personaLine(p: Personality): string {
  const essence = p.essence ? `Who you are: ${p.essence} ` : '';
  const mission = p.mission ? `Your pledge to them, in your own voice: "${p.mission}" ` : '';
  return (
    `You are "${p.name}". ${essence}${mission}` +
    `Tone: ${p.tone}. Critique intensity: ${p.critiqueIntensity}. ` +
    `Reasoning style: ${p.reasoningStyle}. Resume bias: ${p.resumeBias}. ` +
    'Stay fully in character, but your personality shapes how you communicate, not the facts. ' +
    'Personality must never encourage exaggeration, fabrication, or manipulative claims.'
  );
}

// The exact JSON shape for resume content, reused by the draft and edit prompts.
const RESUME_CONTENT_SHAPE =
  '"content": { "contact": { "name": string, "email": string, "phone": string, ' +
  '"location": string, "links": string[] }, "headline": string, "summary": string, "skills": string[], ' +
  '"experience": [ { "role": string, "company": string, "period": string, "bullets": string[] } ], ' +
  '"projects": [ { "name": string, "description": string, "bullets": string[] } ], ' +
  '"education": [ { "credential": string, "institution": string, "period": string } ] }, ' +
  '"strategy": { "positioning": string, "emphasizedEvidence": string[], "reducedEvidence": string[], ' +
  '"missingSignals": string[] }';

// Length control. The resume renders to US Letter PDF pages, so the model needs
// a rough sense of how much content fits a page and must treat explicit length
// requests from the user as hard constraints.
const PAGE_LENGTH_GUIDANCE =
  'PAGE LENGTH (US Letter PDF): Default to a tight ONE page. As a rough budget, one page holds about ' +
  'a 2–3 line summary, ~10–14 skills, and 2–4 roles at 3–4 bullets each (≈12–16 bullets total), plus ' +
  'a short education line. If the user asks for a specific length (e.g. "one page", "two pages", ' +
  '"make it shorter"), treat it as a HARD CONSTRAINT. To shorten: tighten the summary, cut the weakest ' +
  'bullets, and reduce older or less-relevant roles to 1–2 bullets — never pad or invent content to ' +
  'fill space. To lengthen: add the most job-relevant evidence first. Always keep the most recent and ' +
  'most relevant experience the richest.';

const MEMORY_CATEGORIES = [
  'contact_details', 'profile_summary', 'work_experience', 'projects', 'skills', 'education',
  'certifications', 'achievements', 'career_goals', 'role_preferences',
  'company_preferences', 'constraints', 'writing_preferences', 'sensitive_exclusions'
];

// --- Memory chat: interview the user to build long-term career memory. The
// already-saved memory is injected so Sox builds on it instead of re-asking.
// `character` is this personality's own evolving sense of the user (its private
// notes + a recap of the conversation), so it stays in character and builds on
// the relationship across sessions. ---
export function memoryInterviewSystem(personality: Personality, memory: string, character: string): string {
  return fill(promptsService.get('memory_interview'), {
    persona: personaLine(personality),
    mission: MISSION(),
    memory: memory || '(nothing saved yet — this is the start of their memory)',
    character: character || '(this is early in your relationship — you are still getting to know them)',
    insight: INSIGHT(),
    guardrails: GUARDRAILS()
  });
}

// --- Character reflection: after a conversation grows long, fold the transcript
// into this character's running recap and its durable, evolving notes about the
// user. Runs on the higher-accuracy model and returns JSON. ---
export function characterReflectionPrompt(input: {
  personality: Personality;
  transcript: string;
  priorSummary: string;
  priorNotes: string;
}): ChatMessage[] {
  const { personality, transcript, priorSummary, priorNotes } = input;
  return [
    {
      role: 'system',
      content: fill(promptsService.get('character_reflection'), {
        persona: personaLine(personality),
        priorSummary: priorSummary || '(no recap yet)',
        priorNotes: priorNotes || '(no notes yet)'
      })
    },
    { role: 'user', content: `Conversation so far:\n\n${transcript}` }
  ];
}

// --- Memory extraction: pull candidate memory items from recent conversation,
// merging with what is already saved. ---
export function memoryExtractionPrompt(transcript: string, existingMemory: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: fill(promptsService.get('memory_extraction'), {
        categories: MEMORY_CATEGORIES.join(', '),
        existingMemory: existingMemory || '(nothing saved yet)',
        guardrails: GUARDRAILS()
      })
    },
    { role: 'user', content: `Transcript:\n\n${transcript}` }
  ];
}

// --- Job analysis: read a job target and surface requirements/signals. ---
export function jobAnalysisPrompt(target: ResumeSession): ChatMessage[] {
  return [
    { role: 'system', content: promptsService.get('job_analysis') },
    {
      role: 'user',
      content:
        `Company: ${target.company_name || 'unknown'}\n` +
        `Job title: ${target.job_title || 'unknown'}\n` +
        `Location: ${target.location || 'unspecified'}\n` +
        `Company notes: ${target.company_notes || 'none'}\n\n` +
        `Job description:\n${target.job_description || 'none provided'}`
    }
  ];
}

// --- Resume draft: map confirmed memory onto the analysed opportunity. ---
export function resumeDraftPrompt(input: {
  personality: Personality;
  analysis: JobAnalysis;
  memory: string;
  target: ResumeSession;
}): ChatMessage[] {
  const { personality, analysis, memory, target } = input;
  return [
    {
      role: 'system',
      content: fill(promptsService.get('resume_draft'), {
        persona: personaLine(personality),
        insight: INSIGHT(),
        resumeRichness: RESUME_RICHNESS(),
        jsonShape: RESUME_CONTENT_SHAPE
      }) + '\n\n' + PAGE_LENGTH_GUIDANCE
    },
    {
      role: 'user',
      content:
        `Target:\nCompany: ${target.company_name}\nRole: ${target.job_title}\n\n` +
        `Job analysis:\n${JSON.stringify(analysis, null, 2)}\n\n` +
        `User memory:\n${memory}`
    }
  ];
}

// --- Canvas turn: one chat reply that may also edit the live resume.
// `character` is this personality's own evolving memory of the user, so the
// copilot stays in character and consistent with the relationship here too. ---
export function resumeCanvasTurnSystem(input: {
  personality: Personality;
  current: ResumeDraft;
  memory: string;
  character: string;
}): string {
  const { personality, current, memory, character } = input;
  return fill(promptsService.get('canvas_turn'), {
    persona: personaLine(personality),
    insight: INSIGHT(),
    playbook: PLAYBOOK(),
    resumeRichness: RESUME_RICHNESS(),
    jsonShape: RESUME_CONTENT_SHAPE,
    current: JSON.stringify(current, null, 2),
    memory: memory || '(none saved yet)',
    character: character || '(still getting to know them)'
  }) + '\n\n' + PAGE_LENGTH_GUIDANCE;
}

// --- Resume chat: conversational assistant inside a resume session. Gets the
// same context the Copilot chat has — the user's full confirmed memory plus this
// personality's own evolving memory of the user — so the session copilot builds
// on what it already knows instead of starting cold. Read-only here: the session
// chat never writes long-term or character memory. ---
export function resumeChatSystem(input: {
  personality: Personality;
  target: ResumeSession;
  memory: string;
  character: string;
  // The session's "Next Steps" plan document (full body), or '' when none yet.
  nextSteps: string;
}): string {
  const { personality, target, memory, character, nextSteps } = input;
  const hasJob = Boolean(target.job_description);
  const hasCompany = Boolean(target.company_name);
  let step: string;
  if (!hasJob) {
    step =
      'You do NOT yet know the job. STEP 1 — ask the user, warmly and concisely, to paste the ' +
      'job description. Ask only for the job description right now; do not ask about the company ' +
      'yet, and do not draft anything.';
  } else if (!hasCompany) {
    step =
      'You have the job description. STEP 2 — briefly reflect the role back, then ask which ' +
      'company it is for and any context they have about it (mission, product, stage, team). ' +
      'Ask only about the company now.';
  } else {
    step =
      'You have both the job and the company. Confirm both briefly, point out the strongest fit ' +
      'and any gaps from their memory, and invite them to click "Generate draft" when ready.';
  }
  const memoryNudge = memory
    ? ''
    : 'The user has no saved memory yet. Gently suggest they tell Sox about their background in ' +
      'the Copilot chat first, so the draft has something to build on.\n';
  return fill(promptsService.get('resume_chat'), {
    persona: personaLine(personality),
    insight: INSIGHT(),
    playbook: PLAYBOOK(),
    memory: memory || '(nothing saved yet — they can build it in the Copilot chat)',
    character: character || '(this is early in your relationship — you are still getting to know them)',
    nextSteps: nextSteps || '(no plan yet — propose a short Next Steps plan and offer to start it)',
    step,
    memoryNudge
  });
}

// --- ATS analysis: score a resume against a job description, strictly. ---
export function atsAnalysisPrompt(input: { resume: string; jobDescription: string }): ChatMessage[] {
  return [
    { role: 'system', content: promptsService.get('ats_analysis') },
    {
      role: 'user',
      content: `JOB DESCRIPTION:\n${input.jobDescription}\n\n----------\n\nRESUME:\n${input.resume}`
    }
  ];
}

// --- Job target extraction: pull the target job out of the session chat. ---
export function jobTargetExtractionPrompt(transcript: string): ChatMessage[] {
  return [
    { role: 'system', content: promptsService.get('job_target_extraction') },
    { role: 'user', content: `Conversation:\n\n${transcript}` }
  ];
}
