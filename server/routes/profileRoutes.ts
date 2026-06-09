import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { profileController } from '../controllers/profileController.ts';

// Mounted at /api/profiles
const router = Router();

router.get('/', asyncHandler(profileController.list));
router.post('/', asyncHandler(profileController.create));
router.post('/:id/activate', asyncHandler(profileController.activate));
router.patch('/:id', asyncHandler(profileController.rename));
router.delete('/:id', asyncHandler(profileController.remove));

export default router;
