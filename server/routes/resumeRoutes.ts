import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { resumeController } from '../controllers/resumeController.ts';

// Mounted at /api — resume sessions and versions.
const router = Router();

// Sessions
router.get('/sessions', asyncHandler(resumeController.listSessions));
router.post('/sessions', asyncHandler(resumeController.createSession));
router.get('/sessions/:id', asyncHandler(resumeController.getSession));
router.patch('/sessions/:id', asyncHandler(resumeController.updateSession));
router.delete('/sessions/:id', asyncHandler(resumeController.deleteSession));

// Session chat
router.get('/sessions/:id/messages', asyncHandler(resumeController.listMessages));
router.post('/sessions/:id/messages', asyncHandler(resumeController.sendMessage));

// Analysis & drafts
router.post('/sessions/:id/analyze', asyncHandler(resumeController.analyze));
router.post('/sessions/:id/draft', asyncHandler(resumeController.draft));
router.post('/sessions/:id/final', asyncHandler(resumeController.markFinal));

// Versions & export
router.get('/sessions/:id/versions', asyncHandler(resumeController.listVersions));
router.get('/versions/:id', asyncHandler(resumeController.getVersion));
router.patch('/versions/:id/template', asyncHandler(resumeController.setTemplate));
router.get('/versions/:id/export', asyncHandler(resumeController.exportPdf));

export default router;
