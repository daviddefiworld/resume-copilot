import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { configController } from '../controllers/configController.ts';

// Mounted at /api — static reference data.
const router = Router();

router.get('/personalities', asyncHandler(configController.personalities));
router.post('/personalities', asyncHandler(configController.createPersonality));
router.patch('/personalities/:id', asyncHandler(configController.updatePersonality));
router.post('/personalities/:id/reset', asyncHandler(configController.resetPersonality));
router.delete('/personalities/:id', asyncHandler(configController.deletePersonality));
router.get('/personalities/:id/memory', asyncHandler(configController.getCharacterMemory));
router.delete('/personalities/:id/memory', asyncHandler(configController.clearCharacterMemory));
router.get('/copilot', asyncHandler(configController.getCopilot));
router.put('/copilot', asyncHandler(configController.setCopilot));
router.get('/templates', asyncHandler(configController.templates));

export default router;
