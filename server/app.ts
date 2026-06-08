import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import path from 'path';
import { buildRouter } from './routes/index.ts';

interface AppOptions {
  clientDir?: string;
}

// Assembles the Express application: middleware plus the /api router. Kept
// separate from the entry point so the app can be built without binding a port.
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', buildRouter());
  if (options.clientDir) {
    app.use(express.static(options.clientDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(options.clientDir as string, 'index.html'));
    });
  }
  return app;
}
