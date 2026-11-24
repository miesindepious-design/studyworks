/**
 * errorNotebook.ts — the mistakes book.
 *
 * A student makes mistakes, and the single most useful thing an app can do
 * is show them the mistakes again. Today the app tracks mistakes twice over,
 * in two incompatible ways:
 *
 *   - flashcards keep a `reviewHistory` trail of quality ratings, and a
 *     `leechCount` for cards that keep failing;
 *   - practice questions keep only `lastAnsweredCorrect`.
 *
 * So a student who got a practice question wrong has no way back to it, and
 * a student whose card failed twice but not three times does not see it
 * either (three failures is the leech threshold).
 *
 * This module builds one notebook from both sources, so "show me what I got
 * wrong" is a single question with a single answer.
 */
import type { Flashcard, PracticeQuestion } from '../types';
import { isLeech } from '../game/rules';

export type MistakeKind = 'card' | 'question';

export interface Mistake {
  id: string;
  kind: MistakeKind;
  /** The question that was answered wrongly. */
  question: string;
  /** The right answer. */
  answer: string;
  /** The subject, when known. */
  topic?: string;
  /** How many times this has been got wrong. */
  wrongCount: number;
  /** When it was last got wrong, if known. */
  lastWrongAt?: Date;
  /** True when the item has failed repeatedly — the card is broken. */
  isLeech: boolean;
}

/** The quality rating SM-2 uses for "I got this wrong". */
const WRONG_QUALITY = 0;

/**
 * How many recent failures count as "worth reviewing again".
 *
 * A single miss is normal — the point of spaced repetition is that things
 * get missed. Two misses in the recent trail means it is sticking, so it goes
 * in the notebook.
 */
const MIN_FAILURES = 2;

/** How many recent ratings to consider. Older history is not a "recent" mistake. */
const RECENT_HISTORY = 10;

/**
 * Build the mistakes book.
 *
 * @param flashcards  every card the student owns
 * @param questions   every practice question the student owns
 */
export function buildMistakes(
  flashcards: Flashcard[],
  questions: PracticeQuestion[],
): Mistake[] {
  const mistakes: Mistake[] = [];

  // ── Cards ───────────────────────────────────────────────────────────────────
  for (const card of flashcards) {
    const history = card.reviewHistory ?? [];
    if (history.length === 0) continue;

    const recent = history.slice(-RECENT_HISTORY);
    const failures = recent.filter(h => h.quality === WRONG_QUALITY);
    if (failures.length === 0) continue;

    // A leech is in the book on its own — three failures is the point where
    // the card, not the student, is the problem.
    const leech = isLeech(card);
    if (failures.length < MIN_FAILURES && !leech) continue;

    const lastFailure = failures[failures.length - 1];
    const lastWrongAt = lastFailure?.date ? new Date(lastFailure.date) : undefined;

    mistakes.push({
      id: card.id,
      kind: 'card',
      question: card.question,
      answer: card.answer,
      topic: (card.topic ?? '').trim() || undefined,
      wrongCount: failures.length,
      lastWrongAt: lastWrongAt && !Number.isNaN(lastWrongAt.getTime()) ? lastWrongAt : undefined,
      isLeech: leech,
    });
  }

  // ── Practice questions ──────────────────────────────────────────────────────
  for (const q of questions) {
    if (q.lastAnsweredCorrect !== false) continue;
    mistakes.push({
      id: q.id,
      kind: 'question',
      question: q.question,
      answer: q.answer,
      topic: (q.topic ?? '').trim() || undefined,
      // The app only stores the last answer, so the count is honest at 1.
      wrongCount: 1,
      lastWrongAt: undefined,
      isLeech: false,
    });
  }

  // Leeches first, then most-wrong first, then most recent.
  mistakes.sort((a, b) => {
    if (a.isLeech !== b.isLeech) return a.isLeech ? -1 : 1;
    if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
    const aTime = a.lastWrongAt ? a.lastWrongAt.getTime() : 0;
    const bTime = b.lastWrongAt ? b.lastWrongAt.getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });

  return mistakes;
}

/** Split the notebook by subject, for grouping in the UI. */
export function groupMistakesByTopic(mistakes: Mistake[]): Map<string, Mistake[]> {
  const groups = new Map<string, Mistake[]>();
  for (const mistake of mistakes) {
    const topic = mistake.topic || 'General';
    const list = groups.get(topic);
    if (list) list.push(mistake);
    else groups.set(topic, [mistake]);
  }
  // The biggest problem first.
  return new Map(
    Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length),
  );
}

/** The summary line for the mistakes panel. */
export function mistakesSummary(mistakes: Mistake[]): string {
  if (mistakes.length === 0) return 'No mistakes logged — nice work.';
  const leeches = mistakes.filter(m => m.isLeech).length;
  const parts = [`${mistakes.length} to re-review`];
  if (leeches > 0) parts.push(`${leeches} tough card${leeches === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
