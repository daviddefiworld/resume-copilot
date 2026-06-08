import type { Request, Response } from 'express';
import { settingsService } from '../services/settingsService.ts';

// HTTP layer for configuration. No business logic — it delegates to the service
// and shapes the response.
export const settingsController = {
  get(_req: Request, res: Response): void {
    res.json(settingsService.publicView());
  },

  update(req: Request, res: Response): void {
    const body = req.body as { apiKey?: string; model?: string; model2?: string };
    res.json(settingsService.update(body));
  }
};
