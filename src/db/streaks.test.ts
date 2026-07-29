/**
 * Tests for the streak utility. We mock getDB so the tests run without
 * a real IndexedDB instance.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Mock the IDB layer before importing streaks.
let stored: any = null;
const mockDb = {
  get: async (_store: string, key: string) => (key === 'singleton' ? stored : undefined),
  put: async (_store: string, value: any) => { stored = value; return value; },
};

vi.mock('../db/schema', () => ({
  getDB: async () => mockDb,
  EMPTY_STREAK: {
    id: 'singleton',
    lastReviewDate: null,
    currentStreak: 0,
    longestStreak: 0,
    totalReviews: 0,
    dailyCounts: {},
  },
}));

import { recordReview, last7Days } from '../db/streaks';
import { vi } from 'vitest';

beforeEach(() => { stored = null; });

describe('recordReview', () => {
  it('starts a streak of 1 on the first review', async () => {
    const r = await recordReview();
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
    expect(r.totalReviews).toBe(1);
  });

  it('same-day reviews do not advance the streak', async () => {
    await recordReview();
    const r2 = await recordReview();
    expect(r2.currentStreak).toBe(1);
    expect(r2.totalReviews).toBe(2);
  });

  it('updates longestStreak when current beats it', async () => {
    // Manually seed a state where currentStreak=5 and lastReviewDate=yesterday.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    stored = {
      id: 'singleton',
      lastReviewDate: yKey,
      currentStreak: 5,
      longestStreak: 5,
      totalReviews: 10,
      dailyCounts: { [yKey]: 3 },
    };
    const r = await recordReview();
    expect(r.currentStreak).toBe(6);
    expect(r.longestStreak).toBe(6);
  });
});

describe('last7Days', () => {
  it('returns 7 zeros when no data', () => {
    expect(last7Days({
      id: 'singleton', lastReviewDate: null, currentStreak: 0, longestStreak: 0, totalReviews: 0, dailyCounts: {},
    })).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('returns 7 numbers, oldest first, with today last', () => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const r = last7Days({
      id: 'singleton', lastReviewDate: null, currentStreak: 0, longestStreak: 0, totalReviews: 0,
      dailyCounts: { [todayKey]: 5 },
    });
    expect(r).toHaveLength(7);
    expect(r[6]).toBe(5);
  });
});
