import type { Response } from 'express';

// Open a Server-Sent-Events stream on the response and return a function that
// writes one JSON event (`data: {...}\n\n`). Headers are flushed immediately so
// the client's fetch promise resolves and it can start reading before the first
// token — important for canvas turns, which emit nothing until they finish.
//
// Streaming handlers report ALL failures as an `{ type: 'error' }` event rather
// than an HTTP status, because the 200 headers are already on the wire by the
// time the work runs; the client treats that event as a thrown error.
export function openSseStream(res: Response): (event: unknown) => void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering so chunks flush promptly
  res.flushHeaders();
  // If the client navigates away mid-stream, later writes hit a dead socket. Swallow
  // the resulting stream error (it would otherwise be unhandled) and skip writes once
  // the connection is gone — the agent run finishes harmlessly within its own budget.
  res.on('error', () => {});
  return (event: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}
