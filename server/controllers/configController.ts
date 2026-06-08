import type { Request, Response } from 'express';
import { PERSONALITIES } from '../data/personalities.ts';
import { TEMPLATES } from '../data/templates.ts';

// Serves the static reference data (agent personalities and resume templates).
export const configController = {
  personalities(_req: Request, res: Response): void {
    res.json(PERSONALITIES);
  },

  templates(_req: Request, res: Response): void {
    res.json(TEMPLATES);
  }
};
