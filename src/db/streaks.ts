/**
 * streaks.ts — review-streak tracking.
 *
 * A "review" is any flashcard or practice question that the user has
 * rated. Every rating calls `recordReview()` which:
 *   1. Increments today's count
 *   2. Updates `currentStreak` based on whether the last review was today,
 *      yesterday (consecutive → +1), or earlier (gap → reset to 1)
 *   3. Updates `longestStreak` if the current streak beats it
 *   4. Increments `totalReviews`
 *
 * A missed day would normally wipe the streak. With a streak freeze in the
 * wallet (earned by completing every daily quest), the freeze is spent
 * instead and the streak survives the day off.
 *
 * The Dashboard widget reads `getStreakData()` to show the current streak,
 * today's count, and a sparkline of the last 7 days.
 */

import { getDB, type StreakData } from './schema';

export const EMPTY_STREAK: StreakData = {
  id: 'singleton',
  lastReviewDate: null,
  currentStreak: 0,
  longestStreak: 0,
  totalReviews: 0,
  dailyCounts: {},
};

const DAY_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function diffDays(a: Date, b: Date): number {
  // Truncate to day boundary so a review at 11:59pm and one at 00:01am
  // are 1 day apart, not 1 minute.
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aDay.getTime() - bDay.getTime()) / 86_400_000);
}

/**
 * Read the current streak data. Returns the empty default if no record
 * exists yet.
 */
export async function getStreakData(): Promise<StreakData> {
  const db = await getDB();
  const row = await db.get('streaks', 'singleton');
  return row ?? EMPTY_STREAK;
}

/**
 * Spend a streak freeze to cover a missed day.
 *
 * Signed in, the server's freeze wallet is authoritative. Offline, the local
 * wallet from the progression cache is spent instead. Either way the answer
 * is a plain boolean so the streak maths stays readable.
 */
async function spendStreakFreeze(): Promise<boolean> {
  try {
    const { spendFreeze } = await import('../api/progression');
    const result = await spendFreeze();
    return result.granted;
  } catch {
    // Offline — spend from the local cache if there is one.
    try {
      const raw = localStorage.getItem('sw-progression-v1');
      if (!raw) return false;
      const state = JSON.parse(raw);
      if ((state.streakFreezes ?? 0) <= 0) return false;
      state.streakFreezes -= 1;
      localStorage.setItem('sw-progression-v1', JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Bump the streak counters for one review. Safe to call many times in a
 * row (same-day calls just increment the daily count and totalReviews).
 */
export async function recordReview(): Promise<StreakData> {
  const db   = await getDB();
  const cur  = (await db.get('streaks', 'singleton')) ?? EMPTY_STREAK;
  const now  = new Date();
  const today = DAY_KEY(now);

  let currentStreak = cur.currentStreak;
  if (cur.lastReviewDate === today) {
    // Same day — no streak change.
  } else if (cur.lastReviewDate) {
    const gap = diffDays(now, new Date(cur.lastReviewDate));
    if (gap === 1) {
      currentStreak = cur.currentStreak + 1;
    } else if (gap > 1) {
      // Missed at least one day. A streak freeze covers the day off so the
      // streak continues; without one, the streak resets to 1.
      if (cur.currentStreak > 0 && (await spendStreakFreeze())) {
        currentStreak = cur.currentStreak + 1;
      } else {
        currentStreak = 1;
      }
    } else {
      // gap < 1 (e.g. clock skew) — keep the current value.
      currentStreak = Math.max(1, cur.currentStreak);
    }
  } else {
    // First review ever.
    currentStreak = 1;
  }

  // Prune dailyCounts to last 90 days so the record doesn't grow unbounded.
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const cutoffKey = DAY_KEY(cutoff);
  const dailyCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(cur.dailyCounts)) {
    if (k >= cutoffKey) dailyCounts[k] = v;
  }
  dailyCounts[today] = (dailyCounts[today] ?? 0) + 1;

  const next: StreakData = {
    id: 'singleton',
    lastReviewDate: today,
    currentStreak,
    longestStreak: Math.max(cur.longestStreak, currentStreak),
    totalReviews: cur.totalReviews + 1,
    dailyCounts,
  };
  await db.put('streaks', next);
  return next;
}

/**
 * Return the count for the last 7 days as an array of 7 numbers, oldest
 * first. Day 0 is 6 days ago; day 6 is today. Used for the sparkline.
 */
export function last7Days(data: StreakData): number[] {
  const out: number[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(data.dailyCounts[DAY_KEY(d)] ?? 0);
  }
  return out;
}

/**
 * Cross-device streak sync (Phase 2).
 *
 * Pushes the local dailyCounts to the server, which merges them (per-day max)
 * with any counts recorded on other devices and returns the authoritative
 * merged record. We then write that back into local IDB so this device shows
 * the combined streak. Best-effort: if offline / unauthenticated, the local
 * streak is returned unchanged.
 */
export async function syncStreak(): Promise<StreakData> {
  const local = await getStreakData();
  try {
    // Lazy import to avoid pulling the API client into non-synced contexts.
    const { mergeStreak } = await import('../api/phase2');
    const server = await mergeStreak(local.dailyCounts);

    const merged: StreakData = {
      id: 'singleton',
      lastReviewDate: server.lastReviewDate,
      currentStreak:  server.currentStreak,
      longestStreak:  server.longestStreak,
      totalReviews:   server.totalReviews,
      dailyCounts:    server.dailyCounts,
    };
    const db = await getDB();
    await db.put('streaks', merged);
    return merged;
  } catch {
    // Offline or not logged in — keep local.
    return local;
  }
}
