import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { usageController } from '../controllers/usageController.ts';

// Mounted at /api/usage — total OpenRouter token/cost consumption.
const router = Router();

router.get('/', asyncHandler(usageController.get));
router.post('/reset', asyncHandler(usageController.reset));

export default router;
