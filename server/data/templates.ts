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
  },
  {
    id: 'toptal_profile',
    name: 'Toptal Profile',
    description: 'Toptal-style two-column: full-width header, skills & education in a left rail.',
    accent: '#2f5496',
    nameSize: 26,
    headingSize: 11,
    bodySize: 10,
    headingCase: 'upper',
    rule: false,
    layout: 'sidebar',
    sidebarSections: ['skills', 'education'],
    sectionOrder: ['summary', 'experience', 'projects']
  }
];

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
