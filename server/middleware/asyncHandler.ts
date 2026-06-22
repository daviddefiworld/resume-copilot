import type { Request, Response, RequestHandler } from 'express';

type AsyncRoute = (req: Request, res: Response) => unknown | Promise<unknown>;

// Last-resort cap on how long any single request may take before we give up and
// answer with an error. This is the backstop that guarantees a request can never
// load forever: a try/catch only rescues a promise that REJECTS, so a handler
// awaiting something that never settles (a wedged external call) would otherwise
// hang the socket with no reply. Set above the slowest legitimate buffered route —
// a resume draft (a ~140s single-shot generation, sometimes preceded by job
// analysis) — so a genuine slow-but-valid call finishes and this only fires for a
// true stall. (The streaming chat route owns its own response and isn't wrapped.)
const REQUEST_TIMEOUT_MS = 200_000;
const TIMEOUT_MESSAGE = 'The request timed out while processing. Please try again.';

// Wraps a controller method so thrown errors — and stalls — become clean JSON
// responses instead of crashing or hanging the request. AI/network failures
// surface as 400s; a request that exceeds REQUEST_TIMEOUT_MS surfaces as a 504.
export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return async (req, res, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), REQUEST_TIMEOUT_MS);
    });
    try {
      // Promise.resolve handles synchronous handlers; a sync throw is caught
      // below. Whichever settles first wins — the handler, or the timeout.
      await Promise.race([Promise.resolve(fn(req, res)), timeout]);
    } catch (error) {
      if (res.headersSent) {
        next(error);
        return;
      }
      const timedOut = error instanceof Error && error.message === TIMEOUT_MESSAGE;
      res.status(timedOut ? 504 : 400).json({ error: error instanceof Error ? error.message : 'Request failed.' });
    } finally {
      // Always clear the timer — on the normal path it would otherwise keep the
      // event loop (and the process) alive until it fires.
      clearTimeout(timer);
    }
  };
}

// Express 5 (path-to-regexp v8) types route params as `string | string[]`.
// Every route here uses a single named param, so read it as a plain string.
export function param(req: Request, name: string): string {
  return String(req.params[name]);
}
