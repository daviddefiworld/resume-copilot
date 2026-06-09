import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Gauge, Loader2, Search, X } from 'lucide-react';
import { api } from '../api.ts';
import type { ATSBand, ATSReport } from '../../shared/types.ts';

interface ATSAnalyzerProps {
  // Optional prefill when deep-linked from a resume's "Check ATS score" button.
  prefill: { resume: string; jobDescription: string } | null;
}

const BAND_LABEL: Record<ATSBand, string> = {
  strong: 'Strong match',
  moderate: 'Moderate match',
  weak: 'Weak match',
  poor: 'Poor match'
};

// Maps a 0–100 score to a theme colour: green → yellow → orange → red as it drops.
function scoreColor(score: number): string {
  if (score >= 80) return 'var(--ok)';
  if (score >= 60) return 'var(--warn)';
  if (score >= 40) return 'var(--accent)';
  return 'var(--danger)';
}

// The analyzer: paste a resume and a job description, get a strict ATS-style
// match report. The form sits at the top; the report renders below it.
export default function ATSAnalyzer({ prefill }: ATSAnalyzerProps) {
  const [resume, setResume] = useState(prefill?.resume ?? '');
  const [jobDescription, setJobDescription] = useState(prefill?.jobDescription ?? '');
  const [report, setReport] = useState<ATSReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function analyze(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      setReport(await api.analyzeATS({ resume, jobDescription }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canAnalyze = resume.trim().length > 0 && jobDescription.trim().length > 0 && !busy;

  return (
    <div className="pane">
      <header className="paneHeader">
        <div className="sessionHead">
          <div className="paneTitle"><Gauge size={18} /> ATS score analyzer</div>
          <span className="paneSub">Score a resume against a job description, the way real ATS software does.</span>
        </div>
      </header>

      <div className="paneScroll atsScroll">
        <div className="atsGrid">
          <label className="atsField">
            Resume
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="Paste the full resume text here…"
            />
          </label>
          <label className="atsField">
            Job description
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description here…"
            />
          </label>
        </div>

        <div className="atsActions">
          <button className="pillBtn" onClick={analyze} disabled={!canAnalyze}>
            {busy ? <><Loader2 size={15} className="spin" /> Scoring…</> : <><Search size={15} /> Analyze ATS score</>}
          </button>
          <span className="atsHint">Strict scoring — matches keywords literally and gates on hard requirements.</span>
        </div>

        {error && <p className="error">{error}</p>}

        {report && <ATSResult report={report} />}
      </div>
    </div>
  );
}

function ATSResult({ report }: { report: ATSReport }) {
  const color = scoreColor(report.overallScore);
  const matched = report.keywords.filter((k) => k.present);
  const missing = report.keywords.filter((k) => !k.present);

  return (
    <div className="atsReport">
      <div className="atsScoreCard">
        <div
          className="atsRing"
          style={{ '--score': report.overallScore, '--ring': color } as CSSProperties}
        >
          <div className="atsRingInner">
            <span className="atsScoreNum">{report.overallScore}</span>
            <span className="atsScoreOf">/ 100</span>
          </div>
        </div>
        <div className="atsScoreMeta">
          <span className="atsBand" style={{ color }}>{BAND_LABEL[report.band]}</span>
          {report.verdict && <p className="atsVerdict">{report.verdict}</p>}
        </div>
      </div>

      <section className="atsSection">
        <h3>Category breakdown</h3>
        <div className="atsCats">
          {report.categories.map((c) => (
            <div key={c.key} className="atsCat">
              <div className="atsCatHead">
                <span>{c.label}</span>
                <span className="atsCatScore">
                  {c.score}<small>/100 · {Math.round(c.weight * 100)}% weight</small>
                </span>
              </div>
              <div className="atsBar">
                <div className="atsBarFill" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
              </div>
              {c.notes && <p className="atsCatNotes">{c.notes}</p>}
            </div>
          ))}
        </div>
      </section>

      {(missing.length > 0 || matched.length > 0) && (
        <section className="atsSection">
          <h3>Keyword match</h3>
          {missing.length > 0 && (
            <>
              <p className="atsSub">Missing from the resume ({missing.length})</p>
              <div className="atsChips">
                {missing.map((k, i) => (
                  <span key={i} className={`atsChip missing ${k.importance}`} title={`${k.importance} priority`}>{k.term}</span>
                ))}
              </div>
            </>
          )}
          {matched.length > 0 && (
            <>
              <p className="atsSub">Found in the resume ({matched.length})</p>
              <div className="atsChips">
                {matched.map((k, i) => <span key={i} className="atsChip found">{k.term}</span>)}
              </div>
            </>
          )}
        </section>
      )}

      {report.requirements.length > 0 && (
        <section className="atsSection">
          <h3>Hard requirements</h3>
          <ul className="atsReqs">
            {report.requirements.map((r, i) => (
              <li key={i} className={r.met ? 'met' : 'unmet'}>
                <span className="atsReqIcon">{r.met ? <Check size={14} /> : <X size={14} />}</span>
                <div className="atsReqBody">
                  <span className="atsReqName">{r.requirement}</span>
                  {r.evidence && <span className="atsReqEvidence">{r.evidence}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.recommendations.length > 0 && (
        <section className="atsSection">
          <h3>Top fixes, highest impact first</h3>
          <ol className="atsRecs">
            {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}
