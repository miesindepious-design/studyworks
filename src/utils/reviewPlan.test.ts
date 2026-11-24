/**
 * Tests for the study-plan engine.
 *
 * The ordering rules are the whole point of this module, so they are pinned
 * down here: a leech beats an overdue card, an overdue card beats a due card,
 * a due card beats new material, and a wrongly-answered practice question
 * beats everything except a leech.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReviewPlan,
  buildForecast,
  peakDay,
  overdueDays,
  daysBetween,
  countOverdue,
  planSummary,
  reasonLabel,
  topicOf,
  type PlanItem,
} from './reviewPlan';
import type { Flashcard, Note, PracticeQuestion } from '../types';

const NOW = new Date(2026, 0, 15, 12, 0, 0); // 15 Jan 2026, midday

function card(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c-' + Math.random().toString(36).slice(2, 8),
    question: 'Q',
    answer: 'A',
    tags: [],
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Flashcard;
}

function question(over: Partial<PracticeQuestion> = {}): PracticeQuestion {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8),
    question: 'Q',
    answer: 'A',
    type: 'open',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as PracticeQuestion;
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n-' + Math.random().toString(36).slice(2, 8),
    title: 'T',
    content: 'C',
    tags: [],
    type: 'note',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Note;
}

function ids(items: PlanItem[]): string[] {
  return items.map(i => i.id);
}

describe('reviewPlan — ordering', () => {
  it('puts a leech card before an overdue card', () => {
    const leech = card({ id: 'leech', leechCount: 3, nextReview: new Date(2026, 0, 10) });
    const overdue = card({ id: 'overdue', nextReview: new Date(2026, 0, 1) });
    const plan = buildReviewPlan([overdue, leech], [], [], NOW);
    expect(ids(plan.items)[0]).toBe('leech');
  });

  it('treats a collapsed ease factor as a leech too', () => {
    const collapsed = card({ id: 'collapsed', ef: 1.5, repetitions: 4, nextReview: new Date(2026, 0, 14) });
    const plan = buildReviewPlan([collapsed], [], [], NOW);
    expect(plan.items[0].reason).toBe('leech');
  });

  it('puts an overdue card before a due card', () => {
    const overdue = card({ id: 'overdue', nextReview: new Date(2026, 0, 1) });
    const due = card({ id: 'due', nextReview: new Date(2026, 0, 15, 8, 0) });
    const plan = buildReviewPlan([due, overdue], [], [], NOW);
    expect(ids(plan.items)).toEqual(['overdue', 'due']);
  });

  it('puts a wrongly-answered question above ordinary due work', () => {
    const wrong = question({ id: 'wrong', lastAnsweredCorrect: false, nextReview: new Date(2026, 0, 15) });
    const due = card({ id: 'due', nextReview: new Date(2026, 0, 15, 8, 0) });
    const plan = buildReviewPlan([due], [wrong], [], NOW);
    expect(ids(plan.items)[0]).toBe('wrong');
    expect(plan.items[0].reason).toBe('wrong');
  });

  it('orders overdue items by how late they are', () => {
    const veryLate = card({ id: 'veryLate', nextReview: new Date(2025, 11, 20) });
    const slightlyLate = card({ id: 'slightlyLate', nextReview: new Date(2026, 0, 13) });
    const plan = buildReviewPlan([slightlyLate, veryLate], [], [], NOW);
    expect(ids(plan.items)).toEqual(['veryLate', 'slightlyLate']);
  });

  it('puts new material last', () => {
    const fresh = card({ id: 'fresh' });
    const due = card({ id: 'due', nextReview: new Date(2026, 0, 15, 8, 0) });
    const plan = buildReviewPlan([fresh, due], [], [], NOW);
    expect(ids(plan.items)).toEqual(['due', 'fresh']);
    expect(plan.items[1].reason).toBe('new');
  });

  it('breaks ties by the older due date, not by array order', () => {
    const earlier = card({ id: 'earlier', nextReview: new Date(2026, 0, 10, 6, 0) });
    const later = card({ id: 'later', nextReview: new Date(2026, 0, 14, 6, 0) });
    const plan = buildReviewPlan([later, earlier], [], [], NOW);
    expect(ids(plan.items)).toEqual(['earlier', 'later']);
  });
});

describe('reviewPlan — what is in the plan', () => {
  it('includes cards, questions and notes that are due', () => {
    const plan = buildReviewPlan(
      [card({ id: 'c1', nextReview: new Date(2026, 0, 15, 8, 0) })],
      [question({ id: 'q1', nextReview: new Date(2026, 0, 15, 8, 0) })],
      [note({ id: 'n1', nextReminder: new Date(2026, 0, 15, 8, 0) })],
      NOW,
    );
    expect(plan.counts).toEqual({ card: 1, question: 1, note: 1 });
    expect(plan.total).toBe(3);
  });

  it('leaves out a note whose reminder is still in the future', () => {
    const plan = buildReviewPlan([], [], [note({ id: 'n1', nextReminder: new Date(2026, 0, 20) })], NOW);
    expect(plan.total).toBe(0);
  });

  it('leaves out a note with no reminder at all', () => {
    const plan = buildReviewPlan([], [], [note({ id: 'n1' })], NOW);
    expect(plan.total).toBe(0);
  });

  it('ignores an invalid reminder date rather than crashing', () => {
    const plan = buildReviewPlan([], [], [note({ id: 'n1', nextReminder: new Date('nonsense') })], NOW);
    expect(plan.total).toBe(0);
  });

  it('includes a note whose reminder has passed', () => {
    const plan = buildReviewPlan([], [], [note({ id: 'n1', nextReminder: new Date(2026, 0, 1) })], NOW);
    expect(plan.total).toBe(1);
    expect(plan.items[0].reason).toBe('overdue');
  });

  it('caps the plan at the limit but keeps the true total', () => {
    const many = Array.from({ length: 25 }, (_, i) => card({ id: 'c' + i, nextReview: new Date(2026, 0, 15, 8, 0) }));
    const plan = buildReviewPlan(many, [], [], NOW, 10);
    expect(plan.items).toHaveLength(10);
    expect(plan.total).toBe(25);
  });

  it('estimates a time that grows with the amount of work', () => {
    const one = buildReviewPlan([card({ nextReview: new Date(2026, 0, 15) })], [], [], NOW);
    const many = buildReviewPlan(
      Array.from({ length: 10 }, () => card({ nextReview: new Date(2026, 0, 15) })),
      [], [], NOW,
    );
    expect(one.estimatedMinutes).toBeGreaterThan(0);
    expect(many.estimatedMinutes).toBeGreaterThan(one.estimatedMinutes);
  });
});

describe('reviewPlan — labels and summaries', () => {
  it('counts overdue items', () => {
    const plan = buildReviewPlan(
      [card({ id: 'late', nextReview: new Date(2026, 0, 1) }), card({ id: 'now', nextReview: new Date(2026, 0, 15) })],
      [], [], NOW,
    );
    expect(countOverdue(plan)).toBe(1);
  });

  it('says so when there is nothing to do', () => {
    const plan = buildReviewPlan([], [], [], NOW);
    expect(planSummary(plan)).toContain('caught up');
  });

  it('summarises a plan with a count and a time', () => {
    const plan = buildReviewPlan([card({ nextReview: new Date(2026, 0, 15) })], [], [], NOW);
    expect(planSummary(plan)).toMatch(/1 to review/);
    expect(planSummary(plan)).toMatch(/minute/);
  });

  it('has a readable label for every reason', () => {
    for (const reason of ['leech', 'wrong', 'overdue', 'due', 'new'] as const) {
      expect(reasonLabel(reason)).toBeTruthy();
    }
  });

  it('falls back to General when there is no subject', () => {
    expect(topicOf({})).toBe('General');
    expect(topicOf({ topic: '  ' })).toBe('General');
    expect(topicOf({ topic: 'Biology' })).toBe('Biology');
  });
});

describe('date helpers', () => {
  it('counts whole days between two dates', () => {
    expect(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 15))).toBe(14);
    expect(daysBetween(new Date(2026, 0, 15), new Date(2026, 0, 1))).toBe(-14);
  });

  it('reports how late a due date is', () => {
    expect(overdueDays(new Date(2026, 0, 10), NOW)).toBe(5);
    expect(overdueDays(new Date(2026, 0, 15, 8, 0), NOW)).toBe(0);
    expect(overdueDays(new Date(2026, 0, 20), NOW)).toBe(0);
    expect(overdueDays(undefined, NOW)).toBe(0);
  });
});

describe('buildForecast', () => {
  it('returns one row per day, in order', () => {
    const forecast = buildForecast([], [], [], NOW, 7);
    expect(forecast).toHaveLength(7);
    expect(forecast[0].date).toBe('2026-01-15');
    expect(forecast[6].date).toBe('2026-01-21');
  });

  it('counts work scheduled for each day', () => {
    const forecast = buildForecast(
      [card({ id: 'c1', nextReview: new Date(2026, 0, 17, 9, 0) })],
      [],
      [],
      NOW,
      7,
    );
    expect(forecast[0].total).toBe(0);
    expect(forecast[2].total).toBe(1);
    expect(forecast[2].cards).toBe(1);
  });

  it('puts overdue work on today, because that is when it must be done', () => {
    const forecast = buildForecast(
      [card({ id: 'c1', nextReview: new Date(2026, 0, 1) })],
      [], [], NOW, 7,
    );
    expect(forecast[0].total).toBe(1);
    expect(forecast[1].total).toBe(0);
  });

  it('ignores work scheduled beyond the window', () => {
    const forecast = buildForecast(
      [card({ id: 'c1', nextReview: new Date(2026, 5, 1) })],
      [], [], NOW, 7,
    );
    expect(forecast.reduce((s, d) => s + d.total, 0)).toBe(0);
  });

  it('finds the busiest day', () => {
    const forecast = buildForecast(
      [
        card({ id: 'c1', nextReview: new Date(2026, 0, 16, 9, 0) }),
        card({ id: 'c2', nextReview: new Date(2026, 0, 16, 9, 0) }),
        card({ id: 'c3', nextReview: new Date(2026, 0, 18, 9, 0) }),
      ],
      [], [], NOW, 7,
    );
    expect(peakDay(forecast)?.total).toBe(2);
  });

  it('reports no peak day when there is no work at all', () => {
    expect(peakDay(buildForecast([], [], [], NOW, 7))).toBeNull();
  });
});
