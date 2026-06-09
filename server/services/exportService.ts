import PDFDocument from 'pdfkit';
import { getTemplate } from '../data/templates.ts';
import type {
  ResumeContent,
  ResumeEducation,
  ResumeSectionKey,
  Template
} from '../../shared/types.ts';

type Doc = PDFKit.PDFDocument;
type FontSet = { regular: string; bold: string };

// Sidebar layout geometry (LETTER, points), Toptal-style: a full-width name +
// title header spans the top, then a narrow left rail (skills, education) sits
// beside the wide main column, separated by a thin vertical rule. Overflow pages
// drop the rail and run full width.
const SIDE_MARGIN = 48;
const RAIL_WIDTH = 166;
const RAIL_GUTTER = 26;
const RAIL_EDGE = SIDE_MARGIN + RAIL_WIDTH; // right edge of the rail column
const MAIN_X = RAIL_EDGE + RAIL_GUTTER; // left margin of the main column
const RAIL_PAD = 14;
const RAIL_INNER = RAIL_EDGE - SIDE_MARGIN - RAIL_PAD;
const DIVIDER_X = RAIL_EDGE + RAIL_GUTTER / 2; // vertical rule between columns

// Renders a structured resume into a PDF buffer using a template config.
// Deterministic: the same content + template always produces the same layout.
class ExportService {
  // Returns the rendered PDF as a Buffer.
  render(content: ResumeContent, templateId: string): Promise<Buffer> {
    const template = getTemplate(templateId);
    const doc = template.layout === 'sidebar'
      ? new PDFDocument({ size: 'LETTER', margins: { top: SIDE_MARGIN, bottom: SIDE_MARGIN, left: MAIN_X, right: SIDE_MARGIN } })
      : new PDFDocument({ size: 'LETTER', margin: 54 });

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (template.layout === 'sidebar') {
        this.renderSidebar(doc, content, template);
      } else {
        this.renderSingle(doc, content, template);
      }
      doc.end();
    });
  }

  // ---- Single column ----

  private renderSingle(doc: Doc, content: ResumeContent, t: Template): void {
    const f = fonts(t);
    this.drawHeader(doc, content, t, f, true);
    for (const section of t.sectionOrder) {
      this.drawSection(doc, section, content, t, f);
    }
  }

  // ---- Sidebar (two column) ----

  private renderSidebar(doc: Doc, content: ResumeContent, t: Template): void {
    const f = fonts(t);

    // Full-width header (name + title + contact) across both columns.
    const headerBottom = this.drawSidebarHeader(doc, content, t, f);
    doc.moveTo(SIDE_MARGIN, headerBottom).lineTo(doc.page.width - SIDE_MARGIN, headerBottom)
      .strokeColor(t.accent).opacity(0.35).lineWidth(1).stroke().opacity(1);

    const columnsTop = headerBottom + 18;

    // Thin vertical rule between the rail and main column (page 1 only).
    doc.moveTo(DIVIDER_X, columnsTop).lineTo(DIVIDER_X, doc.page.height - SIDE_MARGIN)
      .strokeColor('#d7dce3').lineWidth(0.75).stroke();

    // Overflow pages drop the rail and run the main column full width.
    doc.on('pageAdded', () => {
      doc.page.margins.left = SIDE_MARGIN;
      doc.x = SIDE_MARGIN;
    });

    // Left rail (page 1 only, guarded against overflow).
    this.drawRail(doc, content, t, f, columnsTop);

    // Main column flows from the header down via the document's left margin.
    doc.page.margins.left = MAIN_X;
    doc.x = MAIN_X;
    doc.y = columnsTop;
    for (const section of t.sectionOrder) {
      this.drawSection(doc, section, content, t, f);
    }
  }

  private drawSidebarHeader(doc: Doc, content: ResumeContent, t: Template, f: FontSet): number {
    const contact = content.contact ?? { name: '', email: '', phone: '', location: '', links: [] };
    const fullWidth = doc.page.width - SIDE_MARGIN * 2;

    doc.fillColor('#1a1a1a').font(f.bold).fontSize(t.nameSize);
    doc.text(contact.name || 'Your Name', SIDE_MARGIN, SIDE_MARGIN, { width: fullWidth });

    if (content.headline) {
      doc.moveDown(0.25).fillColor(t.accent).font(f.regular).fontSize(t.bodySize + 2.5);
      doc.text(content.headline, SIDE_MARGIN, doc.y, { width: fullWidth });
    }

    if (hasContact(contact)) {
      doc.moveDown(0.35);
      this.drawContactLine(doc, contact, f, {
        x: SIDE_MARGIN,
        width: fullWidth,
        color: '#6b7280',
        fontSize: t.bodySize - 0.5,
        accent: t.accent
      });
    }
    doc.moveDown(0.5);
    return doc.y;
  }

  // Renders the contact line as inline segments so links become clickable. Plain
  // fields (email/phone/location) stay muted; each link is shown by a friendly
  // label ("LinkedIn", "GitHub", or its domain) and carries a real PDF hyperlink.
  private drawContactLine(
    doc: Doc,
    contact: { email: string; phone: string; location: string; links?: string[] },
    f: FontSet,
    opts: { x: number; width: number; color: string; fontSize: number; accent: string }
  ): void {
    const parts: Array<{ text: string; link?: string }> = [
      ...[contact.email, contact.phone, contact.location].filter(Boolean).map((text) => ({ text })),
      ...(contact.links || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .map((raw) => ({ text: linkLabel(raw), link: normalizeUrl(raw) }))
    ];
    if (parts.length === 0) return;

    // Interleave separators as their own (non-link) segments.
    const ops: Array<{ text: string; link?: string }> = [];
    parts.forEach((part, i) => {
      if (i > 0) ops.push({ text: '   •   ' });
      ops.push(part);
    });

    doc.font(f.regular).fontSize(opts.fontSize);
    ops.forEach((op, i) => {
      const continued = i < ops.length - 1;
      const isLink = Boolean(op.link);
      doc.fillColor(isLink ? opts.accent : opts.color);
      // `link`/`underline` are passed on every segment so they reset between
      // fragments rather than bleeding from a link into the following separator.
      if (i === 0) {
        doc.text(op.text, opts.x, doc.y, { width: opts.width, continued, link: op.link, underline: isLink });
      } else {
        doc.text(op.text, { continued, link: op.link, underline: isLink });
      }
    });
  }

  private drawRail(doc: Doc, content: ResumeContent, t: Template, f: FontSet, top: number): void {
    doc.x = SIDE_MARGIN;
    doc.y = top;
    (t.sidebarSections || []).forEach((section, i) => {
      if (i > 0) doc.moveDown(0.85);
      if (section === 'skills') this.railSkills(doc, content, t, f);
      else if (section === 'education') this.railEducation(doc, content, t, f);
    });
  }

  private railHeading(doc: Doc, label: string, t: Template, f: FontSet): void {
    doc.font(f.bold).fontSize(t.headingSize - 1).fillColor(t.accent);
    doc.text(label.toUpperCase(), SIDE_MARGIN, doc.y, { width: RAIL_INNER, characterSpacing: 0.6 });
    doc.moveDown(0.4);
  }

  private railSkills(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const skills = (content.skills || []).filter(Boolean);
    if (skills.length === 0 || !this.railHasRoom(doc, 40)) return;
    this.railHeading(doc, 'Skills', t, f);
    doc.font(f.regular).fontSize(t.bodySize - 1).fillColor('#374151');
    for (const skill of skills) {
      if (!this.railHasRoom(doc, 14)) break;
      doc.text(skill, SIDE_MARGIN, doc.y, { width: RAIL_INNER, lineGap: 1 });
    }
  }

  private railEducation(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const items = content.education || [];
    if (items.length === 0 || !this.railHasRoom(doc, 40)) return;
    this.railHeading(doc, 'Education', t, f);
    for (const ed of items) {
      if (!this.railHasRoom(doc, 26)) break;
      doc.font(f.bold).fontSize(t.bodySize - 1).fillColor('#111827');
      doc.text(ed.credential || 'Education', SIDE_MARGIN, doc.y, { width: RAIL_INNER });
      const sub = [ed.institution, ed.period].filter(Boolean).join(' · ');
      if (sub) {
        doc.font(f.regular).fontSize(t.bodySize - 1.5).fillColor('#6b7280');
        doc.text(sub, SIDE_MARGIN, doc.y, { width: RAIL_INNER, lineGap: 1 });
      }
      doc.moveDown(0.4);
    }
  }

  private railHasRoom(doc: Doc, needed: number): boolean {
    return doc.y + needed < doc.page.height - SIDE_MARGIN;
  }

  // ---- Shared sections (single column, or the main column of the sidebar) ----

  private drawHeader(doc: Doc, content: ResumeContent, t: Template, f: FontSet, withContact: boolean): void {
    const contact = content.contact ?? { name: '', email: '', phone: '', location: '', links: [] };
    doc.fillColor(t.accent).font(f.bold).fontSize(t.nameSize);
    doc.text(contact.name || 'Your Name');

    if (content.headline) {
      doc.moveDown(0.2).fillColor('#374151').font(f.regular).fontSize(t.bodySize + 1.5);
      doc.text(content.headline);
    }

    if (withContact && hasContact(contact)) {
      doc.moveDown(0.3);
      this.drawContactLine(doc, contact, f, {
        x: doc.page.margins.left,
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        color: '#4b5563',
        fontSize: t.bodySize,
        accent: t.accent
      });
    }
    doc.moveDown(0.2);
  }

  private drawSection(doc: Doc, section: ResumeSectionKey, content: ResumeContent, t: Template, f: FontSet): void {
    const renderers: Record<ResumeSectionKey, () => void> = {
      summary: () => this.drawSummary(doc, content, t, f),
      skills: () => this.drawSkills(doc, content, t, f),
      experience: () => this.drawExperience(doc, content, t, f),
      projects: () => this.drawProjects(doc, content, t, f),
      education: () => this.drawEducation(doc, content, t, f)
    };
    renderers[section]?.();
  }

  private bottomLimit(doc: Doc): number {
    return doc.page.height - doc.page.margins.bottom;
  }

  // Page-break helper: if the next block needs more room than remains, start a
  // fresh page first. Keeps headings and entry titles from being stranded at the
  // very bottom of a page (which reads as an ugly half-blank page).
  private keep(doc: Doc, needed: number): void {
    if (doc.y + needed > this.bottomLimit(doc)) doc.addPage();
  }

  private heading(doc: Doc, label: string, t: Template, f: FontSet): void {
    this.keep(doc, t.headingSize + t.bodySize * 3.5);
    const left = doc.page.margins.left;
    const text = t.headingCase === 'upper' ? label.toUpperCase() : label;
    // Anchor to the left margin explicitly: a preceding bulleted section leaves
    // doc.x at the bullet indent, which would otherwise push the heading right.
    doc.moveDown(0.7).fillColor(t.accent).font(f.bold).fontSize(t.headingSize);
    doc.text(text, left, doc.y, { characterSpacing: t.headingCase === 'upper' ? 0.5 : 0 });
    if (t.rule) {
      const y = doc.y + 2;
      doc.moveTo(left, y).lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(t.accent).opacity(0.4).lineWidth(0.75).stroke().opacity(1);
      doc.moveDown(0.1);
    }
    doc.moveDown(0.35).fillColor('#111827').font(f.regular).fontSize(t.bodySize);
    doc.x = left;
  }

  // Renders a left title with a right-aligned meta string on the same baseline,
  // avoiding the ragged gaps that `continued` + right alignment produced.
  private titleRow(doc: Doc, left: string, right: string, t: Template, f: FontSet): void {
    const leftX = doc.page.margins.left;
    const rightLimit = doc.page.width - doc.page.margins.right;
    const top = doc.y;
    let rightW = 0;

    if (right) {
      doc.font(f.regular).fontSize(t.bodySize).fillColor('#6b7280');
      rightW = doc.widthOfString(right);
      doc.text(right, rightLimit - rightW, top, { lineBreak: false, width: rightW + 2 });
    }
    doc.font(f.bold).fontSize(t.bodySize + 1).fillColor('#111827');
    doc.text(left, leftX, top, { width: rightLimit - leftX - rightW - 12 });
  }

  private drawSummary(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    if (!content.summary) return;
    this.heading(doc, 'Summary', t, f);
    doc.text(content.summary, { align: 'left', lineGap: 2.5 });
  }

  private drawSkills(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const skills = (content.skills || []).filter(Boolean);
    if (skills.length === 0) return;
    this.heading(doc, 'Skills', t, f);
    doc.text(skills.join('   •   '), { lineGap: 3 });
  }

  private drawExperience(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const items = content.experience || [];
    if (items.length === 0) return;
    this.heading(doc, 'Experience', t, f);
    items.forEach((job, i) => {
      if (i > 0) doc.moveDown(0.5);
      this.keep(doc, t.bodySize * 4.5); // keep the title with its first bullet
      const title = [job.role, job.company].filter(Boolean).join('  —  ');
      this.titleRow(doc, title, job.period || '', t, f);
      this.drawBullets(doc, job.bullets, t, f);
    });
  }

  private drawProjects(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const items = content.projects || [];
    if (items.length === 0) return;
    this.heading(doc, 'Projects', t, f);
    items.forEach((project, i) => {
      if (i > 0) doc.moveDown(0.5);
      this.keep(doc, t.bodySize * 4.5);
      const left = doc.page.margins.left;
      doc.font(f.bold).fillColor('#111827').fontSize(t.bodySize + 1);
      doc.text(project.name || 'Project', left, doc.y);
      if (project.description) {
        doc.moveDown(0.1).font(f.regular).fillColor('#374151').fontSize(t.bodySize);
        doc.text(project.description, left, doc.y, { lineGap: 2 });
      }
      this.drawBullets(doc, project.bullets, t, f);
    });
  }

  private drawEducation(doc: Doc, content: ResumeContent, t: Template, f: FontSet): void {
    const items: ResumeEducation[] = content.education || [];
    if (items.length === 0) return;
    this.heading(doc, 'Education', t, f);
    items.forEach((ed, i) => {
      if (i > 0) doc.moveDown(0.35);
      this.keep(doc, t.bodySize * 2.5);
      const head = [ed.credential, ed.institution].filter(Boolean).join(', ');
      this.titleRow(doc, head, ed.period || '', t, f);
    });
  }

  // Hanging bullets drawn manually (rather than doc.list, which can emit a stray
  // blank page when a list starts near the page bottom). Each bullet paginates
  // as a unit so its dot and text never split across pages.
  private drawBullets(doc: Doc, bullets: string[] | undefined, t: Template, f: FontSet): void {
    const list = (bullets || []).filter(Boolean);
    if (list.length === 0) return;

    doc.moveDown(0.22);
    for (const bullet of list) {
      doc.font(f.regular).fontSize(t.bodySize);
      // Measure against the current column, then keep the whole bullet together:
      // if it would split across a page, move it to the next page first.
      const widthNow = doc.page.width - doc.page.margins.right - (doc.page.margins.left + 13);
      const height = doc.heightOfString(bullet, { width: widthNow, lineGap: 2 });
      const usable = this.bottomLimit(doc) - doc.page.margins.top;
      if (doc.y + height > this.bottomLimit(doc) && height <= usable) doc.addPage();

      // Recompute coordinates after any page break — an overflow page widens the
      // column (the rail is page 1 only), so cached positions would be wrong.
      const leftX = doc.page.margins.left;
      const textX = leftX + 13;
      const textW = doc.page.width - doc.page.margins.right - textX;
      const top = doc.y;
      doc.circle(leftX + 4, top + t.bodySize * 0.45, 1.45).fillColor('#374151').fill();
      doc.fillColor('#1f2937').font(f.regular).fontSize(t.bodySize);
      doc.text(bullet, textX, top, { width: textW, lineGap: 2 });
      doc.moveDown(0.2);
    }
    // Bullets render at an indent; restore x so the next heading/title sits at
    // the margin rather than inheriting the bullet indent.
    doc.x = doc.page.margins.left;
  }
}

