import type { Request, Response } from 'express';
import { atsService } from '../services/atsService.ts';

// HTTP layer for the standalone ATS score analyzer: takes a resume + job
// description and returns a strict match report. Stateless — no session needed.
export const atsController = {
  async analyze(req: Request, res: Response): Promise<void> {
    const { resume, jobDescription } = (req.body as { resume?: string; jobDescription?: string }) || {};
    res.json(await atsService.analyze({ resume: resume ?? '', jobDescription: jobDescription ?? '' }));
  }
};
