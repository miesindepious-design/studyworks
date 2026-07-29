/**
 * Tests for the SM-2 algorithm — covers the cases that the previous
 * hard-coded-ef implementation got wrong.
 */
import { describe, it, expect } from 'vitest';
import { sm2, isDue, byUrgency } from './sm2';

const baseState = { repetitions: 0, interval: 0, ef: 2.5, nextReview: new Date() };

describe('sm2', () => {
  it('on first Good, interval is 1 day and ef is updated', () => {
    const r = sm2(baseState, 2);
    expect(r.interval).toBe(1);
    expect(r.repetitions).toBe(1);
    // ef' = 2.5 + (0.1 - (5-2) * (0.08 + (5-2) * 0.02)) = 2.5 + 0.1 - 0.42 = 2.18
    expect(r.ef).toBeCloseTo(2.18, 2);
  });

  it('on second Good, interval is 4 days', () => {
    const r = sm2({ ...baseState, repetitions: 1, interval: 1, ef: 2.5 }, 2);
    expect(r.interval).toBe(4);
  });

  it('on third Good, interval uses ef multiplier', () => {
    const r = sm2({ ...baseState, repetitions: 2, interval: 4, ef: 2.5 }, 2);
    expect(r.interval).toBe(10); // round(4 * 2.5)
  });

  it('Again resets repetitions to 0 and ef does not drop below 1.3', () => {
    const r = sm2({ repetitions: 5, interval: 30, ef: 2.0 }, 0);
    expect(r.repetitions).toBe(0);
    expect(r.interval).toBe(1);
    expect(r.ef).toBeGreaterThanOrEqual(1.3);
  });

  it('Easy gives a 1.3x bonus', () => {
    const r = sm2({ ...baseState, repetitions: 2, interval: 4, ef: 2.5 }, 3);
    expect(r.interval).toBe(13); // round(4 * 2.5 * 1.3)
  });

  it('Hard keeps repetitions and slightly grows the interval', () => {
    const r = sm2({ ...baseState, repetitions: 1, interval: 4, ef: 2.5 }, 1);
    expect(r.repetitions).toBe(2);
    expect(r.interval).toBe(5); // round(4 * 1.2)
  });

  it('ef is floored at 1.3 across many "Again" presses', () => {
    let s = { ...baseState };
    for (let i = 0; i < 20; i++) s = sm2(s, 0);
    expect(s.ef).toBeGreaterThanOrEqual(1.3);
  });
});

describe('isDue', () => {
  it('returns true when nextReview is in the past', () => {
    expect(isDue({ nextReview: new Date(Date.now() - 1000) })).toBe(true);
  });
  it('returns false when nextReview is in the future', () => {
    expect(isDue({ nextReview: new Date(Date.now() + 100_000) })).toBe(false);
  });
  it('returns true when nextReview is unset (never reviewed)', () => {
    expect(isDue({})).toBe(true);
  });
});

describe('byUrgency', () => {
  it('sorts overdue first', () => {
    const a: { id: string; nextReview?: Date } = { id: 'a', nextReview: new Date(Date.now() - 1000) };
    const b: { id: string; nextReview?: Date } = { id: 'b', nextReview: new Date(Date.now() + 100_000) };
    const c: { id: string; nextReview?: Date } = { id: 'c' }; // never reviewed → top
    const sorted = [a, b, c].sort(byUrgency);
    expect(sorted.map(x => x.id)).toEqual(['c', 'a', 'b']);
  });
});
