/**
 * useDeckSettings — the daily limits, in one place.
 *
 * Same pattern as `useStudyGoals`: a single store read by every surface
 * that cares, so the Dashboard, the Study Plan and Settings can never
 * disagree about how much work the student is doing today.
 *
 * The settings live in localStorage because they are a personal preference
 * rather than study data — they say how the student wants to work, not what
 * they have studied. The study data itself is what syncs.
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_LIMITS,
  MAX_LIMIT,
  type DailyLimits,
  type DeckLimit,
} from '../utils/deckSettings';

export interface DeckSettings {
  /** The global daily limits. */
  limits: DailyLimits;
  /** Per-deck overrides. */
  decks: DeckLimit[];
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  limits: DEFAULT_LIMITS,
  decks: [],
};

const STORAGE_KEY = 'studyworks-deck-settings';

let cache: DeckSettings | null = null;
const listeners = new Set<() => void>();

/** Clamp a limit into a sane range. A typo must not lock the app. */
function clampLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_LIMIT, Math.round(value)));
}

function readStorage(): DeckSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const limits = parsed?.limits ?? {};
      return {
        limits: {
          newPerDay: clampLimit(limits.newPerDay, DEFAULT_LIMITS.newPerDay),
          reviewsPerDay: clampLimit(limits.reviewsPerDay, DEFAULT_LIMITS.reviewsPerDay),
        },
        decks: Array.isArray(parsed?.decks)
          ? parsed.decks
              .filter((d: any) => d && typeof d.folderId === 'string')
              .map((d: any) => ({
                folderId: d.folderId,
                name: typeof d.name === 'string' ? d.name : '',
                newPerDay: typeof d.newPerDay === 'number' ? clampLimit(d.newPerDay, 0) : undefined,
                reviewsPerDay: typeof d.reviewsPerDay === 'number' ? clampLimit(d.reviewsPerDay, 0) : undefined,
              }))
          : [],
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_DECK_SETTINGS;
}

function getSnapshot(): DeckSettings {
  if (cache === null) cache = readStorage();
  return cache;
}

function getServerSnapshot(): DeckSettings {
  return DEFAULT_DECK_SETTINGS;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: DeckSettings) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the settings just will not persist */
  }
  listeners.forEach(l => l());
}

/**
 * The daily limits plus the helpers for changing them.
 */
export function useDeckSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLimits = useCallback((next: Partial<DailyLimits>) => {
    const current = getSnapshot();
    write({
      ...current,
      limits: {
        newPerDay: next.newPerDay !== undefined
          ? clampLimit(next.newPerDay, current.limits.newPerDay)
          : current.limits.newPerDay,
        reviewsPerDay: next.reviewsPerDay !== undefined
          ? clampLimit(next.reviewsPerDay, current.limits.reviewsPerDay)
          : current.limits.reviewsPerDay,
      },
    });
  }, []);

  /** Set or clear a per-deck override. Passing undefined removes it. */
  const setDeckLimit = useCallback((
    folderId: string,
    name: string,
    next: { newPerDay?: number; reviewsPerDay?: number },
  ) => {
    const current = getSnapshot();
    const decks = current.decks.filter(d => d.folderId !== folderId);

    const hasOverride = next.newPerDay !== undefined || next.reviewsPerDay !== undefined;
    if (hasOverride) {
      decks.push({
        folderId,
        name,
        newPerDay: next.newPerDay !== undefined ? clampLimit(next.newPerDay, 0) : undefined,
        reviewsPerDay: next.reviewsPerDay !== undefined ? clampLimit(next.reviewsPerDay, 0) : undefined,
      });
    }

    write({ ...current, decks });
  }, []);

  const reset = useCallback(() => write(DEFAULT_DECK_SETTINGS), []);

  return { settings, limits: settings.limits, decks: settings.decks, setLimits, setDeckLimit, reset };
}
