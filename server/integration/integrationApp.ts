import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { integrationService } from '../services/integrationService.ts';

// A deliberately tiny, web-facing HTTP surface bound to a FIXED loopback port so
// the Lazybidder dashboard can (a) detect this desktop app is running and (b) ask
// it to start a job hunt. It exposes ONLY these two routes — never the full /api —
// so a predictable port can't be used by any site the user visits to read their
// sessions, memory, or profiles. CORS is open to all origins (only ping + start
// are exposed) and answers Chrome's Private Network Access preflight.
export function createIntegrationApp(): Express {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(integrationCors);

  // Detection probe: the dashboard pings this to decide whether to show the
  // "Apply with Copilot" button.
  app.get('/integration/ping', (_req, res) => {
    res.json({ ok: true, app: 'job-hunter-copilot' });
  });

  // Start a job hunt for one job id. Parks the intent + raises the window.
  app.post('/integration/start', (req: Request, res: Response) => {
    const jobId = String((req.body as { job_id?: unknown })?.job_id ?? '').trim();
    if (!jobId) {
      res.status(400).json({ error: 'job_id is required.' });
      return;
    }
    const intent = integrationService.requestStart(jobId);
    res.json({ ok: true, job_id: intent.job_id });
  });

  return app;
}

// CORS + Chrome Private Network Access for the bridge. A secure (https) page on a
// public origin reaching http://127.0.0.1 triggers a PNA preflight that must be
// answered with Access-Control-Allow-Private-Network: true, on top of normal CORS
// headers. Open to ALL origins: we reflect the caller's Origin (falling back to *
// when absent) so any dashboard host works with zero config — the bridge's surface
// is only ping + start, never the user's data.
function integrationCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', typeof origin === 'string' ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
