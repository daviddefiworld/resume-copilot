import type { Request, Response } from 'express';
import { promptsService } from '../services/promptsService.ts';
import { param } from '../middleware/asyncHandler.ts';

// HTTP layer for the editable system prompts. Lists prompts, saves an override,
// or resets one to its built-in default.
export const promptsController = {
  list(_req: Request, res: Response): void {
    res.json(promptsService.list());
  },

  update(req: Request, res: Response): void {
    const value = (req.body as { value?: string }).value ?? '';
    res.json(promptsService.set(param(req, 'key'), value));
  },

  reset(req: Request, res: Response): void {
    res.json(promptsService.reset(param(req, 'key')));
  }
};
