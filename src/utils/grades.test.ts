/**
 * Tests for the grade maths.
 *
 * The behaviour that matters:
 *
 *   - a grade is weighted, not an average of averages;
 *   - the current grade only counts the work that has been marked;
 *   - the projection counts the work that has not;
 *   - the "what do I need" answer is honest about an impossible target
 *     instead of asking the student for 143%.
 */
import { describe, it, expect } from 'vitest';
import {
  summarise,
  projectGrade,
  requiredAverage,
  percentageOf,
  letterGrade,
  groupByCourse,
  sortAssignments,
  daysUntil,
  type GradeAssignment,
} from './grades';

const a = (over: Partial<GradeAssignment> = {}): GradeAssignment => ({
  id: 'x',
  title: 'Assignment',
  course: 'Biology',
  category: 'Homework',
  weight: 10,
  score: null,
  maxScore: 100,
  ...over,
});

describe('percentageOf', () => {
  it('reads a mark as a percentage', () => {
    expect(percentageOf(a({ score: 17, maxScore: 20 }))).toBe(85);
  });

  it('is null for an unmarked assignment', () => {
    expect(percentageOf(a({ score: null }))).toBeNull();
  });

  it('is null when the maximum is zero or missing', () => {
    expect(percentageOf(a({ score: 5, maxScore: 0 }))).toBeNull();
  });
});

describe('summarise', () => {
  it('is empty for no assignments', () => {
    const s = summarise([]);
    expect(s.currentGrade).toBeNull();
    expect(s.letter).toBe('—');
    expect(s.totalWeight).toBe(0);
  });

  it('weights the marks instead of averaging them', () => {
    // 90% on a 10% quiz, 50% on a 90% final → 54%, not 70%.
    const s = summarise([
      a({ weight: 10, score: 90 }),
      a({ weight: 90, score: 50 }),
    ]);
    expect(s.currentGrade).toBeCloseTo(54, 5);
    expect(s.gradedWeight).toBe(100);
    expect(s.remainingWeight).toBe(0);
  });

  it('counts only marked work in the current grade', () => {
    // One quiz marked at 100%, worth 10%. The unmarked 90% is excluded.
    const s = summarise([
      a({ weight: 10, score: 100 }),
      a({ weight: 90, score: null }),
    ]);
    expect(s.currentGrade).toBeCloseTo(100, 5);
    expect(s.gradedWeight).toBe(10);
    expect(s.remainingWeight).toBe(90);
    expect(s.gradedCount).toBe(1);
  });

  it('keeps the unmarked weight available', () => {
    const s = summarise([a({ weight: 30, score: null })]);
    expect(s.remainingWeight).toBe(30);
    expect(s.earnedPoints).toBe(0);
  });
});

describe('projectGrade', () => {
  it('assumes the rest scores the given percentage', () => {
    // 90 points banked on a 100-point course, 90% on the rest.
    const p = projectGrade([
      a({ weight: 10, score: 90 }),
      a({ weight: 90, score: null }),
    ], 90);
    expect(p).toBeCloseTo(90, 5);
  });

  it('is null with no weight at all', () => {
    expect(projectGrade([], 80)).toBeNull();
  });
});

describe('requiredAverage', () => {
  it('works out what is needed to hit a target', () => {
    // 20 points at 100% and 20 at 50% bank 30 of the 100-point course.
    // To finish at 75%: (75 - 30) / 60 remaining = 75%.
    const r = requiredAverage(75, [
      a({ weight: 20, score: 100 }),
      a({ weight: 20, score: 50 }),
      a({ weight: 60, score: null }),
    ]);
    expect(r.needed).toBeCloseTo(75, 5);
    expect(r.possible).toBe(true);
    expect(r.alreadyAchieved).toBe(false);
  });

  it('says the target is already secured rather than asking for 0%', () => {
    // 50 points banked at 80% out of a 100-point course. A target of 40% is
    // met even if every remaining mark is zero — so there is nothing to chase.
    const r = requiredAverage(40, [
      a({ weight: 50, score: 80 }),
      a({ weight: 50, score: null }),
    ]);
    expect(r.alreadyAchieved).toBe(true);
    expect(r.possible).toBe(true);
    expect(r.needed).toBe(0);
  });

  it('still asks for what is needed when the running average is above target', () => {
    // 80% so far looks great, but half the course is unmarked. A final of
    // 50% needs 20% on the rest — the running average does not secure it.
    const r = requiredAverage(50, [
      a({ weight: 50, score: 80 }),
      a({ weight: 50, score: null }),
    ]);
    expect(r.alreadyAchieved).toBe(false);
    expect(r.needed).toBeCloseTo(20, 5);
  });

  it('refuses an impossible target instead of asking for more than 100%', () => {
    const r = requiredAverage(95, [
      a({ weight: 50, score: 40 }),
      a({ weight: 50, score: null }),
    ]);
    expect(r.possible).toBe(false);
    expect(r.needed!).toBeGreaterThan(100);
    expect(r.reason).toContain('out of reach');
  });

  it('handles everything being marked already', () => {
    const r = requiredAverage(90, [
      a({ weight: 50, score: 95 }),
      a({ weight: 50, score: 92 }),
    ]);
    expect(r.needed).toBeNull();
    expect(r.alreadyAchieved).toBe(true);
    expect(r.reason).toContain('every mark is in');
  });
});

describe('letterGrade', () => {
  it('maps the standard scale', () => {
    expect(letterGrade(95)).toBe('A');
    expect(letterGrade(91)).toBe('A-');
    expect(letterGrade(85)).toBe('B');
    expect(letterGrade(59)).toBe('F');
  });
});

describe('groupByCourse', () => {
  it('keeps each course together', () => {
    const g = groupByCourse([
      a({ course: 'Biology' }),
      a({ course: 'Physics' }),
      a({ course: 'Biology' }),
    ]);
    expect(g.map(x => x.course)).toEqual(['Biology', 'Physics']);
    expect(g[0].items).toHaveLength(2);
  });
});

describe('sortAssignments', () => {
  it('puts unmarked work first, soonest due at the top', () => {
    const sorted = sortAssignments([
      a({ id: 'done', score: 90, updatedAt: '2026-01-01T00:00:00Z' }),
      a({ id: 'later', dueDate: '2099-01-01T00:00:00Z' }),
      a({ id: 'soon', dueDate: '2026-01-02T00:00:00Z' }),
    ]);
    expect(sorted.map(x => x.id)).toEqual(['soon', 'later', 'done']);
  });
});

describe('daysUntil', () => {
  it('counts whole days', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(daysUntil(tomorrow)).toBe(1);
  });

  it('is null without a date', () => {
    expect(daysUntil(null)).toBeNull();
  });
});
