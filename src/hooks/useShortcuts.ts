/**
 * Live keyboard-shortcut overrides.
 *
 * The old Settings editor wrote to localStorage but nothing read it back, so
 * rebinding a key changed the label and nothing else. This store is the
 * single source of truth for custom bindings:
 *
 *   • App.tsx binds the *overridden* combos, so a rebind really works.
 *   • The Shortcuts modal and the Settings editor both subscribe to it, so
 *     they stay in sync with each other and across tabs.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { ShortcutOverrides } from '../config/shortcuts';

export type { ShortcutOverrides } from '../config/shortcuts';

const STORAGE_KEY = 'studyworks:shortcuts';

const EMPTY: ShortcutOverrides = {};

let cache: ShortcutOverrides | null = null;
const listeners = new Set<() => void>();

function readStorage(): ShortcutOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getSnapshot(): ShortcutOverrides {
  if (cache === null) cache = readStorage();
  return cache;
}

/** Stable reference for SSR / the very first render. */
function getServerSnapshot(): ShortcutOverrides {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: ShortcutOverrides) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — overrides just won't persist */
  }
  listeners.forEach(l => l());
}

/**
 * Returns the current overrides plus a setter.
 * `set(id, combo)` rebinds one action; `set(id, null)` restores its default.
 */
export function useShortcutOverrides() {
  const overrides = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((id: string, combo: string | null) => {
    // Rebuild instead of `delete`-ing, so the stored map never carries
    // explicit `undefined` values.
    const next: ShortcutOverrides = {};
    for (const [key, value] of Object.entries(getSnapshot())) {
      if (key !== id && value !== undefined) next[key] = value;
    }
    if (combo !== null) next[id] = combo;
    write(next);
  }, []);

  const reset = useCallback(() => write({}), []);

  return { overrides, set, reset };
}
