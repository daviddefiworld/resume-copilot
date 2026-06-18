import type { Request, Response } from 'express';
import { documentService } from '../services/documentService.ts';
import { param } from '../middleware/asyncHandler.ts';

// HTTP layer for per-session workspace documents. The agent maintains these
// during chat; these endpoints let the user view and hand-edit them.
export const documentController = {
  // :id is the session id here.
  list(req: Request, res: Response): void {
    res.json(documentService.list(param(req, 'id')));
  },

  create(req: Request, res: Response): void {
    const body = req.body as { title?: string; content?: string };
    res.status(201).json(documentService.create(param(req, 'id'), body));
  },

  // :id is the document id here.
  update(req: Request, res: Response): void {
    const body = req.body as { title?: string; content?: string };
    res.json(documentService.update(param(req, 'id'), body));
  },

  delete(req: Request, res: Response): void {
    documentService.delete(param(req, 'id'));
    res.json({ ok: true });
  }
};
