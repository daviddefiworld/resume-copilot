import { usageRepository } from '../repositories/usageRepository.ts';
import type { UsageView } from '../../shared/types.ts';

// Coerce an unknown field to a finite, non-negative number (0 otherwise). The
// usage object comes straight off the wire, so every field is validated.
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// Accumulates OpenRouter usage across every outbound call so Settings can show
// total tokens and spend. Cost is OpenRouter's own per-call figure (returned when
// the request asks for `usage: { include: true }`), which already reflects the
// model's live price and any prompt caching — so there is no price table to keep.
class UsageService {
  // Record one call's usage. Accepts the raw OpenRouter `usage` object (any
  // shape) and is best-effort: accounting must NEVER break a chat turn, so a
  // malformed or missing usage block is silently ignored.
  record(usage: unknown): void {
    try {
      if (!usage || typeof usage !== 'object') return;
      const u = usage as Record<string, unknown>;
      const promptTokens = num(u.prompt_tokens);
      const completionTokens = num(u.completion_tokens);
      const totalTokens = num(u.total_tokens) || promptTokens + completionTokens;
      const cost = num(u.cost);
      if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0 && cost === 0) return;
      usageRepository.add({ promptTokens, completionTokens, totalTokens, cost });
    } catch {
      // Swallow — usage tracking is auxiliary and must not surface to the user.
    }
  }

  view(): UsageView {
    return usageRepository.get();
  }

  reset(): UsageView {
    usageRepository.reset();
    return usageRepository.get();
  }
}

export const usageService = new UsageService();
