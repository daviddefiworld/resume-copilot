import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import type { Server } from 'node:http';
import path from 'path';
import { buildRouter } from './routes/index.ts';

interface AppOptions {
  clientDir?: string;
}

// Bound socket-level timeouts on the listening server so a slow or half-open
// connection can never hold a socket open without limit. Note these govern
// RECEIVING a request and idle keep-alive sockets, NOT how long a handler runs —
// the per-request guard in asyncHandler is what guarantees a response is sent.
// requestTimeout sits just above asyncHandler's 150s cap so the handler answers
// first; keepAliveTimeout stays low (don't inflate it — that only makes idle
// sockets linger longer).
export function applyServerTimeouts(server: Server): void {
  server.requestTimeout = 160_000;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 61_000;
  server.timeout = 0; // response time is owned by asyncHandler, not a socket timer
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
