import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { mcpController } from '../controllers/mcpController.ts';

// Mounted at /api/mcp
const router = Router();

router.get('/servers', asyncHandler(mcpController.listServers));
router.get('/catalog', asyncHandler(mcpController.catalog));
router.post('/servers', asyncHandler(mcpController.addServer));
router.post('/import', asyncHandler(mcpController.importServers));
router.patch('/servers/:id', asyncHandler(mcpController.updateServer));
router.delete('/servers/:id', asyncHandler(mcpController.deleteServer));
router.post('/servers/:id/test', asyncHandler(mcpController.testServer));

export default router;
