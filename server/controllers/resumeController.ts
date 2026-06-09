import type { Request, Response } from 'express';
import { resumeService } from '../services/resumeService.ts';
import { exportService } from '../services/exportService.ts';
import { param } from '../middleware/asyncHandler.ts';

// HTTP layer for resume sessions, their chat, analysis, drafts, versions, and
// PDF export. Parses requests and delegates to the resume/export services.
export const resumeController = {
  // ---- Sessions ----
  listSessions(_req: Request, res: Response): void {
    res.json(resumeService.listSessions());
  },

  createSession(req: Request, res: Response): void {
    res.status(201).json(resumeService.createSession(req.body));
  },

  getSession(req: Request, res: Response): void {
    res.json(resumeService.getSession(param(req, 'id')));
  },

  updateSession(req: Request, res: Response): void {
    res.json(resumeService.updateTarget(param(req, 'id'), req.body));
  },

  deleteSession(req: Request, res: Response): void {
    resumeService.deleteSession(param(req, 'id'));
    res.json({ ok: true });
  },

  // ---- Resume chat ----
  listMessages(req: Request, res: Response): void {
    res.json(resumeService.listMessages(param(req, 'id')));
  },

  async sendMessage(req: Request, res: Response): Promise<void> {
    const content = (req.body as { content?: string }).content ?? '';
    res.status(201).json(await resumeService.sendMessage(param(req, 'id'), content));
  },

  // ---- Analysis & drafts ----
  async analyze(req: Request, res: Response): Promise<void> {
    res.json(await resumeService.analyzeJob(param(req, 'id')));
  },

  async draft(req: Request, res: Response): Promise<void> {
    const templateId = (req.body as { templateId?: string } | undefined)?.templateId;
    res.status(201).json(await resumeService.generateDraft(param(req, 'id'), templateId));
  },

  markFinal(req: Request, res: Response): void {
    const versionId = (req.body as { versionId: string }).versionId;
    res.json(resumeService.markFinal(param(req, 'id'), versionId));
  },

  // ---- Versions & export ----
  listVersions(req: Request, res: Response): void {
    res.json(resumeService.listVersions(param(req, 'id')));
  },

  getVersion(req: Request, res: Response): void {
    res.json(resumeService.getVersion(param(req, 'id')));
  },

  setTemplate(req: Request, res: Response): void {
    const templateId = (req.body as { templateId: string }).templateId;
    res.json(resumeService.setTemplate(param(req, 'id'), templateId));
  },

  async exportPdf(req: Request, res: Response): Promise<void> {
    await sendPdf(req, res, 'attachment');
  },

  // Same PDF, served inline so the live on-screen preview shows exactly what
  // will export (true page-for-page parity, not an HTML approximation).
  async previewPdf(req: Request, res: Response): Promise<void> {
    await sendPdf(req, res, 'inline');
  }
};

async function sendPdf(req: Request, res: Response, disposition: 'attachment' | 'inline'): Promise<void> {
  const version = resumeService.getVersion(param(req, 'id'));
  const templateId = (req.query.template as string) || version.template_id;
  const pdf = await exportService.render(version.content, templateId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${pdfFilename(version, disposition)}"`);
  res.send(pdf);
}

// Builds the suggested file name. Downloads carry the candidate's name and a
// timestamp so re-exporting never silently overwrites an earlier file; the
// inline preview keeps a stable name so refreshing it doesn't churn the cache.
function pdfFilename(version: { content: { contact?: { name?: string } }; version_number: number }, disposition: 'attachment' | 'inline'): string {
  const name = version.content.contact?.name?.trim();
  const base = slug(name ? `${name} resume` : 'resume');
  if (disposition === 'inline') return `${base}-v${version.version_number}.pdf`;
  return `${base}-v${version.version_number}-${timestamp()}.pdf`;
}

// Lowercase ASCII slug: keeps file names safe for any OS and HTTP headers.
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
}

// Compact local-time stamp, e.g. 20260610-142345.
function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
