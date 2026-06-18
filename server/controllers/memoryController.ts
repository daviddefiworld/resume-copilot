import type { Request, Response } from 'express';
import { memoryService } from '../services/memoryService.ts';
import { param } from '../middleware/asyncHandler.ts';
import { openSseStream } from '../middleware/sse.ts';
import type { MemoryProposal } from '../../shared/types.ts';

// HTTP layer for the memory chat and memory items. Parses requests and
// delegates all work to the memory service.
export const memoryController = {
  listMessages(_req: Request, res: Response): void {
    res.json(memoryService.listMessages());
  },

  async sendMessage(req: Request, res: Response): Promise<void> {
    const body = req.body as { content?: string; personalityId?: string };
    const reply = await memoryService.sendMessage(body.content ?? '', body.personalityId ?? '');
    res.status(201).json(reply);
  },

  // Streaming variant of sendMessage: the reply's text is pushed as `delta`
  // events as it is generated, then the persisted message arrives in `done`.
  // Registered without asyncHandler — it owns its response lifecycle and reports
  // failures as an SSE `error` event once headers are flushed.
  async streamMessage(req: Request, res: Response): Promise<void> {
    const body = req.body as { content?: string; personalityId?: string };
    const send = openSseStream(res);
    try {
      const message = await memoryService.sendMessageStream(
        body.content ?? '',
        body.personalityId ?? '',
        (text) => send({ type: 'delta', text })
      );
      send({ type: 'done', message });
    } catch (error) {
      send({ type: 'error', error: error instanceof Error ? error.message : 'Request failed.' });
    } finally {
      res.end();
    }
  },

  clearMessages(_req: Request, res: Response): void {
    memoryService.clearMessages();
    res.json({ ok: true });
  },

  async propose(_req: Request, res: Response): Promise<void> {
    res.json(await memoryService.proposeUpdates());
  },

  listItems(_req: Request, res: Response): void {
    res.json(memoryService.listItems());
  },

  saveItems(req: Request, res: Response): void {
    const items = (req.body as { items: MemoryProposal[] }).items;
    res.status(201).json(memoryService.saveItems(items));
  },

  updateItem(req: Request, res: Response): void {
    res.json(memoryService.updateItem(param(req, 'id'), req.body));
  },

  deleteItem(req: Request, res: Response): void {
    memoryService.deleteItem(param(req, 'id'));
    res.json({ ok: true });
  }
};
