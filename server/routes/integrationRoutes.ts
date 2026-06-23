import { Router } from 'express';
import { integrationService } from '../services/integrationService.ts';

// Renderer-only: the app polls this (same-origin, on the main /api server — NOT the
// web-facing fixed-port bridge) to pick up a job-hunt handoff parked by the bridge.
// Consume-on-read: returns the next intent and removes it from the queue.
const router = Router();

router.get('/integration/pending', (_req, res) => {
  res.json({ intent: integrationService.takePending() });
});

export default router;
