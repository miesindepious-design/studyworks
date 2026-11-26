/**
 * Tests for the leech fixer's offer/apply logic.
 *
 * The behaviours that matter:
 *
 *   - leeches and AI-made cards are offered a fix;
 *   - healthy human-made cards are not;
 *   - a card that has already been fixed is never offered a second one;
 *   - accepting a rewrite changes the wording and stamps the card, but never
 *     touches the spaced-repetition history.
 */
import { describe, it, expect } from 'vitest';
import { canOfferCardFix, applyCardFix, type CardFixProposal } from './cardFix';
import { Flashcard } from '../types';

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c1',
    question: 'What about the mitochondria thing?',
    answer: 'It makes energy and also DNA and stuff',
    tags: [],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const FIX: CardFixProposal = {
  question: 'Where does the cell produce most of its ATP?',
  answer: 'The mitochondria',
  whatChanged: 'The question was vague and the answer smuggled in a second fact.',
};

describe('canOfferCardFix', () => {
  it('offers a fix for a leech, whatever its origin', () => {
    expect(canOfferCardFix(card({ leechCount: 3 }))).toBe(true);
    expect(canOfferCardFix(card({ leechCount: 7, source: 'manual' }))).toBe(true);
  });

  it('offers a fix for AI-made cards even before they become leeches', () => {
    expect(canOfferCardFix(card({ source: 'ai' }))).toBe(true);
    expect(canOfferCardFix(card({ source: 'tutor' }))).toBe(true);
  });

  it('never offers a fix for healthy human-made cards', () => {
    expect(canOfferCardFix(card())).toBe(false);
    expect(canOfferCardFix(card({ source: 'manual' }))).toBe(false);
    expect(canOfferCardFix(card({ source: 'note' }))).toBe(false);
    expect(canOfferCardFix(card({ source: 'import' }))).toBe(false);
  });

  it('never offers a second fix for a card that has already been fixed', () => {
    expect(canOfferCardFix(card({ leechCount: 3, fixedAt: '2026-11-25T10:00:00.000Z' }))).toBe(false);
    expect(canOfferCardFix(card({ source: 'ai', fixedAt: '2026-11-25T10:00:00.000Z' }))).toBe(false);
  });
});

describe('applyCardFix', () => {
  it('rewrites the wording and stamps the fix', () => {
    const leech = card({ leechCount: 4, topic: 'Biology', source: 'ai' });
    const fixed = applyCardFix(leech, FIX, '2026-11-25T10:00:00.000Z');

    expect(fixed.question).toBe(FIX.question);
    expect(fixed.answer).toBe(FIX.answer);
    expect(fixed.fixedAt).toBe('2026-11-25T10:00:00.000Z');
  });

  it('keeps the whole learning history intact', () => {
    const leech = card({
      leechCount: 4,
      repetitions: 5,
      ef: 2.1,
      interval: 12,
      nextReview: new Date('2026-12-01'),
      reviewHistory: [{ date: '2026-11-20', quality: 0 }],
    });
    const fixed = applyCardFix(leech, FIX);

    expect(fixed.repetitions).toBe(5);
    expect(fixed.ef).toBe(2.1);
    expect(fixed.interval).toBe(12);
    expect(fixed.nextReview).toEqual(new Date('2026-12-01'));
    expect(fixed.reviewHistory).toEqual([{ date: '2026-11-20', quality: 0 }]);
    expect(fixed.leechCount).toBe(4);
  });

  it('does not mutate the original card', () => {
    const leech = card({ leechCount: 3 });
    const fixed = applyCardFix(leech, FIX);

    expect(fixed).not.toBe(leech);
    expect(leech.question).toBe('What about the mitochondria thing?');
    expect(leech.fixedAt).toBeUndefined();
  });
});
