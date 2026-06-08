import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import { buildRouter } from './routes/index.ts';

// Assembles the Express application: middleware plus the /api router. Kept
// separate from the entry point so the app can be built without binding a port.
export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', buildRouter());
  return app;
}
