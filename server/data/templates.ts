import type { Template } from '../../shared/types.ts';

// Deterministic resume templates. Each template is pure layout configuration —
// fonts, sizes, colours, spacing, and section order. AI never controls layout;
// the renderer in services/exportService.ts reads these configs to draw the PDF.
export const TEMPLATES: Template[] = [
  {
    id: 'classic_ats',
    name: 'Classic ATS',
    description: 'Single-column, no colour, maximally parser-friendly.',
    accent: '#000000',
    nameSize: 22,
    headingSize: 12,
    bodySize: 10,
    headingCase: 'upper',
    rule: true,
    sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education']
  },
  {
    id: 'technical_compact',
    name: 'Technical Compact',
    description: 'Tighter spacing, skills first — fits more on one page.',
    accent: '#1f2937',
    nameSize: 20,
    headingSize: 11,
    bodySize: 9.5,
    headingCase: 'upper',
    rule: true,
    sectionOrder: ['skills', 'experience', 'projects', 'summary', 'education']
  },
  {
    id: 'modern_professional',
    name: 'Modern Professional',
    description: 'Accent colour and roomier spacing for a polished look.',
    accent: '#2563eb',
    nameSize: 24,
    headingSize: 12,
    bodySize: 10.5,
    headingCase: 'title',
    rule: false,
    sectionOrder: ['summary', 'experience', 'projects', 'skills', 'education']
  }
];

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
