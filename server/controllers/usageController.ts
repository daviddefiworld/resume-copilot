import type { Request, Response } from 'express';
import { usageService } from '../services/usageService.ts';

// HTTP layer for API usage totals. No business logic — delegates to the service.
export const usageController = {
  get(_req: Request, res: Response): void {
    res.json(usageService.view());
  },

  reset(_req: Request, res: Response): void {
    res.json(usageService.reset());
  }
};
