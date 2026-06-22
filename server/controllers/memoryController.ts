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
    // Stop button / client disconnect closes the socket → abort the run so it stops
    // calling the model instead of finishing (and billing) in the background.
    const stop = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) stop.abort(); });
    try {
      const message = await memoryService.sendMessageStream(
        body.content ?? '',
        body.personalityId ?? '',
        (text) => send({ type: 'delta', text }),
        // Live "thinking"/tool status events ride the same SSE stream; the client
        // ignores unknown event types, so this stays backward-compatible.
        send,
        stop.signal
      );
      finished = true;
      send({ type: 'done', message });
    } catch (error) {
      // A user stop ('Cancelled') is not a failure — the socket is already gone.
      if (!(error instanceof Error && error.name === 'Cancelled')) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'Request failed.' });
      }
    } finally {
      res.end();
    }
  },

  clearMessages(_req: Request, res: Response): void {
    memoryService.clearMessages();
    res.json({ ok: true });
  },

  // Flush the un-reflected tail of the copilot chat into character memory. Fired
  // when the user leaves the copilot chat for a job-hunt session. Returns at once;
  // the reflection itself runs in the background server-side.
  flushReflection(_req: Request, res: Response): void {
    res.json(memoryService.flushCharacterReflection());
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
