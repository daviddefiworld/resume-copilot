import { openRouter } from './openRouterService.ts';
import { settingsService } from './settingsService.ts';
import { atsAnalysisPrompt } from './prompts.ts';
import type {
  ATSBand,
  ATSCategory,
  ATSImportance,
  ATSKeywordHit,
  ATSReport,
  ATSRequirement
} from '../../shared/types.ts';

export interface ATSInput {
  resume: string;
  jobDescription: string;
}

// The scoring rubric, owned by the server rather than the model. The weights are
// keyword-dominant and requirement-gated, mirroring how real ATS + recruiter
// screens actually rank a resume. The model scores each category 0–100; this
// service blends them into the overall score so results are reproducible and
// can't be inflated by the model picking its own weights. Weights sum to 1.
const CATEGORY_DEFS: ReadonlyArray<{ key: string; label: string; weight: number }> = [
  { key: 'keyword_match', label: 'Keyword & hard-skill match', weight: 0.4 },
  { key: 'title_match', label: 'Job title & role alignment', weight: 0.12 },
  { key: 'hard_requirements', label: 'Hard requirements', weight: 0.23 },
  { key: 'searchability', label: 'Searchability & parsing', weight: 0.15 },
  { key: 'formatting', label: 'Impact & formatting', weight: 0.1 }
];

// The raw, untrusted shape the model returns. Everything is optional/loose here;
// assemble() validates and normalizes it into the ATSReport.
interface ATSModelResult {
  verdict?: string;
  categories?: Array<{ key?: string; score?: number; notes?: string }>;
  keywords?: Array<{ term?: string; present?: boolean; importance?: string }>;
  requirements?: Array<{ requirement?: string; met?: boolean; evidence?: string }>;
  recommendations?: string[];
}

function clampScore(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalizeImportance(value: unknown): ATSImportance {
  return value === 'critical' || value === 'high' ? value : 'normal';
}

// Strict bands: most resumes should land "moderate" or below.
function bandFor(score: number): ATSBand {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'moderate';
  if (score >= 40) return 'weak';
  return 'poor';
}

// Weighted share of the job's keywords the resume actually contains, with
// critical terms counting most. This grounds the dominant scoring factor in
// countable data instead of the model's gut feel — the single biggest reason a
// naive ATS scorer comes out far too generous. Returns null when the model
// surfaced no keywords to score against.
function keywordCoverage(keywords: ATSKeywordHit[]): number | null {
  const weightOf = (k: ATSKeywordHit): number =>
    k.importance === 'critical' ? 3 : k.importance === 'high' ? 2 : 1;
  let have = 0;
  let total = 0;
  for (const k of keywords) {
    const w = weightOf(k);
    total += w;
    if (k.present) have += w;
  }
  return total > 0 ? (have / total) * 100 : null;
}

// Scores a resume against a job description. Stateless — nothing is persisted; the
// analyzer is a standalone tool that takes two blobs of text and returns a report.
class AtsService {
  async analyze(input: ATSInput): Promise<ATSReport> {
    const resume = String(input.resume || '').trim();
    const jobDescription = String(input.jobDescription || '').trim();
    if (resume.length < 40) {
      throw new Error('Paste your resume text first — it looks too short to score.');
    }
    if (jobDescription.length < 40) {
      throw new Error('Paste the job description first — it looks too short to score.');
    }

    // ATS scoring most rewards accuracy, so use the advanced/final model.
    const result = await openRouter.json<ATSModelResult>(
      atsAnalysisPrompt({ resume, jobDescription }),
      { model: settingsService.finalModel() }
    );
    return this.assemble(result);
  }

  // Turn the model's loose output into a validated report with server-owned
  // weights and a deterministically strict overall score. Real ATS screens are
  // gate-based, not averaging: a missing must-have keyword or unmet hard
  // requirement craters the score rather than nudging it. We enforce that here
  // in code, where it can't be talked up by a generous model.
  private assemble(result: ATSModelResult): ATSReport {
    const keywords: ATSKeywordHit[] = (result.keywords || [])
      .map((k) => ({
        term: String(k.term || '').trim(),
        present: Boolean(k.present),
        importance: normalizeImportance(k.importance)
      }))
      .filter((k) => k.term)
      .slice(0, 60);

    const requirements: ATSRequirement[] = (result.requirements || [])
      .map((r) => ({
        requirement: String(r.requirement || '').trim(),
        met: Boolean(r.met),
        evidence: String(r.evidence || '').trim()
      }))
      .filter((r) => r.requirement)
      .slice(0, 24);

    const coverage = keywordCoverage(keywords);

    const byKey = new Map((result.categories || []).map((c) => [c.key, c]));
    const categories: ATSCategory[] = CATEGORY_DEFS.map((def) => {
      const found = byKey.get(def.key);
      let score = clampScore(found?.score);
      // Ground the keyword dimension in measured coverage; the model may inflate
      // it, but it can never exceed the share of keywords actually present.
      if (def.key === 'keyword_match' && coverage !== null) {
        score = Math.min(score, Math.round(coverage));
      }
      return { key: def.key, label: def.label, weight: def.weight, score, notes: String(found?.notes || '').trim() };
    });

    const base = categories.reduce((sum, c) => sum + c.score * c.weight, 0);

    // Gating penalties — the realism lever. A must-have the resume never names
    // is how ATS auto-rejections happen, so weight it heavily.
    const missingCritical = keywords.filter((k) => !k.present && k.importance === 'critical').length;
    const missingHigh = keywords.filter((k) => !k.present && k.importance === 'high').length;
    const unmetRequirements = requirements.filter((r) => !r.met).length;
    const penalty = missingCritical * 12 + missingHigh * 4 + unmetRequirements * 8;

    // Coverage ceiling: matching few of the job's keywords caps the score no
    // matter how polished the prose is. coverage 100 → ceiling 100; 50 → 70; 0 → 40.
    const ceiling = coverage === null ? 100 : 40 + coverage * 0.6;

    const overallScore = Math.max(0, Math.min(100, Math.round(Math.min(base, ceiling) - penalty)));

    const recommendations = (result.recommendations || [])
      .map((r) => String(r || '').trim())
      .filter(Boolean)
      .slice(0, 12);

    return {
      overallScore,
      band: bandFor(overallScore),
      verdict: String(result.verdict || '').trim(),
      categories,
      keywords,
      requirements,
      recommendations
    };
  }
}

export const atsService = new AtsService();
