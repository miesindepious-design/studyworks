/**
 * Tests for the mistakes book.
 *
 * The rules that matter: a single miss is not a mistake worth logging (that
 * is just spaced repetition doing its job), two misses are, a leech always
 * is, and a wrongly-answered practice question always is.
 */
import { describe, it, expect } from 'vitest';
import { buildMistakes, groupMistakesByTopic, mistakesSummary } from './errorNotebook';
import type { Flashcard, PracticeQuestion } from '../types';

function card(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c-' + Math.random().toString(36).slice(2, 8),
    question: 'What is it?',
    answer: 'This',
    tags: [],
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Flashcard;
}

function question(over: Partial<PracticeQuestion> = {}): PracticeQuestion {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8),
    question: 'What is it?',
    answer: 'This',
    type: 'open',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as PracticeQuestion;
}

const fail = { date: '2026-01-10', quality: 0 };
const good = { date: '2026-01-11', quality: 2 };

describe('buildMistakes', () => {
  it('ignores a card with no history', () => {
    expect(buildMistakes([card({ id: 'c1' })], [])).toHaveLength(0);
  });

  it('ignores a card that was only answered well', () => {
    const c = card({ id: 'c1', reviewHistory: [good, good] });
    expect(buildMistakes([c], [])).toHaveLength(0);
  });

  it('ignores a card missed only once', () => {
    const c = card({ id: 'c1', reviewHistory: [good, fail] });
    expect(buildMistakes([c], [])).toHaveLength(0);
  });

  it('logs a card missed twice', () => {
    const c = card({ id: 'c1', reviewHistory: [fail, good, fail] });
    const mistakes = buildMistakes([c], []);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].id).toBe('c1');
    expect(mistakes[0].wrongCount).toBe(2);
  });

  it('logs a leech even if it has only failed once recently', () => {
    const c = card({ id: 'leech', leechCount: 3, reviewHistory: [fail] });
    const mistakes = buildMistakes([c], []);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].isLeech).toBe(true);
  });

  it('logs a card whose ease factor has collapsed', () => {
    const c = card({ id: 'collapsed', ef: 1.5, repetitions: 3, reviewHistory: [fail] });
    const mistakes = buildMistakes([c], []);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].isLeech).toBe(true);
  });

  it('logs a wrongly-answered practice question', () => {
    const q = question({ id: 'q1', lastAnsweredCorrect: false });
    const mistakes = buildMistakes([], [q]);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].kind).toBe('question');
    expect(mistakes[0].id).toBe('q1');
  });

  it('does not log a correctly-answered practice question', () => {
    const q = question({ id: 'q1', lastAnsweredCorrect: true });
    expect(buildMistakes([], [q])).toHaveLength(0);
  });

  it('does not log a practice question that was never answered', () => {
    const q = question({ id: 'q1' });
    expect(buildMistakes([], [q])).toHaveLength(0);
  });

  it('puts leeches first', () => {
    const leech = card({ id: 'leech', leechCount: 4, reviewHistory: [fail] });
    const twice = card({ id: 'twice', reviewHistory: [fail, fail] });
    const mistakes = buildMistakes([twice, leech], []);
    expect(mistakes[0].id).toBe('leech');
  });

  it('puts the most-wrong item first among non-leeches', () => {
    const three = card({ id: 'three', reviewHistory: [fail, fail, fail] });
    const two = card({ id: 'two', reviewHistory: [fail, fail] });
    const mistakes = buildMistakes([two, three], []);
    expect(mistakes[0].id).toBe('three');
  });

  it('keeps the question and answer so the item can be reviewed', () => {
    const c = card({ id: 'c1', question: 'What is mitosis?', answer: 'Cell division', reviewHistory: [fail, fail] });
    const mistakes = buildMistakes([c], []);
    expect(mistakes[0].question).toBe('What is mitosis?');
    expect(mistakes[0].answer).toBe('Cell division');
  });

  it('records the subject when the card has one', () => {
    const c = card({ id: 'c1', topic: 'Biology', reviewHistory: [fail, fail] });
    expect(buildMistakes([c], [])[0].topic).toBe('Biology');
  });
});

describe('groupMistakesByTopic', () => {
  it('groups by subject, biggest group first', () => {
    const mistakes = buildMistakes(
      [
        card({ id: 'c1', topic: 'Biology', reviewHistory: [fail, fail] }),
        card({ id: 'c2', topic: 'Maths', reviewHistory: [fail, fail] }),
        card({ id: 'c3', topic: 'Maths', reviewHistory: [fail, fail] }),
      ],
      [],
    );
    const groups = groupMistakesByTopic(mistakes);
    expect(Array.from(groups.keys())[0]).toBe('Maths');
    expect(groups.get('Maths')).toHaveLength(2);
  });

  it('files a subjectless mistake under General', () => {
    const mistakes = buildMistakes([card({ id: 'c1', reviewHistory: [fail, fail] })], []);
    expect(Array.from(groupMistakesByTopic(mistakes).keys())).toEqual(['General']);
  });
});

describe('mistakesSummary', () => {
  it('says so when there are none', () => {
    expect(mistakesSummary([])).toContain('No mistakes');
  });

  it('counts the items and the tough cards', () => {
    const mistakes = buildMistakes(
      [
        card({ id: 'leech', leechCount: 3, reviewHistory: [fail] }),
        card({ id: 'c2', reviewHistory: [fail, fail] }),
      ],
      [],
    );
    const summary = mistakesSummary(mistakes);
    expect(summary).toContain('2');
    expect(summary).toContain('tough');
  });
});
