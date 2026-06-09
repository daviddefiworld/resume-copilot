import { Router } from 'express';
import settingsRoutes from './settingsRoutes.ts';
import promptsRoutes from './promptsRoutes.ts';
import configRoutes from './configRoutes.ts';
import profileRoutes from './profileRoutes.ts';
import memoryRoutes from './memoryRoutes.ts';
import resumeRoutes from './resumeRoutes.ts';
import atsRoutes from './atsRoutes.ts';

// Combines every domain router under a single /api router.
export function buildRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.use('/settings', settingsRoutes);
  router.use('/prompts', promptsRoutes);
  router.use('/profiles', profileRoutes);
  router.use('/memory', memoryRoutes);
  router.use('/', configRoutes);
  router.use('/', resumeRoutes);
  router.use('/', atsRoutes);

  return router;
}
