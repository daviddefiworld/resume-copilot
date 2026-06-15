import {
  Bot, Box, Brain, Cat, Compass, Cpu, Crown, Flame, Gem, Heart, HeartPulse,
  Rocket, Shield, Smile, Sparkles, Star, Sun, Zap
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { Personality } from '../shared/types.ts';

// Maps a personality's `icon` key to a Lucide component, so the copilot's brand
// mark and chat avatar can take on the chosen personality's look. The keys here
// are also the menu offered when creating a custom personality.
export const PERSONA_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  cat: Cat,
  bot: Bot,
  cpu: Cpu,
  brain: Brain,
  shield: Shield,
  heart: Heart,
  'heart-pulse': HeartPulse,
  sparkles: Sparkles,
  sun: Sun,
  star: Star,
  rocket: Rocket,
  smile: Smile,
  zap: Zap,
  compass: Compass,
  crown: Crown,
  flame: Flame,
  gem: Gem,
  box: Box
};

export const PERSONA_ICON_KEYS = Object.keys(PERSONA_ICONS);

// A small, friendly palette offered when creating a personality.
export const PERSONA_ACCENTS = [
  '#e8833a', '#4f9dff', '#ff6f91', '#5bc0c9',
  '#a78bfa', '#3ecf8e', '#ef6b76', '#f5b544'
];

// Stable hue from a string, so a custom personality without a chosen colour
// still gets a consistent, distinct accent rather than a flat default.
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

export interface PersonaVisual {
  Icon: ComponentType<{ size?: number }>;
  accent: string;
  // A soft top-lit gradient built from the accent, for the rounded mark/avatar.
  gradient: string;
}

// Resolve a personality (or null, before one loads) to its icon + colours.
export function personaVisual(p: Personality | null | undefined): PersonaVisual {
  const Icon = (p?.icon && PERSONA_ICONS[p.icon]) || (p ? Bot : Cat);
  const accent = p?.accent || (p ? `hsl(${hueFromId(p.id)} 68% 60%)` : '#e8833a');
  const gradient = `linear-gradient(150deg, color-mix(in srgb, ${accent} 60%, #ffffff), ${accent})`;
  return { Icon, accent, gradient };
}
