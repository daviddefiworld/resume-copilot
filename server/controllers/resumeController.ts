import type { Request, Response } from 'express';
import { resumeService } from '../services/resumeService.ts';
import { exportService } from '../services/exportService.ts';
import { param } from '../middleware/asyncHandler.ts';
import { openSseStream } from '../middleware/sse.ts';

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
    const body = req.body as { content?: string; approvedCalls?: unknown };
    res.status(201).json(
      await resumeService.sendMessage(param(req, 'id'), body.content ?? '', approvedCallsOf(body.approvedCalls))
    );
  },

  // Streaming variant of sendMessage: text streams as `delta` events, the
  // persisted message arrives in `done`. Registered without asyncHandler — it
  // owns its response and reports failures as an SSE `error` event.
  async streamMessage(req: Request, res: Response): Promise<void> {
    const body = req.body as { content?: string; approvedCalls?: unknown };
    const send = openSseStream(res);
    try {
      const message = await resumeService.sendMessageStream(
        param(req, 'id'),
        body.content ?? '',
        (text) => send({ type: 'delta', text }),
        approvedCallsOf(body.approvedCalls),
        // The same SSE sink carries live plan/status/steer_ack events (the client
        // ignores unknown event types, so this is backward-compatible).
        send
      );
      send({ type: 'done', message });
    } catch (error) {
      send({ type: 'error', error: error instanceof Error ? error.message : 'Request failed.' });
    } finally {
      res.end();
    }
  },

  // Queue a steering message onto the session's in-flight run. Returns immediately;
  // 409 when no run is accepting (the client then sends it as a fresh normal turn).
  steer(req: Request, res: Response): void {
    try {
      res.json(resumeService.queueSteer(param(req, 'id'), (req.body as { content?: string }).content ?? ''));
    } catch (error) {
      if (error instanceof Error && error.name === 'NotRunning') {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
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

// Sanitize the optional approvedCalls field from a chat request: the explicit
// one-turn approval tokens (callToken fingerprints) the user authorized. Anything
// not a clean string array becomes an empty list (gate stays closed).
function approvedCallsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
}

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
