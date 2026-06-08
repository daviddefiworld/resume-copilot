import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { configController } from '../controllers/configController.ts';

// Mounted at /api — static reference data.
const router = Router();

router.get('/personalities', asyncHandler(configController.personalities));
router.get('/templates', asyncHandler(configController.templates));

export default router;
