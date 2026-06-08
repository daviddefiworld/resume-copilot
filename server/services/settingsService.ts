import { settingsRepository } from '../repositories/settingsRepository.ts';
import type { SettingsView } from '../../shared/types.ts';

const API_KEY = 'openrouter_api_key';
const MODEL = 'openrouter_model';
const MODEL_2 = 'openrouter_model_2';
const DEFAULT_MODEL = 'anthropic/claude-3.7-sonnet';

// Business rules for configuration: stored value first, then environment
// fallback. The raw API key never leaves this layer — only publicView() is
// exposed to controllers, and it reports whether a key exists, not its value.
class SettingsService {
  apiKey(): string {
    return settingsRepository.get(API_KEY) || process.env.OPENROUTER_API_KEY || '';
  }

  // Primary model: chat, job extraction, job analysis.
  model(): string {
    return settingsRepository.get(MODEL) || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  }

  // The optional second model exactly as configured (may be blank).
  secondModel(): string {
    return settingsRepository.get(MODEL_2) || process.env.OPENROUTER_MODEL_2 || '';
  }

  // The higher-accuracy model: the configured second model, or the primary model
  // when none is set. Used for the work that most rewards accuracy — writing the
  // final resume and extracting/merging long-term memory.
  advancedModel(): string {
    return this.secondModel().trim() || this.model();
  }

  // Model used to produce the final resume (draft + revision).
  finalModel(): string {
    return this.advancedModel();
  }

  update(input: { apiKey?: string; model?: string; model2?: string }): SettingsView {
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      settingsRepository.set(API_KEY, input.apiKey.trim());
    }
    if (typeof input.model === 'string' && input.model.trim()) {
      settingsRepository.set(MODEL, input.model.trim());
    }
    // model2 is set whenever present (blank clears it, restoring the fallback).
    if (typeof input.model2 === 'string') {
      settingsRepository.set(MODEL_2, input.model2.trim());
    }
    return this.publicView();
  }

  publicView(): SettingsView {
    return { hasApiKey: Boolean(this.apiKey()), model: this.model(), model2: this.secondModel() };
  }
}

export const settingsService = new SettingsService();
