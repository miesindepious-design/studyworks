import { useState, useEffect, useCallback } from 'react';

export interface DailyGoal {
  id: string;
  label: string;
  target: number;
  icon: string;
  statKey: 'flashcardsReviewed' | 'notesCreated' | 'studyMinutes';
  color: string;
}

export const DAILY_GOALS: DailyGoal[] = [
  {
    id: 'flashcards',
    label: 'Flashcards',
    target: 20,
    icon: '💡',
    statKey: 'flashcardsReviewed',
    color: 'var(--accent)',
  },
  {
    id: 'notes',
    label: 'Notes',
    target: 3,
    icon: '📝',
    statKey: 'notesCreated',
    color: 'var(--warning)',
  },
  {
    id: 'minutes',
    label: 'Study Time',
    target: 60,
    icon: '⏱️',
    statKey: 'studyMinutes',
    color: 'var(--info)',
  },
];

export interface GoalState {
  date: string; // YYYY-MM-DD
  counts: Record<string, number>;
  completed: boolean;
  streak: number;
}

const STORAGE_KEY = 'sw-daily-goals';

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function loadState(): GoalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GoalState;
      if (parsed.date === getToday()) {
        return parsed;
      }
      // New day: carry streak
      return {
        date: getToday(),
        counts: {},
        completed: false,
        streak: parsed.date === new Date(Date.now() - 86400000).toISOString().slice(0, 10) && !parsed.completed
          ? parsed.streak
          : parsed.completed
            ? parsed.streak
            : 0,
      };
    }
  } catch {
    // ignore
  }
  return { date: getToday(), counts: {}, completed: false, streak: 0 };
}

function saveState(state: GoalState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useGoals() {
  const [state, setState] = useState<GoalState>(loadState());

  // Reset at midnight
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    const timeout = setTimeout(() => {
      setState(prev => {
        const wasCompleted = prev.completed;
        const next: GoalState = {
          date: getToday(),
          counts: {},
          completed: false,
          streak: wasCompleted ? prev.streak + 1 : 0,
        };
        saveState(next);
        return next;
      });
    }, msUntilMidnight);

    return () => clearTimeout(timeout);
  }, []);

  const increment = useCallback((statKey: string) => {
    setState(prev => {
      const nextCounts = { ...prev.counts, [statKey]: (prev.counts[statKey] || 0) + 1 };
      const allComplete = DAILY_GOALS.every(g => (nextCounts[g.statKey] || 0) >= g.target);
      const next = { ...prev, counts: nextCounts, completed: allComplete };
      saveState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next: GoalState = { date: getToday(), counts: {}, completed: false, streak: 0 };
    saveState(next);
    setState(next);
  }, []);

  const getProgress = useCallback((goal: DailyGoal) => {
    return Math.min(1, (state.counts[goal.statKey] || 0) / goal.target);
  }, [state.counts]);

  return {
    state,
    increment,
    reset,
    getProgress,
    goals: DAILY_GOALS,
  };
}
