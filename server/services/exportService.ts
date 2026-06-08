import PDFDocument from 'pdfkit';
import { getTemplate } from '../data/templates.ts';
import type { ResumeContent, ResumeSectionKey, Template } from '../../shared/types.ts';

type Doc = PDFKit.PDFDocument;

// Renders a structured resume into a PDF buffer using a template config.
// Deterministic: the same content + template always produces the same layout.
class ExportService {
  // Returns the rendered PDF as a Buffer.
  render(content: ResumeContent, templateId: string): Promise<Buffer> {
    const template = getTemplate(templateId);
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawHeader(doc, content, template);
      for (const section of template.sectionOrder) {
        this.drawSection(doc, section, content, template);
      }
      doc.end();
    });
  }

  private drawHeader(doc: Doc, content: ResumeContent, t: Template): void {
    const contact = content.contact ?? { name: '', email: '', phone: '', location: '', links: [] };
    doc.fillColor(t.accent).font('Helvetica-Bold').fontSize(t.nameSize);
    doc.text(contact.name || 'Your Name', { align: 'left' });

    if (content.headline) {
      doc.moveDown(0.15).fillColor('#374151').font('Helvetica').fontSize(t.bodySize + 1);
      doc.text(content.headline);
    }

    const line = [contact.email, contact.phone, contact.location, ...(contact.links || [])]
      .filter(Boolean)
      .join('  •  ');
    if (line) {
      doc.moveDown(0.2).fillColor('#4b5563').font('Helvetica').fontSize(t.bodySize);
      doc.text(line);
    }
    doc.moveDown(0.6);
  }

  private drawSection(doc: Doc, section: ResumeSectionKey, content: ResumeContent, t: Template): void {
    const renderers: Record<ResumeSectionKey, () => void> = {
      summary: () => this.drawSummary(doc, content, t),
      skills: () => this.drawSkills(doc, content, t),
      experience: () => this.drawExperience(doc, content, t),
      projects: () => this.drawProjects(doc, content, t),
      education: () => this.drawEducation(doc, content, t)
    };
    renderers[section]?.();
  }

  private heading(doc: Doc, label: string, t: Template): void {
    const text = t.headingCase === 'upper' ? label.toUpperCase() : label;
    doc.moveDown(0.5).fillColor(t.accent).font('Helvetica-Bold').fontSize(t.headingSize);
    doc.text(text);
    if (t.rule) {
      const y = doc.y + 1;
      doc.moveTo(doc.x, y).lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(t.accent).lineWidth(0.5).stroke();
    }
    doc.moveDown(0.3).fillColor('#111827').font('Helvetica').fontSize(t.bodySize);
  }

  private drawSummary(doc: Doc, content: ResumeContent, t: Template): void {
    if (!content.summary) return;
    this.heading(doc, 'Summary', t);
    doc.text(content.summary, { align: 'left', lineGap: 1.5 });
  }

  private drawSkills(doc: Doc, content: ResumeContent, t: Template): void {
    const skills = (content.skills || []).filter(Boolean);
    if (skills.length === 0) return;
    this.heading(doc, 'Skills', t);
    doc.text(skills.join('  •  '), { lineGap: 1.5 });
  }

  private drawExperience(doc: Doc, content: ResumeContent, t: Template): void {
    const items = content.experience || [];
    if (items.length === 0) return;
    this.heading(doc, 'Experience', t);
    for (const job of items) {
      doc.font('Helvetica-Bold').fillColor('#111827').fontSize(t.bodySize + 0.5);
      const title = [job.role, job.company].filter(Boolean).join(' — ');
      doc.text(title, { continued: Boolean(job.period) });
      if (job.period) {
        doc.font('Helvetica').fillColor('#6b7280').text(`   ${job.period}`, { align: 'right' });
      }
      this.drawBullets(doc, job.bullets, t);
      doc.moveDown(0.3);
    }
  }

  private drawProjects(doc: Doc, content: ResumeContent, t: Template): void {
    const items = content.projects || [];
    if (items.length === 0) return;
    this.heading(doc, 'Projects', t);
    for (const project of items) {
      doc.font('Helvetica-Bold').fillColor('#111827').fontSize(t.bodySize + 0.5);
      doc.text(project.name || 'Project');
      if (project.description) {
        doc.font('Helvetica').fillColor('#374151').fontSize(t.bodySize).text(project.description);
      }
      this.drawBullets(doc, project.bullets, t);
      doc.moveDown(0.3);
    }
  }

  private drawEducation(doc: Doc, content: ResumeContent, t: Template): void {
    const items = content.education || [];
    if (items.length === 0) return;
    this.heading(doc, 'Education', t);
    for (const ed of items) {
      doc.font('Helvetica-Bold').fillColor('#111827').fontSize(t.bodySize + 0.5);
      const head = [ed.credential, ed.institution].filter(Boolean).join(', ');
      doc.text(head, { continued: Boolean(ed.period) });
      if (ed.period) {
        doc.font('Helvetica').fillColor('#6b7280').text(`   ${ed.period}`, { align: 'right' });
      }
      doc.moveDown(0.2);
    }
  }

  private drawBullets(doc: Doc, bullets: string[] | undefined, t: Template): void {
    const list = (bullets || []).filter(Boolean);
    if (list.length === 0) return;
    doc.font('Helvetica').fillColor('#1f2937').fontSize(t.bodySize).moveDown(0.15);
    for (const bullet of list) {
      doc.text(`•  ${bullet}`, { indent: 8, lineGap: 1.5 });
    }
  }
}

export const exportService = new ExportService();
