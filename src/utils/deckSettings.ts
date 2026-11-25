/**
 * deckSettings.ts — daily limits, so a backlog does not become a wall.
 *
 * The problem this solves: with eight hundred due cards, the app currently
 * offers all eight hundred or nothing. A student either faces a session that
 * runs for two hours or skips the day entirely. Neither is good. Spaced
 * repetition works because it is relentless and *small* — a bounded amount
 * every day beats an unbounded amount occasionally.
 *
 * So the daily queue is capped:
 *
 *   - **New** material per day. Learning twenty new cards at once is how a
 *     student drowns. The limit is deliberately low by default.
 *   - **Reviews** per day. A large backlog is reviewed slowly over days
 *     rather than all at once, which is exactly how Anki behaves and why it
 *     works.
 *
 * The limits apply to the whole day's queue across all three material types
 * (cards, practice questions, notes), because the student does not think of
 * them as separate workloads — they think "what am I studying today".
 *
 * Per-deck overrides exist because a student often wants to hammer one
 * subject before an exam. A deck's limit replaces the global one for material
 * filed in that deck.
 */
import type { Flashcard, Note, PracticeQuestion } from '../types';

/** The global defaults. */
export interface DailyLimits {
  /** New items (never reviewed) to introduce per day. */
  newPerDay: number;
  /** Review items (already seen and due again) to clear per day. */
  reviewsPerDay: number;
}

/**
 * The defaults are conservative on purpose. A student who wants more can
 * raise them; a student who has never thought about it should not be handed
 * 200 new cards on day one.
 */
export const DEFAULT_LIMITS: DailyLimits = {
  newPerDay: 10,
  reviewsPerDay: 100,
};

/** The highest limit the UI allows, so a typo cannot lock the app. */
export const MAX_LIMIT = 500;

/** A per-deck override. */
export interface DeckLimit {
  /** The folder this applies to. */
  folderId: string;
  /** The deck's name, for display. */
  name: string;
  /** Overrides `newPerDay` for material in this folder. */
  newPerDay?: number;
  /** Overrides `reviewsPerDay` for material in this folder. */
  reviewsPerDay?: number;
}

/**
 * An item waiting in the queue, split into the two kinds the limits count
 * separately.
 */
export interface LimitedItem<T> {
  item: T;
  /** True when the student has never seen this before. */
  isNew: boolean;
  /** The deck this item belongs to, if any. */
  folderId?: string;
}

/** What the limits did to a queue. */
export interface LimitedQueue<T> {
  /** The items that fit within today's limits. */
  included: LimitedItem<T>[];
  /** The items held back for another day. */
  deferred: LimitedItem<T>[];
  /** How many of each kind made the cut. */
  includedNew: number;
  includedReviews: number;
  deferredNew: number;
  deferredReviews: number;
  /** The limits that were applied, after any per-deck overrides. */
  effective: DailyLimits;
}

/**
 * The limits that apply to a given deck.
 *
 * A deck with its own override uses those numbers; everything else uses the
 * global limits. An override of zero is meaningful — "no new cards from this
 * deck today" — so the check is for `undefined`, not truthiness.
 */
export function limitsForDeck(
  deckId: string | undefined,
  global: DailyLimits,
  decks: DeckLimit[] = [],
): DailyLimits {
  if (!deckId) return global;
  const deck = decks.find(d => d.folderId === deckId);
  if (!deck) return global;
  return {
    newPerDay: deck.newPerDay ?? global.newPerDay,
    reviewsPerDay: deck.reviewsPerDay ?? global.reviewsPerDay,
  };
}

/**
 * True when an item has never been reviewed.
 *
 * A card is new if it has no repetitions and no scheduled date. The same
 * applies to a question and a note.
 */
export function isNewItem(item: {
  repetitions?: number;
  nextReview?: Date;
  reviewHistory?: unknown[];
}): boolean {
  if (item.reviewHistory && item.reviewHistory.length > 0) return false;
  return (item.repetitions ?? 0) === 0 && !item.nextReview;
}

/**
 * Apply the daily limits to a queue.
 *
 * The order of the input matters and is preserved: whatever the caller
 * considered most important stays first, and the limits take from the front.
 * That means the most urgent material (leeches, wrong answers, overdue
 * work) is what gets into today's session, and the least urgent new cards
 * are what gets pushed to tomorrow.
 */
