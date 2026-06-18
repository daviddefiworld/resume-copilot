import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { documentController } from '../controllers/documentController.ts';

// Mounted at /api — per-session workspace documents.
const router = Router();

router.get('/sessions/:id/documents', asyncHandler(documentController.list));
router.post('/sessions/:id/documents', asyncHandler(documentController.create));
router.patch('/documents/:id', asyncHandler(documentController.update));
router.delete('/documents/:id', asyncHandler(documentController.delete));

export default router;
