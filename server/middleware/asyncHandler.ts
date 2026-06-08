import type { Request, Response, RequestHandler } from 'express';

type AsyncRoute = (req: Request, res: Response) => unknown | Promise<unknown>;

// Wraps a controller method so thrown errors become clean JSON responses
// instead of crashing the request. AI/network failures surface as 400s with a
// message the frontend can show.
export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (res.headersSent) {
        next(error);
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : 'Request failed.' });
    }
  };
}

// Express 5 (path-to-regexp v8) types route params as `string | string[]`.
// Every route here uses a single named param, so read it as a plain string.
export function param(req: Request, name: string): string {
  return String(req.params[name]);
}