export function applyDailyLimits<T extends LimitedItem<unknown>>(
  queue: T[],
  global: DailyLimits = DEFAULT_LIMITS,
  decks: DeckLimit[] = [],
): LimitedQueue<T> {
  const included: T[] = [];
  const deferred: T[] = [];

  // Each deck is counted separately, because a per-deck limit is a budget
  // for that deck alone.
  const used = new Map<string, { newCount: number; reviewCount: number }>();
  const budgetFor = (folderId?: string) => limitsForDeck(folderId, global, decks);
  const bucketFor = (folderId?: string) => {
    const key = folderId ?? '__global__';
    let bucket = used.get(key);
    if (!bucket) { bucket = { newCount: 0, reviewCount: 0 }; used.set(key, bucket); }
    return bucket;
  };

  let includedNew = 0;
  let includedReviews = 0;
  let deferredNew = 0;
  let deferredReviews = 0;

  for (const entry of queue) {
    const limits = budgetFor(entry.folderId);
    const bucket = bucketFor(entry.folderId);

    if (entry.isNew) {
      if (bucket.newCount < limits.newPerDay) {
        bucket.newCount++;
        includedNew++;
        included.push(entry);
      } else {
        deferredNew++;
        deferred.push(entry);
      }
    } else {
      if (bucket.reviewCount < limits.reviewsPerDay) {
        bucket.reviewCount++;
        includedReviews++;
        included.push(entry);
      } else {
        deferredReviews++;
        deferred.push(entry);
      }
    }
  }

  return {
    included,
    deferred,
    includedNew,
    includedReviews,
    deferredNew,
    deferredReviews,
    effective: global,
  };
}

/**
 * A queued item, tagged with what kind of material it is. The tag is
 * explicit so the limits can split the day's work back apart without
 * guessing from the shape of the object.
 */
export interface QueuedItem {
  kind: 'card' | 'question' | 'note';
  id: string;
  isNew: boolean;
  folderId?: string;
  /** The underlying card, question or note. */
  value: Flashcard | PracticeQuestion | Note;
}

/** The day's work after the limits have been applied. */
export interface DailyWork {
  cards: Flashcard[];
  questions: PracticeQuestion[];
  notes: Note[];
  /** How many items were held back for another day. */
  deferredCount: number;
  deferredNew: number;
  deferredReviews: number;
}

/**
 * Apply the limits to the day's actual work: cards, questions and notes
 * together, in one budget.
 *
 * The input order is the priority order the caller decided on — the most
 * urgent material first — and the limits take from the front of it.
 */
export function limitToday(
  queue: QueuedItem[],
  global: DailyLimits = DEFAULT_LIMITS,
  decks: DeckLimit[] = [],
): DailyWork {
  const result = applyDailyLimits(queue, global, decks);

  const cards: Flashcard[] = [];
  const questions: PracticeQuestion[] = [];
  const notes: Note[] = [];

  // `applyDailyLimits` returns the queue entries themselves, so the entry
  // carries the kind and the value directly.
  for (const entry of result.included) {
    if (entry.kind === 'card') cards.push(entry.value as Flashcard);
    else if (entry.kind === 'question') questions.push(entry.value as PracticeQuestion);
    else notes.push(entry.value as Note);
  }

  return {
    cards,
    questions,
    notes,
    deferredCount: result.deferred.length,
    deferredNew: result.deferredNew,
    deferredReviews: result.deferredReviews,
  };
}

/**
 * Turn the day's material into a priority-ordered queue that the limits can
 * be applied to.
 *
 * The order is the same one the Study Plan uses: leeches and wrong answers
 * first, then overdue work, then new material. Reviewing the queue in this
 * order and then capping it means the cap takes from the least important end.
 */
export function buildDailyQueue(
  planItems: { id: string; kind: 'card' | 'question' | 'note'; isNew: boolean; topic?: string }[],
  flashcards: Flashcard[],
  questions: PracticeQuestion[],
  notes: Note[],
): QueuedItem[] {
  const cardById = new Map(flashcards.map(c => [c.id, c]));
  const questionById = new Map(questions.map(q => [q.id, q]));
  const noteById = new Map(notes.map(n => [n.id, n]));

  const queue: QueuedItem[] = [];
  for (const item of planItems) {
    if (item.kind === 'card') {
      const card = cardById.get(item.id);
      if (card) queue.push({ kind: 'card', id: item.id, isNew: item.isNew, folderId: card.folderId, value: card });
    } else if (item.kind === 'question') {
      const q = questionById.get(item.id);
      if (q) queue.push({ kind: 'question', id: item.id, isNew: item.isNew, folderId: undefined, value: q });
    } else {
      const note = noteById.get(item.id);
      if (note) queue.push({ kind: 'note', id: item.id, isNew: item.isNew, folderId: note.folderId, value: note });
    }
  }
  return queue;
}

/**
 * A sentence explaining what the limits did, for the plan to show.
 *
 * A student who is capped deserves to know why — and that the rest is
 * waiting, not lost.
 */
export function limitSummary(
  result: { deferredCount: number; deferredNew: number; deferredReviews: number },
  global: DailyLimits = DEFAULT_LIMITS,
): string | null {
  if (result.deferredCount === 0) return null;

  const parts: string[] = [];
  if (result.deferredReviews > 0) {
    parts.push(`${result.deferredReviews} review${result.deferredReviews === 1 ? '' : 's'}`);
  }
  if (result.deferredNew > 0) parts.push(`${result.deferredNew} new`);

  return `${parts.join(' and ')} waiting for tomorrow — today's limits are ${global.newPerDay} new and ${global.reviewsPerDay} reviews.`;
}
