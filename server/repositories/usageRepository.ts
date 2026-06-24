import { db, type Statement } from '../database/connection.ts';

// Running totals for OpenRouter API consumption. A single accumulator row
// (id = 1); every outbound call adds its reported usage, and the user can reset
// it from Settings. Cost is the actual USD OpenRouter billed for each call
// (it returns it per request), so no static price table is needed.
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
  updatedAt: string | null;
}

interface UsageRow {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
  updated_at: string;
}

const ZERO: UsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
  requests: 0,
  updatedAt: null
};

// Data access for the usage_totals accumulator. No business rules here — the
// service validates the raw OpenRouter usage shape before it reaches add().
class UsageRepository {
  private readonly getStmt: Statement;
  private readonly addStmt: Statement;
  private readonly resetStmt: Statement;

  constructor() {
    this.getStmt = db.prepare(
      'SELECT prompt_tokens, completion_tokens, total_tokens, cost, requests, updated_at ' +
        'FROM usage_totals WHERE id = 1'
    );
    // Upsert the single row, incrementing each counter by the call's usage.
    this.addStmt = db.prepare(
      'INSERT INTO usage_totals (id, prompt_tokens, completion_tokens, total_tokens, cost, requests, updated_at) ' +
        'VALUES (1, :prompt, :completion, :total, :cost, 1, :now) ' +
        'ON CONFLICT(id) DO UPDATE SET ' +
        'prompt_tokens = prompt_tokens + excluded.prompt_tokens, ' +
        'completion_tokens = completion_tokens + excluded.completion_tokens, ' +
        'total_tokens = total_tokens + excluded.total_tokens, ' +
        'cost = cost + excluded.cost, ' +
        'requests = requests + 1, ' +
        'updated_at = excluded.updated_at'
    );
    this.resetStmt = db.prepare('DELETE FROM usage_totals WHERE id = 1');
  }

  get(): UsageTotals {
    const row = this.getStmt.get() as UsageRow | undefined;
    if (!row) return { ...ZERO };
    return {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      cost: row.cost,
      requests: row.requests,
      updatedAt: row.updated_at || null
    };
  }

  add(delta: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number }): void {
    this.addStmt.run({
      prompt: delta.promptTokens,
      completion: delta.completionTokens,
      total: delta.totalTokens,
      cost: delta.cost,
      now: new Date().toISOString()
    });
  }

  reset(): void {
    this.resetStmt.run();
  }
}

export const usageRepository = new UsageRepository();
