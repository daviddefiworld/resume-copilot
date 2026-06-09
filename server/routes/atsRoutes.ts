import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { atsController } from '../controllers/atsController.ts';

// Mounted at /api — the standalone ATS score analyzer.
const router = Router();

router.post('/ats/analyze', asyncHandler(atsController.analyze));

export default router;
