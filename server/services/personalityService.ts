import { randomUUID } from 'crypto';
import { settingsRepository } from '../repositories/settingsRepository.ts';
import { PERSONALITIES, getPersonality as getBuiltin } from '../data/personalities.ts';
import type { CopilotConfig, Personality } from '../../shared/types.ts';

const CUSTOM_KEY = 'custom_personalities';
const SELECTED_KEY = 'copilot_personality_id';
// Per-built-in field overrides (e.g. an edited Sox), keyed by personality id.
// Built-ins stay defined in code; this layer records only what the user changed.
const OVERRIDES_KEY = 'personality_overrides';

// Fields a user supplies when creating or editing a personality. Communication
// style only — the factual guardrails in prompts.ts apply to every personality.
export interface PersonalityInput {
  name: string;
  description?: string;
  tone?: string;
  critiqueIntensity?: string;
  reasoningStyle?: string;
  resumeBias?: string;
  mission?: string;
  icon?: string;
  accent?: string;
}

// Owns the set of agent personalities: the built-in fictional-AI presets plus
// any the user created (stored as JSON in the settings table), and which one
// currently drives the copilot chat. Built-ins are read-only; only custom
// personalities can be edited or removed.
class PersonalityService {
  private readCustom(): Personality[] {
    const raw = settingsRepository.get(CUSTOM_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Personality[];
      return Array.isArray(parsed) ? parsed.map((p) => ({ ...p, builtin: false })) : [];
    } catch {
      return [];
    }
  }

  private writeCustom(list: Personality[]): void {
    settingsRepository.set(CUSTOM_KEY, JSON.stringify(list));
  }

  private readOverrides(): Record<string, Partial<Personality>> {
    const raw = settingsRepository.get(OVERRIDES_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<Personality>>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeOverrides(map: Record<string, Partial<Personality>>): void {
    settingsRepository.set(OVERRIDES_KEY, JSON.stringify(map));
  }

  // Layer any saved edits onto a built-in. It stays a built-in (still resettable)
  // — only the changed fields differ from what ships in code.
  private applyOverrides(p: Personality, overrides = this.readOverrides()): Personality {
    const o = overrides[p.id];
    return o ? { ...p, ...o, builtin: true } : p;
  }

  // Built-ins (with any edits applied) first, then the user's own. Drives the
  // picker and the API.
  list(): Personality[] {
    const overrides = this.readOverrides();
    return [...PERSONALITIES.map((p) => this.applyOverrides(p, overrides)), ...this.readCustom()];
  }

  // Resolve an id to a personality, preferring custom, then built-in (with edits
  // applied), then the default. Never throws — an unknown id falls back to the
  // default copilot.
  get(id: string | undefined): Personality {
    const custom = this.readCustom().find((p) => p.id === id);
    if (custom) return custom;
    return this.applyOverrides(getBuiltin(id));
  }

  create(input: PersonalityInput): Personality {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('A personality name is required.');
    const personality: Personality = {
      id: `custom_${randomUUID()}`,
      name,
      description: String(input.description || '').trim() || `${name} — a custom copilot personality.`,
      tone: String(input.tone || '').trim() || 'helpful and clear',
      critiqueIntensity: String(input.critiqueIntensity || '').trim() || 'medium',
      reasoningStyle: String(input.reasoningStyle || '').trim() || 'focus on what most improves the outcome',
      resumeBias: String(input.resumeBias || '').trim() || 'clear, honest, outcome-led writing',
      builtin: false,
      mission: String(input.mission || '').trim() || undefined,
      icon: String(input.icon || '').trim() || 'bot',
      accent: String(input.accent || '').trim() || '#a78bfa'
    };
    this.writeCustom([...this.readCustom(), personality]);
    return personality;
  }

  // Edit a personality — a custom one in place, or a built-in via an override
  // layer so the shipped default can still be restored. Only non-empty fields
  // are applied, so clearing a field keeps the existing/built-in value.
  update(id: string, input: PersonalityInput): Personality {
    if (!String(input.name || '').trim()) throw new Error('A personality name is required.');
    const fields = this.cleanFields(input);

    const custom = this.readCustom();
    const idx = custom.findIndex((p) => p.id === id);
    if (idx >= 0) {
      custom[idx] = { ...custom[idx], ...fields, id, builtin: false };
      this.writeCustom(custom);
      return custom[idx];
    }

    if (!PERSONALITIES.some((p) => p.id === id)) throw new Error('Personality not found.');
    const overrides = this.readOverrides();
    overrides[id] = fields;
    this.writeOverrides(overrides);
    return this.get(id);
  }

  // Drop any edits to a built-in, restoring the version shipped in code.
  resetOverride(id: string): Personality {
    const overrides = this.readOverrides();
    if (overrides[id]) {
      delete overrides[id];
      this.writeOverrides(overrides);
    }
    return this.get(id);
  }

  // Keep only the non-empty, user-editable fields, trimmed.
  private cleanFields(input: PersonalityInput): Partial<Personality> {
    const out: Partial<Personality> = {};
    const t = (v?: string): string => String(v ?? '').trim();
    if (t(input.name)) out.name = t(input.name);
    if (t(input.description)) out.description = t(input.description);
    if (t(input.tone)) out.tone = t(input.tone);
    if (t(input.critiqueIntensity)) out.critiqueIntensity = t(input.critiqueIntensity);
    if (t(input.reasoningStyle)) out.reasoningStyle = t(input.reasoningStyle);
    if (t(input.resumeBias)) out.resumeBias = t(input.resumeBias);
    if (t(input.mission)) out.mission = t(input.mission);
    if (t(input.icon)) out.icon = t(input.icon);
    if (t(input.accent)) out.accent = t(input.accent);
    return out;
  }

  delete(id: string): void {
    const remaining = this.readCustom().filter((p) => p.id !== id);
    this.writeCustom(remaining);
    // If the deleted personality was the active copilot, fall back to the default.
    if (settingsRepository.get(SELECTED_KEY) === id) {
      settingsRepository.delete(SELECTED_KEY);
    }
  }

  // Which personality drives the copilot chat. Defaults to the first built-in
  // (Sox) when nothing has been chosen, or when a stale id no longer resolves.
  config(): CopilotConfig {
    const id = settingsRepository.get(SELECTED_KEY);
    const resolved = this.get(id ?? undefined);
    return { personalityId: resolved.id };
  }

  setCopilotPersonality(id: string): CopilotConfig {
    const resolved = this.get(id);
    settingsRepository.set(SELECTED_KEY, resolved.id);
    return { personalityId: resolved.id };
  }
}

export const personalityService = new PersonalityService();
