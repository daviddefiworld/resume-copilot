import type { ReactNode } from 'react';
import type { ResumeContent } from '../../shared/types.ts';

// On-screen preview of the structured resume content. This mirrors the PDF
// sections but is not the export itself — the PDF is rendered deterministically
// on the server. Helps the user review before exporting.
export default function ResumePreview({ content }: { content: ResumeContent }) {
  if (!content) return null;
  const c = content.contact ?? { name: '', email: '', phone: '', location: '', links: [] };
  const line = [c.email, c.phone, c.location, ...(c.links || [])].filter(Boolean).join('  •  ');

  return (
    <div className="preview">
      <div className="previewHead">
        <h1>{c.name || 'Your Name'}</h1>
        {content.headline && <p className="previewHeadline">{content.headline}</p>}
        {line && <p className="previewContact">{line}</p>}
      </div>

      {content.summary && (
        <Section title="Summary"><p>{content.summary}</p></Section>
      )}

      {arr(content.skills).length > 0 && (
        <Section title="Skills"><p>{arr(content.skills).join('  •  ')}</p></Section>
      )}

      {arr(content.experience).length > 0 && (
        <Section title="Experience">
          {arr(content.experience).map((job, i) => (
            <div key={i} className="previewEntry">
              <div className="previewEntryTop">
                <strong>{[job.role, job.company].filter(Boolean).join(' — ')}</strong>
                <span>{job.period}</span>
              </div>
              <Bullets list={job.bullets} />
            </div>
          ))}
        </Section>
      )}

      {arr(content.projects).length > 0 && (
        <Section title="Projects">
          {arr(content.projects).map((p, i) => (
            <div key={i} className="previewEntry">
              <strong>{p.name}</strong>
              {p.description && <p className="previewDesc">{p.description}</p>}
              <Bullets list={p.bullets} />
            </div>
          ))}
        </Section>
      )}

      {arr(content.education).length > 0 && (
        <Section title="Education">
          {arr(content.education).map((ed, i) => (
            <div key={i} className="previewEntryTop">
              <strong>{[ed.credential, ed.institution].filter(Boolean).join(', ')}</strong>
              <span>{ed.period}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function arr<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="previewSection">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Bullets({ list }: { list: string[] | undefined }) {
  if (arr(list).length === 0) return null;
  return (
    <ul>
      {arr(list).map((b, i) => <li key={i}>{b}</li>)}
    </ul>
  );
}
