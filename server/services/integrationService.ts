import type { IntegrationIntent } from '../../shared/types.ts';

// Bridges an external "start a job hunt" request (from the Lazybidder dashboard,
// received on the fixed-port integration server) into the running app. It parks
// the intent for the renderer to pick up on its next poll, and raises the desktop
// window so the app comes to the foreground. A process singleton, so the
// integration server and the main /api server share one in-process queue.
class IntegrationService {
  private queue: IntegrationIntent[] = [];
  private focusHandler: (() => void) | null = null;
  // Cap the backlog so a closed/never-polling renderer can't grow it without
  // bound; oldest intents fall off first.
  private static readonly MAX_QUEUED = 5;

  // electron/main.ts registers how to raise the desktop window.
  setFocusHandler(handler: () => void): void {
    this.focusHandler = handler;
  }

  // Called by the fixed-port integration server when the dashboard asks to start a
  // hunt. Parks the intent and brings the window forward. The kickoff message is
  // built here so the job id is always carried into the conversation verbatim.
  requestStart(jobId: string): IntegrationIntent {
    const job_id = String(jobId || '').trim();
    if (!job_id) throw new Error('job_id is required.');
    const intent: IntegrationIntent = {
      job_id,
      message: `I wanna apply this job with jobid ${job_id}`,
      created_at: new Date().toISOString()
    };
    this.queue.push(intent);
    if (this.queue.length > IntegrationService.MAX_QUEUED) this.queue.shift();
    // Raising the window is best-effort — never let it break accepting the intent.
    try { this.focusHandler?.(); } catch { /* focusing is best-effort */ }
    return intent;
  }

  // The renderer polls this; returns the next parked intent (FIFO) and removes it.
  takePending(): IntegrationIntent | null {
    return this.queue.shift() ?? null;
  }
}

export const integrationService = new IntegrationService();
