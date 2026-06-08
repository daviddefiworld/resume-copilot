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
    res.status(201).json(await resumeService.generateDraft(param(req, 'id')));
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
    const version = resumeService.getVersion(param(req, 'id'));
    const templateId = (req.query.template as string) || version.template_id;
    const pdf = await exportService.render(version.content, templateId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="resume-v${version.version_number}.pdf"`);
    res.send(pdf);
  }
};
