import {
  Bot, Box, Brain, Cat, Compass, Cpu, Crown, Flame, Gem, Heart, HeartPulse,
  Rocket, Shield, Smile, Sparkles, Star, Sun, Zap
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
  // Optional avatar image; when present it renders in place of the icon.
  image?: string;
}

// Resolve a personality (or null, before one loads) to its icon + colours.
export function personaVisual(p: Personality | null | undefined): PersonaVisual {
  const Icon = (p?.icon && PERSONA_ICONS[p.icon]) || (p ? Bot : Cat);
  const accent = p?.accent || (p ? `hsl(${hueFromId(p.id)} 68% 60%)` : '#e8833a');
  const gradient = `linear-gradient(150deg, color-mix(in srgb, ${accent} 60%, #ffffff), ${accent})`;
  return { Icon, accent, gradient, image: p?.image || undefined };
}

// The copilot's avatar mark, used everywhere the personality shows: the sidebar
// brand, the chat greeting/header, the message avatars, and the picker. Renders
// the personality's `image` when it has one (on the accent gradient, so a
// transparent cutout still reads), otherwise its icon — and falls back to the
// icon if the image fails to load (e.g. a not-yet-added file or a dead URL).
// `bare` returns just the glyph (no wrapper span), for dropping inside an
// existing avatar box like the chat's `.avatar`. `zoomable` (non-bare, image
// only) makes the mark clickable to open the image larger in a lightbox modal.
export function PersonaMark({
  persona,
  size,
  className = 'personaMark',
  bare = false,
  zoomable = false
}: {
  persona: Personality | null | undefined;
  size: number;
  className?: string;
  bare?: boolean;
  zoomable?: boolean;
}) {
  const visual = personaVisual(persona);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  // Re-try when the source changes (e.g. while typing the image URL in the form).
  useEffect(() => setFailed(false), [visual.image]);
  const showImg = Boolean(visual.image) && !failed;

  const glyph = showImg ? (
    <img className="personaImg" src={visual.image} alt="" draggable={false} onError={() => setFailed(true)} />
  ) : (
    <visual.Icon size={size} />
  );

  if (bare) return glyph;

  const canZoom = zoomable && showImg;
  return (
    <>
      <span
        className={`${showImg ? `${className} hasImage` : className}${canZoom ? ' pfpZoom' : ''}`}
        style={{ background: visual.gradient }}
        onClick={canZoom ? () => setZoom(true) : undefined}
        role={canZoom ? 'button' : undefined}
        tabIndex={canZoom ? 0 : undefined}
        aria-label={canZoom ? `View ${persona?.name ?? 'avatar'} image` : undefined}
        onKeyDown={canZoom ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(true); } } : undefined}
      >
        {glyph}
      </span>
      {zoom && canZoom && (
        <div className="pfpModalBackdrop" onClick={() => setZoom(false)} role="dialog" aria-modal="true">
          <img className="pfpModalImg" src={visual.image} alt={persona?.name ?? ''} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
