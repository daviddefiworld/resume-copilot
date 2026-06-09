import { randomUUID } from 'crypto';
import { profileRepository } from '../repositories/profileRepository.ts';
import { settingsRepository } from '../repositories/settingsRepository.ts';
import type { Profile, ProfilesView } from '../../shared/types.ts';

// The active profile id lives in the settings table so it survives restarts.
const ACTIVE_KEY = 'active_profile_id';

// Owns profiles and which one is active. Memory and resume work resolve the
// active profile through here, so the rest of the app stays profile-agnostic.
class ProfileService {
  list(): Profile[] {
    return profileRepository.list();
  }

  // The active profile id, self-healing: if the stored id is missing or points
  // at a deleted profile, fall back to the first profile (or null if none).
  activeId(): string | null {
    const stored = settingsRepository.get(ACTIVE_KEY);
    if (stored && profileRepository.get(stored)) return stored;
    const [first] = profileRepository.list();
    return first ? first.id : null;
  }

  view(): ProfilesView {
    return { profiles: this.list(), activeId: this.activeId() };
  }

  setActive(id: string): void {
    if (!profileRepository.get(id)) throw new Error('Profile not found.');
    settingsRepository.set(ACTIVE_KEY, id);
  }

  create(name: string): Profile {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Profile name is required.');
    const wasEmpty = profileRepository.count() === 0;
    const profile: Profile = { id: randomUUID(), name: clean, created_at: new Date().toISOString() };
    profileRepository.insert(profile);
    // The very first profile adopts any pre-existing memory and resumes.
    if (wasEmpty) profileRepository.claimOrphans(profile.id);
    this.setActive(profile.id);
    return profile;
  }

  rename(id: string, name: string): Profile {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Profile name is required.');
    if (!profileRepository.get(id)) throw new Error('Profile not found.');
    profileRepository.rename(id, clean);
    return profileRepository.get(id) as Profile;
  }

  remove(id: string): void {
    if (!profileRepository.get(id)) throw new Error('Profile not found.');
    if (profileRepository.count() <= 1) throw new Error('You need at least one profile.');
    profileRepository.remove(id);
    // If the active profile was the one removed, fall back to the first remaining.
    if (settingsRepository.get(ACTIVE_KEY) === id) {
      const [first] = profileRepository.list();
      if (first) settingsRepository.set(ACTIVE_KEY, first.id);
      else settingsRepository.delete(ACTIVE_KEY);
    }
  }
}

export const profileService = new ProfileService();
