import { settingsRepository } from '../repositories/settingsRepository.ts';
import { PROMPT_DEFS } from '../data/promptDefaults.ts';
import type { PromptDef } from '../data/promptDefaults.ts';

const PREFIX = 'prompt:';

export interface PromptView {
  key: string;
  label: string;
  description: string;
  tokens: string[];
  value: string;
  isDefault: boolean;
}

// Replace {{token}} placeholders with provided values. Unknown tokens are left
// in place so an edited prompt that drops a token simply omits that data rather
// than printing "undefined".
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

// Owns the editable system prompts: built-in defaults plus user overrides stored
// in the settings table under "prompt:<key>". Every prompt builder reads its
// effective text from here, so edits in Settings take effect on the next call.
class PromptsService {
  private readonly defs = new Map<string, PromptDef>(PROMPT_DEFS.map((d) => [d.key, d]));

  // Effective text for a prompt: the user's override if set, else the default.
  get(key: string): string {
    const def = this.defs.get(key);
    if (!def) throw new Error(`Unknown prompt: ${key}`);
    const override = settingsRepository.get(PREFIX + key);
    return override !== undefined ? override : def.default;
  }

  list(): PromptView[] {
    return PROMPT_DEFS.map((def) => {
      const override = settingsRepository.get(PREFIX + def.key);
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        tokens: def.tokens,
        value: override !== undefined ? override : def.default,
        isDefault: override === undefined
      };
    });
  }

  // Save an override. Saving text equal to the default clears the override so the
  // prompt is reported as default again.
  set(key: string, value: string): PromptView {
    const def = this.defs.get(key);
    if (!def) throw new Error(`Unknown prompt: ${key}`);
    if (typeof value !== 'string' || !value.trim()) throw new Error('Prompt text is required.');
    if (value === def.default) {
      settingsRepository.delete(PREFIX + key);
    } else {
      settingsRepository.set(PREFIX + key, value);
    }
    return this.viewOf(def.key);
  }

  // Reset to the built-in default by clearing the override.
  reset(key: string): PromptView {
    if (!this.defs.has(key)) throw new Error(`Unknown prompt: ${key}`);
    settingsRepository.delete(PREFIX + key);
    return this.viewOf(key);
  }

  private viewOf(key: string): PromptView {
    const view = this.list().find((p) => p.key === key);
    if (!view) throw new Error(`Unknown prompt: ${key}`);
    return view;
  }
}

export const promptsService = new PromptsService();
