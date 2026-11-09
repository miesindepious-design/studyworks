/**
 * accents.ts — accent colour themes, independent of light/dark mode.
 *
 * The user picks a "mood" (accent pair); combined with the existing
 * light/dark/system mode this gives every palette × surface combination.
 *
 * Each theme defines:
 *   a   — primary accent (buttons, links, active nav, glows)
 *   b   — secondary accent (gradient partner, soft-2 washes)
 *   ink — text colour drawn ON accent surfaces (white unless the accent is
 *         light enough to need dark text, e.g. amber/lime)
 *
 * Derived tokens (soft washes, glow) are computed in App.tsx with
 * color-mix() from `a`/`b`, separately for light and dark surfaces.
 */

export interface AccentTheme {
  id:   string;
  label: string;
  a:    string;
  b:    string;
  ink?: string; // override when white text on `a` is unreadable
}

export const ACCENT_THEMES: AccentTheme[] = [
  { id: 'sunset',  label: 'Sunset',    a: '#FF5136', b: '#FFC531' },
  { id: 'indigo',  label: 'Indigo',    a: '#6366F1', b: '#A5B4FC' },
  { id: 'violet',  label: 'Violet',    a: '#8B5CF6', b: '#C4B5FD' },
  { id: 'plum',    label: 'Plum',      a: '#A855F7', b: '#D8B4FE' },
  { id: 'ocean',   label: 'Ocean',     a: '#0EA5E9', b: '#7DD3FC' },
  { id: 'cyan',    label: 'Cyan',      a: '#06B6D4', b: '#67E8F9' },
  { id: 'emerald', label: 'Emerald',   a: '#10B981', b: '#6EE7B7' },
  { id: 'teal',    label: 'Teal',      a: '#14B8A6', b: '#5EEAD4' },
  { id: 'forest',  label: 'Forest',    a: '#16A34A', b: '#86EFAC' },
  { id: 'lime',    label: 'Lime',      a: '#84CC16', b: '#BEF264', ink: '#211D16' },
  { id: 'amber',   label: 'Amber',     a: '#F59E0B', b: '#FCD34D', ink: '#211D16' },
  { id: 'gold',    label: 'Gold',      a: '#D97706', b: '#FBBF24' },
  { id: 'crimson', label: 'Crimson',   a: '#DC2626', b: '#FCA5A5' },
  { id: 'rose',    label: 'Rose',      a: '#F43F5E', b: '#FDA4AF' },
  { id: 'pink',    label: 'Pink',      a: '#EC4899', b: '#F9A8D4' },
  { id: 'tangerine', label: 'Tangerine', a: '#F97316', b: '#FDBA74' },
  { id: 'sky',     label: 'Slate Blue', a: '#4F6EF7', b: '#93A6FF' },
  { id: 'slate',   label: 'Slate',     a: '#475569', b: '#94A3B8' },
];

export const DEFAULT_ACCENT_ID = 'sunset';

export function getAccent(id: string | null | undefined): AccentTheme {
  return ACCENT_THEMES.find(t => t.id === id) ?? ACCENT_THEMES[0];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Compute the inline CSS-variable overrides for a given accent + surface
 * mode. Applied on <html> by App.tsx so they override the stylesheet
 * defaults for BOTH light and dark themes (that's the whole point: accent
 * × light/dark = independent dimensions).
 */
export function accentCssVars(accent: AccentTheme, mode: 'light' | 'dark'): Record<string, string> {
  const { a, b } = accent;
  const ink = accent.ink ?? '#FFFFFF';
  // Soft washes: blend the accent into the current surface base so tags,
  // banners and hovers stay readable in either mode.
  const base = mode === 'dark' ? '#1a1612' : '#FFFFFF';
  const softPct = mode === 'dark' ? '26%' : '14%';

  return {
    '--primary':            a,
    '--primary-foreground': ink,
    '--accent':             a,
    '--accent-2':           b,
    '--accent-3':           a,
    '--accent-ink':         ink,
    '--accent-soft':        `color-mix(in srgb, ${a} ${softPct}, ${base})`,
    '--accent-soft-2':      `color-mix(in srgb, ${b} ${softPct}, ${base})`,
    '--border-focus':       a,
  };
}

/** rgba glow string for the accent (used for --accent-glow / shadow-glow). */
export function accentGlow(accent: AccentTheme, mode: 'light' | 'dark'): string {
  const [r, g, bl] = hexToRgb(accent.a);
  return mode === 'dark'
    ? `rgba(${r}, ${g}, ${bl}, .30)`
    : `rgba(${r}, ${g}, ${bl}, .32)`;
}
