/**
 * Tests for the daily limits.
 *
 * The behaviour that matters:
 *
 *   - new material and reviews are capped separately;
 *   - the cap takes from the *end* of the queue, so the most urgent work is
 *     what makes it into the session;
 *   - a per-deck override replaces the global limit for that deck only;
 *   - an override of zero is meaningful, not "no override".
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIMITS,
  applyDailyLimits,
  buildDailyQueue,
  isNewItem,
  limitSummary,
  limitToday,
  limitsForDeck,
  type DailyLimits,
  type DeckLimit,
  type LimitedItem,
  type QueuedItem,
} from './deckSettings';
import type { Flashcard, Note, PracticeQuestion } from '../types';

const LIMITS: DailyLimits = { newPerDay: 2, reviewsPerDay: 3 };

function card(id: string, over: Partial<Flashcard> = {}): Flashcard {
  return {
    id, question: 'Q', answer: 'A', tags: [],
    createdAt: new Date(2025, 11, 1), updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Flashcard;
}

function item(id: string, isNew: boolean, folderId?: string): LimitedItem<string> {
  return { item: id, isNew, folderId };
}

describe('isNewItem', () => {
  it('treats an untouched card as new', () => {
    expect(isNewItem({})).toBe(true);
  });

  it('treats a card with a schedule as not new', () => {
    expect(isNewItem({ nextReview: new Date() })).toBe(false);
  });

  it('treats a card with repetitions as not new', () => {
    expect(isNewItem({ repetitions: 1 })).toBe(false);
  });

  it('treats a card with history as not new', () => {
    expect(isNewItem({ reviewHistory: [{ date: '2026-01-01', quality: 2 }] })).toBe(false);
  });
});

describe('applyDailyLimits', () => {
  it('caps new material and lets the rest wait', () => {
    const queue = [item('n1', true), item('n2', true), item('n3', true)];
    const result = applyDailyLimits(queue, LIMITS);
    expect(result.included).toHaveLength(2);
    expect(result.deferred).toHaveLength(1);
    expect(result.includedNew).toBe(2);
    expect(result.deferredNew).toBe(1);
  });

  it('caps reviews separately from new material', () => {
    const queue = [
      item('r1', false), item('r2', false), item('r3', false), item('r4', false),
      item('n1', true),
    ];
    const result = applyDailyLimits(queue, LIMITS);
    // Three reviews fit; the new card fits in the new budget.
    expect(result.includedReviews).toBe(3);
    expect(result.deferredReviews).toBe(1);
    expect(result.includedNew).toBe(1);
  });

  it('takes from the end of the queue, keeping the most urgent', () => {
    const queue = [
      item('leech', false), item('wrong', false), item('overdue', false),
      item('later', false), item('newest', true),
    ];
    const result = applyDailyLimits(queue, LIMITS);
    // Three reviews fit (the three urgent ones), and one new card fits in
    // the new budget. The fourth review waits for tomorrow.
    expect(result.included.map(i => i.item)).toEqual(['leech', 'wrong', 'overdue', 'newest']);
    expect(result.deferred.map(i => i.item)).toEqual(['later']);
  });

  it('lets everything through when there is less than the limit', () => {
    const queue = [item('a', true), item('b', false)];
    const result = applyDailyLimits(queue, LIMITS);
    expect(result.deferred).toHaveLength(0);
  });

  it('caps new material at zero when the limit is zero', () => {
    const result = applyDailyLimits([item('n1', true)], { newPerDay: 0, reviewsPerDay: 10 });
    expect(result.included).toHaveLength(0);
    expect(result.deferred).toHaveLength(1);
  });
});

describe('limitsForDeck', () => {
  const decks: DeckLimit[] = [
    { folderId: 'f1', name: 'Biology', newPerDay: 20, reviewsPerDay: 50 },
    { folderId: 'f2', name: 'Zero deck', newPerDay: 0 },
  ];

  it('uses the global limits when there is no deck', () => {
    expect(limitsForDeck(undefined, LIMITS, decks)).toEqual(LIMITS);
    expect(limitsForDeck('unknown', LIMITS, decks)).toEqual(LIMITS);
  });

  it('uses the deck override where there is one', () => {
    expect(limitsForDeck('f1', LIMITS, decks)).toEqual({ newPerDay: 20, reviewsPerDay: 50 });
  });

  it('falls back to the global limit for a field the deck does not set', () => {
    expect(limitsForDeck('f2', LIMITS, decks).reviewsPerDay).toBe(LIMITS.reviewsPerDay);
  });

  it('treats an override of zero as a real override', () => {
    expect(limitsForDeck('f2', LIMITS, decks).newPerDay).toBe(0);
  });
});

describe('per-deck limits', () => {
  it('counts each deck against its own budget', () => {
    const decks: DeckLimit[] = [{ folderId: 'f1', name: 'Biology', newPerDay: 1, reviewsPerDay: 1 }];
    const queue = [
      item('a', true, 'f1'),
      item('b', true, 'f1'),
      item('c', true, 'f2'),
      item('d', true, 'f2'),
    ];
    const result = applyDailyLimits(queue, LIMITS, decks);
    // f1 gets one new card; f2 falls back to the global limit of two.
    expect(result.included.map(i => i.item)).toEqual(['a', 'c', 'd']);
  });
});

describe('limitToday', () => {
  const flashcards = [
    card('c1', { repetitions: 2, nextReview: new Date(2026, 0, 10) }),
    card('c2', { repetitions: 1, nextReview: new Date(2026, 0, 10) }),
    card('c3'),
  ];
  const questions: PracticeQuestion[] = [
    { id: 'q1', question: 'Q', answer: 'A', type: 'open', createdAt: new Date(), updatedAt: new Date() },
  ];
  const notes: Note[] = [
    { id: 'n1', title: 'T', content: 'C', tags: [], type: 'note', createdAt: new Date(), updatedAt: new Date() },
  ];

  it('splits the day back into cards, questions and notes', () => {
    const queue: QueuedItem[] = [
      { kind: 'card', id: 'c1', isNew: false, value: flashcards[0] },
      { kind: 'question', id: 'q1', isNew: true, value: questions[0] },
      { kind: 'note', id: 'n1', isNew: true, value: notes[0] },
    ];
    const work = limitToday(queue, { newPerDay: 10, reviewsPerDay: 10 });
    expect(work.cards).toHaveLength(1);
    expect(work.questions).toHaveLength(1);
    expect(work.notes).toHaveLength(1);
    expect(work.deferredCount).toBe(0);
  });

  it('counts what it held back', () => {
    const queue: QueuedItem[] = [
      { kind: 'card', id: 'c1', isNew: false, value: flashcards[0] },
      { kind: 'card', id: 'c2', isNew: false, value: flashcards[1] },
      { kind: 'card', id: 'c3', isNew: true, value: flashcards[2] },
    ];
    const work = limitToday(queue, { newPerDay: 0, reviewsPerDay: 1 });
    expect(work.cards).toHaveLength(1);
    expect(work.deferredCount).toBe(2);
    expect(work.deferredNew).toBe(1);
    expect(work.deferredReviews).toBe(1);
  });
});

describe('buildDailyQueue', () => {
  it('keeps the plan order and finds the underlying items', () => {
    const flashcards = [card('c1'), card('c2')];
    const notes: Note[] = [
      { id: 'n1', title: 'T', content: 'C', tags: [], type: 'note', createdAt: new Date(), updatedAt: new Date() },
    ];
    const queue = buildDailyQueue(
      [
        { id: 'c2', kind: 'card', isNew: true },
        { id: 'n1', kind: 'note', isNew: false },
        { id: 'c1', kind: 'card', isNew: true },
      ],
      flashcards, [], notes,
    );
    expect(queue.map(q => q.id)).toEqual(['c2', 'n1', 'c1']);
    expect(queue[0].kind).toBe('card');
    expect(queue[1].kind).toBe('note');
  });

  it('skips plan items that no longer exist', () => {
    const queue = buildDailyQueue([{ id: 'gone', kind: 'card', isNew: true }], [], [], []);
    expect(queue).toHaveLength(0);
  });
});

describe('limitSummary', () => {
  it('says nothing when nothing was held back', () => {
    expect(limitSummary({ deferredCount: 0, deferredNew: 0, deferredReviews: 0 }, LIMITS)).toBeNull();
  });

  it('explains what is waiting and why', () => {
    const summary = limitSummary({ deferredCount: 5, deferredNew: 2, deferredReviews: 3 }, LIMITS);
    expect(summary).toContain('3 reviews');
    expect(summary).toContain('2 new');
    expect(summary).toContain('waiting for tomorrow');
  });
});

describe('defaults', () => {
  it('starts conservative', () => {
    expect(DEFAULT_LIMITS.newPerDay).toBeLessThanOrEqual(20);
    expect(DEFAULT_LIMITS.reviewsPerDay).toBeGreaterThan(DEFAULT_LIMITS.newPerDay);
  });
});
