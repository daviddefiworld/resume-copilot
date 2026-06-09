import type { Request, Response } from 'express';
import { profileService } from '../services/profileService.ts';
import { param } from '../middleware/asyncHandler.ts';

// HTTP layer for profiles. Mutations return the full ProfilesView so the client
// can resync its list and active selection in one round trip.
export const profileController = {
  list(_req: Request, res: Response): void {
    res.json(profileService.view());
  },

  create(req: Request, res: Response): void {
    const name = (req.body as { name?: string }).name ?? '';
    profileService.create(name);
    res.status(201).json(profileService.view());
  },

  activate(req: Request, res: Response): void {
    profileService.setActive(param(req, 'id'));
    res.json(profileService.view());
  },

  rename(req: Request, res: Response): void {
    const name = (req.body as { name?: string }).name ?? '';
    res.json(profileService.rename(param(req, 'id'), name));
  },

  remove(req: Request, res: Response): void {
    profileService.remove(param(req, 'id'));
    res.json(profileService.view());
  }
};
