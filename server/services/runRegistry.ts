import { randomUUID } from 'crypto';

// Live events pushed down a turn's open SSE stream, alongside the prose `delta`s.
// `plan`/`status`/`steer_ack` are additive — the client ignores unknown types, so
// they are backward-compatible with the existing delta/done/error protocol.
export type RunEvent =
  | { type: 'plan'; body: string }
  | { type: 'status'; step: number; tool?: string; phase: string }
  | { type: 'steer_ack'; text: string; deferred?: boolean };

// A handle to one in-flight chat run for a session. It co-locates everything a
// concurrent steer request and the agent loop need to coordinate: a FIFO mailbox
// of steer messages, a sink to persist a consumed steer, and a sink to push live
// events down the run's open SSE stream. Single Node process → no locking needed.
export class RunHandle {
  readonly runId = randomUUID();
  // Cleared the instant the agent loop returns, so a steer that lands during
  // teardown is rejected (409) rather than queued onto a dead run.
  acceptingSteers = true;
  // Durably write a consumed steer as a role:'user' message. The closure stamps a
  // strictly-increasing per-run timestamp, so FIFO order survives reload.
  readonly persistSteer: (text: string) => void;
  // Push a live event down the run's SSE stream. No-ops if the socket is gone.
  readonly pushEvent: (event: RunEvent) => void;
  private queue: string[] = [];

  constructor(
    persistSteer: (text: string) => void,
    pushEvent: (event: RunEvent) => void
  ) {
    this.persistSteer = persistSteer;
    this.pushEvent = pushEvent;
  }

  enqueue(text: string): void {
    this.queue.push(text);
  }

  // Synchronously take everything queued. NEVER awaits, so the agent loop spends
  // zero wall-clock budget checking for steers.
  drain(): string[] {
    return this.queue.splice(0, this.queue.length);
  }
}

// One active run per session. register() throws on a concurrent same-session run
// (the UI also blocks a second normal send while busy), so mailbox ownership is
// never ambiguous; release() is runId-guarded so a late release from a finished
// run can't evict a newer one.
class RunRegistry {
  private readonly runs = new Map<string, RunHandle>();

  register(
    sessionId: string,
    sinks: { persistSteer: (text: string) => void; pushEvent: (event: RunEvent) => void }
  ): RunHandle {
    if (this.runs.has(sessionId)) {
      throw new Error('A chat turn is already running for this session.');
    }
    const handle = new RunHandle(sinks.persistSteer, sinks.pushEvent);
    this.runs.set(sessionId, handle);
    return handle;
  }

  get(sessionId: string): RunHandle | undefined {
    return this.runs.get(sessionId);
  }

  release(sessionId: string, runId: string): void {
    const current = this.runs.get(sessionId);
    if (current && current.runId === runId) {
      this.runs.delete(sessionId);
    }
  }
}

export const runRegistry = new RunRegistry();
