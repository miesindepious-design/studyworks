/**
 * useStudyGoals — the daily study targets, in one place.
 *
 * The Dashboard used to own these numbers in local component state, which
 * meant Settings could not show them without writing a second, competing
 * copy of the same localStorage key. This is the same single-store pattern
 * as useTimerSettings: both surfaces read and write the same object, and a
 * change in one is visible in the other immediately.
 */

import { useCallback, useSyncExternalStore } from 'react';

export interface StudyGoals {
  /** Flashcards to review per day. */
  dailyFlashcards: number;
  /** Notes to revisit per day. */
  dailyNotes: number;
  /** Minutes of focused study per day. */
  dailyStudyMinutes: number;
}

export const DEFAULT_STUDY_GOALS: StudyGoals = {
  dailyFlashcards: 20,
  dailyNotes: 3,
  dailyStudyMinutes: 60,
};

const STORAGE_KEY = 'studyworks-goals';

let cache: StudyGoals | null = null;
const listeners = new Set<() => void>();

function readStorage(): StudyGoals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STUDY_GOALS, ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_STUDY_GOALS;
}

function getSnapshot(): StudyGoals {
  if (cache === null) cache = readStorage();
  return cache;
}

function getServerSnapshot(): StudyGoals {
  return DEFAULT_STUDY_GOALS;
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

function write(next: StudyGoals) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the goals just won't persist */
  }
  listeners.forEach(l => l());
}

/**
 * Returns the shared daily goals plus helpers to change them.
 * `updateGoal('dailyStudyMinutes', 90)` merges a single target.
 */
export function useStudyGoals() {
  const goals = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const updateGoal = useCallback((key: keyof StudyGoals, value: number) => {
    write({ ...getSnapshot(), [key]: value });
  }, []);

  const setGoals = useCallback((next: StudyGoals) => write(next), []);

  const resetGoals = useCallback(() => write(DEFAULT_STUDY_GOALS), []);

  return { goals, updateGoal, setGoals, resetGoals };
}
