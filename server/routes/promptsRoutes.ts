import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { promptsController } from '../controllers/promptsController.ts';

// Mounted at /api/prompts
const router = Router();

router.get('/', asyncHandler(promptsController.list));
router.put('/:key', asyncHandler(promptsController.update));
router.delete('/:key', asyncHandler(promptsController.reset));

export default router;
