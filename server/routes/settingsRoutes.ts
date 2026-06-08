import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { settingsController } from '../controllers/settingsController.ts';

// Mounted at /api/settings
const router = Router();

router.get('/', asyncHandler(settingsController.get));
router.post('/', asyncHandler(settingsController.update));

export default router;
