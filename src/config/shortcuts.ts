/**
 * Keyboard shortcuts — the single source of truth.
 *
 * Previously the shortcut list was duplicated in three places that could
 * drift apart:
 *   • src/components/ShortcutsModal.tsx — a hardcoded array
 *   • src/components/SettingsView.tsx   — a second hardcoded array plus an
 *                                         editor that saved to localStorage
 *                                         nobody ever read
 *   • src/App.tsx                       — the actual key bindings
 *
 * Now there is one registry. The modal renders it, the Settings editor
 * rebinds it, and App.tsx binds it. A rebind changes the real behaviour,
 * not just the label.
 */

export type ShortcutGroup = 'Navigate' | 'Edit' | 'General';

export interface ShortcutDef {
  /** Stable action id — the key used in the override map. */
  id: string;
  /** Default combo, e.g. "mod+shift+z". "mod" = ⌘ on Mac, Ctrl elsewhere. */
  combo: string;
  /** Human-readable label. */
  label: string;
  group: ShortcutGroup;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // ── Navigate ──
  { id: 'nav.dashboard',  combo: 'mod+1', label: 'Go to Dashboard',  group: 'Navigate' },
  { id: 'nav.notes',      combo: 'mod+2', label: 'Go to Notes',      group: 'Navigate' },
  { id: 'nav.contacts',   combo: 'mod+3', label: 'Go to People',     group: 'Navigate' },
  { id: 'nav.flashcards', combo: 'mod+4', label: 'Go to Flashcards', group: 'Navigate' },
  { id: 'nav.pricing',    combo: 'mod+5', label: 'Go to Pricing',    group: 'Navigate' },
  { id: 'nav.settings',   combo: 'mod+6', label: 'Go to Settings',   group: 'Navigate' },

  // ── Edit ──
  { id: 'edit.undo', combo: 'mod+z',       label: 'Undo', group: 'Edit' },
  { id: 'edit.redo', combo: 'mod+shift+z', label: 'Redo', group: 'Edit' },

  // ── General ──
  { id: 'general.palette', combo: 'mod+k',    label: 'Command palette',         group: 'General' },
  { id: 'general.copilot', combo: 'mod+/',    label: 'Open Copilot',            group: 'General' },
  { id: 'general.help',    combo: '?',        label: 'Show keyboard shortcuts', group: 'General' },
  { id: 'general.escape',  combo: 'escape',   label: 'Close modal / panel',     group: 'General' },
];

export const SHORTCUT_BY_ID: Record<string, ShortcutDef> = Object.fromEntries(
  SHORTCUT_DEFS.map(d => [d.id, d]),
);

/**
 * Map of shortcut action id → user-chosen combo.
 *
 * The value type includes `undefined` on purpose: without it, TypeScript 5.6
 * treats an index lookup as a non-nullable `string` and flags the `??` below
 * as an unreachable right operand (TS2869).
 */
export type ShortcutOverrides = Record<string, string | undefined>;

/** Resolve the combo an action is currently bound to (override wins). */
export function resolveCombo(
  overrides: ShortcutOverrides,
  id: string,
  defaultCombo: string,
): string {
  return overrides[id] ?? defaultCombo;
}

/** Modifier → symbol. "mod" resolves to ⌘ (⌃ on Windows/Linux). */
const MOD_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
};

/** Split a combo string into displayable key caps: "mod+shift+z" → ['⌘','⇧','Z']. */
export function comboToKeys(combo: string): string[] {
  return combo
    .split('+')
    .filter(Boolean)
    .map(part => {
      const p = part.toLowerCase();
      if (MOD_SYMBOLS[p]) return MOD_SYMBOLS[p];
      if (KEY_LABELS[p]) return KEY_LABELS[p];
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    });
}

/** Compact single-line rendering of a combo: "mod+shift+z" → "⌘⇧Z". */
export function comboToLabel(combo: string): string {
  return comboToKeys(combo).join('');
}

/**
 * Normalise a KeyboardEvent into a combo string.
 * Mirrors the parser used by useKeyboardShortcuts so a captured combo always
 * matches the one the global handler expects.
 */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  // Modifier keys on their own aren't a usable binding.
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return '';
  parts.push(key);
  return parts.join('+');
}

/**
 * Does this key event match the combo?
 *
 * Semantics:
 *   • a required modifier must be held
 *   • an *unrequired* mod must NOT be held (so ⌘Z never triggers "z")
 *   • shift/alt are only checked when the combo asks for them, so "?" still
 *     matches the Shift+/ keypress that produces it
 */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts   = combo.toLowerCase().split('+').filter(Boolean);
  const needMod  = parts.includes('mod') || parts.includes('ctrl');
  const needShift = parts.includes('shift');
  const needAlt   = parts.includes('alt');
  const mainKey  = parts[parts.length - 1];

  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (needMod && !mod) return false;
  if (!needMod && mod) return false;
  if (needShift && !e.shiftKey) return false;
  if (needAlt && !e.altKey) return false;

  return mainKey === key;
}

/* ── Capture mode ────────────────────────────────────────────────────────────
 * While the Settings shortcut editor is waiting for a keypress, the global
 * shortcut handler must stand down — otherwise pressing "?" would both
 * rebind the shortcut and open the shortcuts modal.
 */
let captureActive = false;

export function setShortcutCapture(active: boolean) {
  captureActive = active;
}

export function isShortcutCaptureActive() {
  return captureActive;
}

