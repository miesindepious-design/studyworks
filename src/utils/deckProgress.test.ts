/**
 * Tests for deck progress.
 *
 * The behaviours that matter:
 *
 *   - every folder gets a row, even an empty one;
 *   - a card is only "mastered" when it is both well-repeated and easy;
 *   - a deck that is half learning does not read as half done;
 *   - cards in no folder are not lost.
 */
import { describe, it, expect } from 'vitest';
import { computeDeckProgress, overallProgress, deckSummary } from './deckProgress';
import type { Flashcard, Folder } from '../types';

const NOW = new Date(2026, 0, 15, 12, 0, 0);

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Biology', createdAt: new Date(2025, 11, 1) },
  { id: 'f2', name: 'Quadratics', createdAt: new Date(2025, 11, 1) },
];

function card(id: string, folderId: string | undefined, over: Partial<Flashcard> = {}): Flashcard {
  return {
    id, question: 'Q', answer: 'A', tags: [],
    createdAt: new Date(2025, 11, 1), updatedAt: new Date(2025, 11, 1),
    folderId,
    ...over,
  } as Flashcard;
}

describe('computeDeckProgress', () => {
  it('reports every folder, even an empty one', () => {
    const decks = computeDeckProgress([], FOLDERS, NOW);
    expect(decks).toHaveLength(2);
    const biology = decks.find(d => d.folderId === 'f1')!;
    expect(biology.total).toBe(0);
    expect(biology.progress).toBe(0);
  });

  it('counts a never-reviewed card as new', () => {
    const decks = computeDeckProgress([card('c1', 'f1')], FOLDERS, NOW);
    const biology = decks.find(d => d.folderId === 'f1')!;
    expect(biology.new).toBe(1);
    expect(biology.mastered).toBe(0);
    expect(biology.learning).toBe(0);
  });

  it('counts a card that is progressing but not easy as learning', () => {
    const decks = computeDeckProgress(
      [card('c1', 'f1', { repetitions: 2, ef: 2.0 })],
      FOLDERS, NOW,
    );
    const biology = decks.find(d => d.folderId === 'f1')!;
    expect(biology.learning).toBe(1);
    expect(biology.mastered).toBe(0);
  });

  it('counts a well-repeated easy card as mastered', () => {
    const decks = computeDeckProgress(
      [card('c1', 'f1', { repetitions: 4, ef: 2.6 })],
      FOLDERS, NOW,
    );
    expect(decks.find(d => d.folderId === 'f1')!.mastered).toBe(1);
  });

  it('does not call a card mastered on repetition count alone', () => {
    const decks = computeDeckProgress(
      [card('c1', 'f1', { repetitions: 10, ef: 1.5 })],
      FOLDERS, NOW,
    );
    expect(decks.find(d => d.folderId === 'f1')!.mastered).toBe(0);
    expect(decks.find(d => d.folderId === 'f1')!.learning).toBe(1);
  });

  it('counts a card scheduled in the past as due', () => {
    const decks = computeDeckProgress(
      [card('c1', 'f1', { repetitions: 1, nextReview: new Date(2026, 0, 1) })],
      FOLDERS, NOW,
    );
    expect(decks.find(d => d.folderId === 'f1')!.due).toBe(1);
  });

  it('does not count a card scheduled in the future as due', () => {
    const decks = computeDeckProgress(
      [card('c1', 'f1', { repetitions: 1, nextReview: new Date(2026, 0, 20) })],
      FOLDERS, NOW,
    );
    expect(decks.find(d => d.folderId === 'f1')!.due).toBe(0);
  });

  it('does not lose a card that is in no folder', () => {
    const decks = computeDeckProgress([card('c1', undefined)], FOLDERS, NOW);
    const unfiled = decks.find(d => d.folderId === 'default');
    expect(unfiled).toBeDefined();
    expect(unfiled!.total).toBe(1);
  });

  it('gives a learning deck partial credit, not full credit', () => {
    const decks = computeDeckProgress(
      [
        card('c1', 'f1', { repetitions: 2, ef: 2.0 }),  // learning
        card('c2', 'f1', { repetitions: 2, ef: 2.0 }),  // learning
        card('c3', 'f1', { repetitions: 4, ef: 2.6 }),  // mastered
        card('c4', 'f1'),                               // new
      ],
      FOLDERS, NOW,
    );
    const biology = decks.find(d => d.folderId === 'f1')!;
    // One mastered of four is 25%, plus credit for the two learning cards.
    expect(biology.progress).toBeGreaterThan(25);
    expect(biology.progress).toBeLessThan(75);
  });

  it('puts the deck with the most work waiting first', () => {
    const decks = computeDeckProgress(
      [
        card('c1', 'f1', { repetitions: 1, nextReview: new Date(2026, 0, 1) }),
        card('c2', 'f2', { repetitions: 1, nextReview: new Date(2026, 0, 1) }),
        card('c3', 'f2', { repetitions: 1, nextReview: new Date(2026, 0, 1) }),
      ],
      FOLDERS, NOW,
    );
    expect(decks[0].folderId).toBe('f2');
  });
});

describe('overallProgress', () => {
  it('is zero with no decks', () => {
    expect(overallProgress([])).toBe(0);
  });

  it('weights each deck by its size', () => {
    const decks = computeDeckProgress(
      [
        card('c1', 'f1', { repetitions: 4, ef: 2.6 }),  // mastered
        card('c2', 'f1', { repetitions: 4, ef: 2.6 }),  // mastered
        card('c3', 'f2'),                               // new
        card('c4', 'f2'),                               // new
        card('c5', 'f2'),                               // new
        card('c6', 'f2'),                               // new
      ],
      FOLDERS, NOW,
    );
    // A small mastered deck should not outweigh a large empty one.
    expect(overallProgress(decks)).toBeLessThan(50);
  });
});

describe('deckSummary', () => {
  it('says when a deck is empty', () => {
    expect(deckSummary({ folderId: 'f1', name: 'X', total: 0, mastered: 0, learning: 0, new: 0, due: 0, progress: 0 }))
      .toBe('Empty deck');
  });

  it('mentions the mastered count, what is due and what is new', () => {
    const summary = deckSummary({ folderId: 'f1', name: 'X', total: 10, mastered: 4, learning: 2, new: 3, due: 5, progress: 40 });
    expect(summary).toContain('4 of 10 mastered');
    expect(summary).toContain('5 due');
    expect(summary).toContain('3 new');
  });
});
