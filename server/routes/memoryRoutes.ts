import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { memoryController } from '../controllers/memoryController.ts';

// Mounted at /api/memory
const router = Router();

router.get('/messages', asyncHandler(memoryController.listMessages));
router.post('/messages', asyncHandler(memoryController.sendMessage));
router.post('/propose', asyncHandler(memoryController.propose));
router.get('/items', asyncHandler(memoryController.listItems));
router.post('/items', asyncHandler(memoryController.saveItems));
router.patch('/items/:id', asyncHandler(memoryController.updateItem));
router.delete('/items/:id', asyncHandler(memoryController.deleteItem));

export default router;
