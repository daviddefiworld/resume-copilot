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

function personaLine(p: Personality): string {
  return (
    `You are "${p.name}". Tone: ${p.tone}. Critique intensity: ${p.critiqueIntensity}. ` +
    `Reasoning style: ${p.reasoningStyle}. Resume bias: ${p.resumeBias}. ` +
    'Your personality shapes how you communicate, not the facts. ' +
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
// already-saved memory is injected so Sox builds on it instead of re-asking. ---
export function memoryInterviewSystem(personality: Personality, memory: string): string {
  return fill(promptsService.get('memory_interview'), {
    persona: personaLine(personality),
    memory: memory || '(nothing saved yet — this is the start of their memory)',
    guardrails: GUARDRAILS()
  });
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

// --- Canvas turn: one chat reply that may also edit the live resume. ---
export function resumeCanvasTurnSystem(input: {
  personality: Personality;
  current: ResumeDraft;
  memory: string;
}): string {
  const { personality, current, memory } = input;
  return fill(promptsService.get('canvas_turn'), {
    persona: personaLine(personality),
    resumeRichness: RESUME_RICHNESS(),
    jsonShape: RESUME_CONTENT_SHAPE,
    current: JSON.stringify(current, null, 2),
    memory: memory || '(none saved yet)'
  }) + '\n\n' + PAGE_LENGTH_GUIDANCE;
}

// --- Resume chat: conversational assistant inside a resume session. ---
export function resumeChatSystem(input: {
  personality: Personality;
  target: ResumeSession;
  hasMemory: boolean;
}): string {
  const { personality, target, hasMemory } = input;
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
  const memoryNudge = hasMemory
    ? ''
    : 'The user has no saved memory yet. Gently suggest they tell Sox about their background in ' +
      'the Copilot chat first, so the draft has something to build on.\n';
  return fill(promptsService.get('resume_chat'), {
    persona: personaLine(personality),
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