function fonts(t: Template): FontSet {
  return t.font === 'serif'
    ? { regular: 'Times-Roman', bold: 'Times-Bold' }
    : { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}

// Whether a contact block has anything to render on the contact line.
function hasContact(contact: { email: string; phone: string; location: string; links?: string[] }): boolean {
  return Boolean(contact.email || contact.phone || contact.location || (contact.links || []).some(Boolean));
}

// A short, human label for a profile/portfolio URL — so the resume shows
// "LinkedIn" rather than a long raw URL, while the hyperlink points at the URL.
function linkLabel(raw: string): string {
  const lower = raw.toLowerCase();
  const known: Array<[string, string]> = [
    ['linkedin.com', 'LinkedIn'],
    ['github.com', 'GitHub'],
    ['gitlab.com', 'GitLab'],
    ['behance.net', 'Behance'],
    ['dribbble.com', 'Dribbble'],
    ['stackoverflow.com', 'Stack Overflow'],
    ['medium.com', 'Medium'],
    ['twitter.com', 'Twitter'],
    ['x.com', 'Twitter']
  ];
  for (const [needle, label] of known) {
    if (lower.includes(needle)) return label;
  }
  // Fall back to the bare domain (no scheme, no www, no path).
  const domain = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '');
  return domain || raw;
}

// Ensure a link string is a usable URL for the PDF hyperlink annotation: add a
// scheme when missing, and treat a bare email as a mailto.
function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return `mailto:${raw}`;
  return `https://${raw.replace(/^\/+/, '')}`;
}

export const exportService = new ExportService();
