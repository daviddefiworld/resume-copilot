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
// Streaming chat: owns its SSE response, so it is NOT wrapped in asyncHandler
// (whose timeout race would try to send JSON after headers are already flushed).
router.post('/sessions/:id/messages/stream', resumeController.streamMessage);
// Steering: queue a message onto the session's in-flight streaming run.
router.post('/sessions/:id/steer', asyncHandler(resumeController.steer));

// Analysis & drafts
router.post('/sessions/:id/analyze', asyncHandler(resumeController.analyze));
router.post('/sessions/:id/draft', asyncHandler(resumeController.draft));
router.post('/sessions/:id/final', asyncHandler(resumeController.markFinal));

// Versions & export
router.get('/sessions/:id/versions', asyncHandler(resumeController.listVersions));
router.get('/versions/:id', asyncHandler(resumeController.getVersion));
router.patch('/versions/:id/template', asyncHandler(resumeController.setTemplate));
router.get('/versions/:id/export', asyncHandler(resumeController.exportPdf));
router.get('/versions/:id/preview', asyncHandler(resumeController.previewPdf));

export default router;
