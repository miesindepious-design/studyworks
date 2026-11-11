/**
 * Study-timer settings — one store, shared by the Timer page and Settings.
 *
 * Both pages used to keep their own copy of the same settings and wrote to
 * the same localStorage key. Whichever mounted last won, so a change made
 * in Settings could silently be overwritten by the Timer page's defaults.
 * Now there is a single module-level store: both views read and write the
 * same object and stay in sync.
 */

import { useCallback, useSyncExternalStore } from 'react';

export interface TimerSettings {
  focusDuration: number;   // minutes
  breakDuration: number;   // minutes
  autoStartBreak: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focusDuration: 25,
  breakDuration: 5,
  autoStartBreak: false,
  soundEnabled: true,
};

const STORAGE_KEY = 'studyworks:timerSettings';

const EMPTY: TimerSettings = DEFAULT_TIMER_SETTINGS;

let cache: TimerSettings | null = null;
const listeners = new Set<() => void>();

function readStorage(): TimerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_TIMER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_TIMER_SETTINGS;
}

function getSnapshot(): TimerSettings {
  if (cache === null) cache = readStorage();
  return cache;
}

function getServerSnapshot(): TimerSettings {
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

function write(next: TimerSettings) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — settings just won't persist */
  }
  listeners.forEach(l => l());
}

/**
 * Returns the shared timer settings and a patch function.
 * `update({ focusDuration: 30 })` merges into the current settings.
 */
export function useTimerSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((patch: Partial<TimerSettings>) => {
    write({ ...getSnapshot(), ...patch });
  }, []);

  const reset = useCallback(() => write(DEFAULT_TIMER_SETTINGS), []);

  return { settings, update, reset };
}
