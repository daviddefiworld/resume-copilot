import type { Request, Response } from 'express';
import { TEMPLATES } from '../data/templates.ts';
import { personalityService } from '../services/personalityService.ts';
import { characterMemoryService } from '../services/characterMemoryService.ts';
import { profileService } from '../services/profileService.ts';

// Serves the reference data and personality configuration: the agent
// personalities (built-in presets plus the user's custom ones), the resume
// templates, and which personality currently drives the copilot.
export const configController = {
  personalities(_req: Request, res: Response): void {
    res.json(personalityService.list());
  },

  createPersonality(req: Request, res: Response): void {
    res.json(personalityService.create(req.body ?? {}));
  },

  updatePersonality(req: Request, res: Response): void {
    res.json(personalityService.update(String(req.params.id), req.body ?? {}));
  },

  resetPersonality(req: Request, res: Response): void {
    res.json(personalityService.resetOverride(String(req.params.id)));
  },

  deletePersonality(req: Request, res: Response): void {
    personalityService.delete(String(req.params.id));
    res.json({ ok: true });
  },

  // What a character remembers about the user, scoped to the active profile.
  // Read-only and surfaced in Settings → Personality. Empty when no profile yet.
  getCharacterMemory(req: Request, res: Response): void {
    const profileId = profileService.activeId();
    const personalityId = String(req.params.id);
    if (!profileId) {
      res.json({ personalityId, notes: '', summary: '', messageCount: 0, updatedAt: null });
      return;
    }
    res.json(characterMemoryService.getView(profileId, personalityId));
  },

  clearCharacterMemory(req: Request, res: Response): void {
    const profileId = profileService.activeId();
    if (profileId) characterMemoryService.clear(profileId, String(req.params.id));
    res.json({ ok: true });
  },

  getCopilot(_req: Request, res: Response): void {
    res.json(personalityService.config());
  },

  setCopilot(req: Request, res: Response): void {
    const id = String((req.body as { personalityId?: string }).personalityId || '');
    if (!id) {
      res.status(400).json({ error: 'personalityId is required.' });
      return;
    }
    res.json(personalityService.setCopilotPersonality(id));
  },

  templates(_req: Request, res: Response): void {
    res.json(TEMPLATES);
  }
};
