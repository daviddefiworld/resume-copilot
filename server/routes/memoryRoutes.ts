import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { memoryController } from '../controllers/memoryController.ts';

// Mounted at /api/memory
const router = Router();

router.get('/messages', asyncHandler(memoryController.listMessages));
router.post('/messages', asyncHandler(memoryController.sendMessage));
// Streaming chat: owns its SSE response, so it is NOT wrapped in asyncHandler
// (whose timeout race would try to send JSON after headers are already flushed).
router.post('/messages/stream', memoryController.streamMessage);
router.delete('/messages', asyncHandler(memoryController.clearMessages));
router.post('/propose', asyncHandler(memoryController.propose));
router.get('/items', asyncHandler(memoryController.listItems));
router.post('/items', asyncHandler(memoryController.saveItems));
router.patch('/items/:id', asyncHandler(memoryController.updateItem));
router.delete('/items/:id', asyncHandler(memoryController.deleteItem));

export default router;
