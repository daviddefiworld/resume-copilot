import type { ResumeContent } from '../shared/types.ts';

// Flatten a structured resume into plain text resembling what an ATS would parse
// out of the exported PDF. Used to prefill the ATS analyzer from a live resume.
export function resumeToText(content: ResumeContent): string {
  const lines: string[] = [];
  const c = content.contact;
  if (c) {
    if (c.name) lines.push(c.name);
    const detail = [c.email, c.phone, c.location, ...(c.links || [])].filter(Boolean);
    if (detail.length) lines.push(detail.join(' | '));
  }
  if (content.headline) lines.push('', content.headline);
  if (content.summary) lines.push('', 'SUMMARY', content.summary);
  if (content.skills?.length) lines.push('', 'SKILLS', content.skills.join(', '));

  if (content.experience?.length) {
    lines.push('', 'EXPERIENCE');
    for (const e of content.experience) {
      lines.push([e.role, e.company].filter(Boolean).join(' — ') + (e.period ? ` (${e.period})` : ''));
      for (const b of e.bullets || []) lines.push(`- ${b}`);
    }
  }

  if (content.projects?.length) {
    lines.push('', 'PROJECTS');
    for (const p of content.projects) {
      lines.push(p.name + (p.description ? ` — ${p.description}` : ''));
      for (const b of p.bullets || []) lines.push(`- ${b}`);
    }
  }

  if (content.education?.length) {
    lines.push('', 'EDUCATION');
    for (const ed of content.education) {
      lines.push([ed.credential, ed.institution].filter(Boolean).join(' — ') + (ed.period ? ` (${ed.period})` : ''));
    }
  }

  return lines.join('\n').trim();
}
