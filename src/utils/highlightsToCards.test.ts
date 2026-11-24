/**
 * Tests for the highlights-to-cards converter.
 *
 * The important behaviours: a highlight becomes a usable card, a highlight
 * too short to hold a cloze falls back to a recall card rather than a broken
 * one, duplicates do not produce duplicate cards, and the finished cards are
 * valid flashcards.
 */
import { describe, it, expect } from 'vitest';
import {
  highlightToCard,
  highlightsToCards,
  draftsToFlashcards,
} from './highlightsToCards';
import type { Highlight } from '../types';

function highlight(text: string, id = 'h1'): Highlight {
  return { id, text, color: '#fde68a', createdAt: new Date(2026, 0, 1) };
}

describe('highlightToCard', () => {
  it('makes a cloze card that hides a key word', () => {
    const draft = highlightToCard(
      highlight('Photosynthesis converts light energy into chemical energy stored in glucose.'),
      'Biology',
      'cloze',
    );
    expect(draft).not.toBeNull();
    expect(draft!.mode).toBe('cloze');
    expect(draft!.question).toContain('{{c1}}');
    expect(draft!.answer.length).toBeGreaterThan(3);
  });

  it('makes a recall card that quotes the passage', () => {
    const text = 'The cell membrane is selectively permeable.';
    const draft = highlightToCard(highlight(text), 'Biology', 'recall');
    expect(draft!.mode).toBe('recall');
    expect(draft!.question).toContain('Biology');
    expect(draft!.answer).toBe(text);
  });

  it('falls back to recall when the passage is too short for a cloze', () => {
    // Long enough to be worth a card, but too short to hide a word in.
    const draft = highlightToCard(highlight('A short sentence.'), 'Biology', 'cloze');
    expect(draft!.mode).toBe('recall');
  });

  it('refuses a highlight that is too short to be worth a card', () => {
    expect(highlightToCard(highlight('why?'), 'Biology')).toBeNull();
    expect(highlightToCard(highlight('   '), 'Biology')).toBeNull();
  });

  it('records which highlight the card came from', () => {
    const draft = highlightToCard(highlight('Some text here.', 'h-42'), 'Note');
    expect(draft!.sourceHighlightId).toBe('h-42');
  });
});

describe('highlightsToCards', () => {
  it('makes one card per highlight', () => {
    const drafts = highlightsToCards('Note', [
      highlight('Photosynthesis converts light energy into chemical energy.', 'h1'),
      highlight('The cell membrane is selectively permeable to small molecules.', 'h2'),
    ]);
    expect(drafts).toHaveLength(2);
  });

  it('drops duplicate highlights instead of making duplicate cards', () => {
    const text = 'Photosynthesis converts light energy into chemical energy.';
    const drafts = highlightsToCards('Note', [highlight(text, 'h1'), highlight(text, 'h2')]);
    expect(drafts).toHaveLength(1);
  });

  it('skips highlights that are too short, but keeps the good ones', () => {
    const drafts = highlightsToCards('Note', [
      highlight('ok', 'h1'),
      highlight('Photosynthesis converts light energy into chemical energy.', 'h2'),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceHighlightId).toBe('h2');
  });
});

describe('draftsToFlashcards', () => {
  it('produces valid flashcards that inherit the note', () => {
    const drafts = highlightsToCards('Biology', [
      highlight('Photosynthesis converts light energy into chemical energy.', 'h1'),
    ]);
    const cards = draftsToFlashcards(drafts, { id: 'n1', tags: ['exam'], folderId: 'f1' });

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBeTruthy();
    expect(cards[0].answer).toBeTruthy();
    expect(cards[0].tags).toContain('exam');
    expect(cards[0].tags).toContain('highlight');
    expect(cards[0].folderId).toBe('f1');
    expect(cards[0].source).toBe('note');
    expect(cards[0].id.startsWith('n1-hl-')).toBe(true);
  });

  it('gives every card a unique id', () => {
    const drafts = highlightsToCards('Note', [
      highlight('The first highlighted passage about something.', 'h1'),
      highlight('The second highlighted passage about something else.', 'h2'),
    ]);
    const cards = draftsToFlashcards(drafts, { id: 'n1', tags: [] });
    expect(new Set(cards.map(c => c.id)).size).toBe(cards.length);
  });

  it('marks a cloze draft as a cloze card', () => {
    const drafts = highlightsToCards('Note', [
      highlight('Photosynthesis converts light energy into chemical energy.', 'h1'),
    ], 'cloze');
    const cards = draftsToFlashcards(drafts, { id: 'n1', tags: [] });
    expect(cards[0].type).toBe('cloze');
  });

  it('marks a recall draft as a standard card', () => {
    const drafts = highlightsToCards('Note', [
      highlight('Photosynthesis converts light energy into chemical energy.', 'h1'),
    ], 'recall');
    const cards = draftsToFlashcards(drafts, { id: 'n1', tags: [] });
    expect(cards[0].type).toBe('standard');
  });
});
