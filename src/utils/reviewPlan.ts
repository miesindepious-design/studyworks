/**
 * reviewPlan.ts — the "what should I study right now?" engine.
 *
 * The app keeps three separate kinds of reviewable material:
 *
 *   - flashcards        (SM-2 scheduled, `nextReview`)
 *   - practice questions (SM-2 scheduled, `nextReview`)
 *   - notes             (scheduled by `nextReminder`, not by SM-2)
 *
 * Each one had its own screen, so a student had to work out for themselves
 * what to do next, and the dashboard's "Today's plan" was a hand-written list
 * that only ever mentioned flashcards. This module turns all three into a
 * single ordered plan.
 *
 * The ordering rules, in priority order:
 *
 *   1. Leech cards and wrongly-answered practice questions come first. A card
 *      the student keeps failing is broken, not the student — it needs
 *      attention before anything new does.
 *   2. Then overdue material, most-overdue first. Overdue work is work the
 *      student already planned to do and did not.
 *   3. Then material due today.
 *   4. Then brand-new material, so a student with an empty queue still has
 *      something to do.
 *
 * Everything here is pure: it takes arrays and a clock and returns a plan.
 * That keeps it testable and keeps the React components honest.
 */
import type { Flashcard, Note, PracticeQuestion } from '../types';
import { isLeech } from '../game/rules';

export type PlanKind = 'card' | 'question' | 'note';

export interface PlanItem {
  /** Stable id — the source record's id. */
  id: string;
  kind: PlanKind;
  /** What to show the student. */
  title: string;
  /** Secondary line — the answer, or the note preview. */
  detail: string;
  /** Which subject/topic this belongs to, when known. */
  topic?: string;
  /** Higher means more urgent. Used for sorting. */
  priority: number;
  /** Why this item is in the plan, in words the student can read. */
  reason: PlanReason;
  /** When it became due. Null for material that has never been scheduled. */
  dueAt?: Date;
  /** True when the item has never been reviewed before. */
  isNew: boolean;
}

export type PlanReason = 'leech' | 'wrong' | 'overdue' | 'due' | 'new';

export interface ReviewPlan {
  items: PlanItem[];
  /** Counts by kind, for the summary line. */
  counts: Record<PlanKind, number>;
  /** How many items are in the plan. */
  total: number;
  /** Rough minutes, at the same rate the dashboard already uses (30s a card). */
  estimatedMinutes: number;
}

/** How long a card is expected to take, in seconds. */
const SECONDS_PER_CARD = 30;
/** A practice question takes longer — you read the options and think. */
const SECONDS_PER_QUESTION = 45;
/** Reading and recalling a note is quicker than answering a question. */
const SECONDS_PER_NOTE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days between two dates, by calendar day (not by 24h). */
export function daysBetween(a: Date, b: Date): number {
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bDay.getTime() - aDay.getTime()) / 86_400_000);
}

/** Truncate a date to its calendar day, in local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * How overdue a scheduled item is, in days. 0 means "not overdue", 1 means
 * "one day late", and so on. Items with no schedule are never overdue.
 */
export function overdueDays(dueAt: Date | undefined, now: Date): number {
  if (!dueAt) return 0;
  const diff = daysBetween(startOfDay(dueAt), startOfDay(now));
  return diff > 0 ? diff : 0;
}

/** The plain-text body of a note, for a one-line preview. */
function notePreview(note: Note): string {
  const text = (note.summary || note.content || '')
    .replace(/<[^>]*>/g, ' ')      // strip HTML from the rich-text editor
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 120 ? text.slice(0, 117) + '…' : text;
}

/** The subject a card belongs to, falling back to "General". */
export function topicOf(item: { topic?: string | null }): string {
  const topic = (item.topic ?? '').trim();
  return topic || 'General';
}

// ── Building the plan ─────────────────────────────────────────────────────────

/**
 * Build the ordered review plan.
 *
 * @param flashcards     every card the student owns
 * @param questions      every practice question the student owns
 * @param notes          every note the student owns
 * @param now            the clock. Passed in so the function stays pure and
 *                       testable.
 * @param limit          maximum number of items to return. The plan is a
 *                       "do this now" list, not an inventory — a student
 *                       should never open the app to a 400-item to-do list.
 */
export function buildReviewPlan(
  flashcards: Flashcard[],
  questions: PracticeQuestion[],
  notes: Note[],
  now: Date = new Date(),
  limit = 60,
): ReviewPlan {
  const items: PlanItem[] = [];

  // ── Flashcards ──────────────────────────────────────────────────────────────
  for (const card of flashcards) {
    const due = card.nextReview ? new Date(card.nextReview) : undefined;
    const late = overdueDays(due, now);
    const leech = isLeech(card);
    const neverReviewed = (card.repetitions ?? 0) === 0 && !due;

    let reason: PlanReason;
    let priority: number;

    if (leech) {
      reason = 'leech';
      priority = 1000;
    } else if (late > 0) {
      reason = 'overdue';
      // More overdue = more urgent, but the scale is gentle so one very old
      // card cannot bury everything else.
      priority = 500 + Math.min(late, 100);
    } else if (due) {
      reason = 'due';
      priority = 400;
    } else {
      reason = 'new';
      priority = 100;
    }

    items.push({
      id: card.id,
      kind: 'card',
      title: card.question,
      detail: card.answer,
      topic: topicOf(card),
      priority,
      reason,
      dueAt: due,
      isNew: neverReviewed,
    });
  }

  // ── Practice questions ──────────────────────────────────────────────────────
  for (const q of questions) {
    const due = q.nextReview ? new Date(q.nextReview) : undefined;
    const late = overdueDays(due, now);
    const wrong = q.lastAnsweredCorrect === false;
    const neverAnswered = q.lastAnsweredCorrect === undefined && !due;

    let reason: PlanReason;
    let priority: number;

    if (wrong) {
      reason = 'wrong';
      // A wrong answer is worth slightly less than a broken card, but more
      // than anything merely overdue.
      priority = 700 + Math.min(late, 50);
    } else if (late > 0) {
      reason = 'overdue';
      priority = 500 + Math.min(late, 100);
    } else if (due) {
      reason = 'due';
      priority = 400;
    } else {
      reason = 'new';
      priority = 100;
    }

    items.push({
      id: q.id,
      kind: 'question',
      title: q.question,
      detail: q.answer,
      topic: topicOf(q),
      priority,
      reason,
      dueAt: due,
      isNew: neverAnswered,
    });
  }

  // ── Notes due for a revisit ────────────────────────────────────────────────
  // A note becomes due two ways. The student can set `nextReminder` by hand
  // ("look at this again on Friday"), and the SM-2 scheduler sets `nextReview`
  // once the note has been recalled at least once. Either one puts it in the
  // plan; the earlier date wins, because that is when it is actually needed.
  for (const note of notes) {
    const candidates: Date[] = [];
    if (note.nextReminder) {
      const d = new Date(note.nextReminder);
      if (!Number.isNaN(d.getTime())) candidates.push(d);
    }
    if (note.nextReview) {
      const d = new Date(note.nextReview);
      if (!Number.isNaN(d.getTime())) candidates.push(d);
    }
    if (candidates.length === 0) continue;

    // The earliest schedule is the one that matters.
    const due = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    const late = overdueDays(due, now);
    if (late === 0 && due.getTime() > now.getTime()) continue; // not due yet

    items.push({
      id: note.id,
      kind: 'note',
      title: note.title,
      detail: notePreview(note),
      topic: topicOf(note),
      priority: late > 0 ? 500 + Math.min(late, 100) : 400,
      reason: late > 0 ? 'overdue' : 'due',
      dueAt: due,
      isNew: false,
    });
  }

  // ── Order ───────────────────────────────────────────────────────────────────
  // Priority first. Within the same priority, the oldest due date comes
  // first, so a tie never depends on the order the arrays happened to be in.
  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aDue = a.dueAt ? a.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? b.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return a.id.localeCompare(b.id);
  });

  const counts: Record<PlanKind, number> = { card: 0, question: 0, note: 0 };
  let seconds = 0;
  for (const item of items) {
    counts[item.kind]++;
    if (item.kind === 'card') seconds += SECONDS_PER_CARD;
    else if (item.kind === 'question') seconds += SECONDS_PER_QUESTION;
    else seconds += SECONDS_PER_NOTE;
  }

  return {
    items: items.slice(0, limit),
    counts,
    total: items.length,
    estimatedMinutes: Math.max(1, Math.round(seconds / 60)),
  };
}

/** A human-readable explanation of why an item is in the plan. */
export function reasonLabel(reason: PlanReason): string {
  switch (reason) {
    case 'leech':    return 'Tough card';
    case 'wrong':    return 'Got wrong';
    case 'overdue':  return 'Overdue';
    case 'due':      return 'Due now';
    case 'new':      return 'New';
  }
}

/**
 * The one-line summary the dashboard shows above the plan.
 * "12 to review · about 8 minutes" — no number without a meaning.
 */
export function planSummary(plan: ReviewPlan): string {
  if (plan.total === 0) return 'Nothing due — you are all caught up.';
  const minutes = plan.estimatedMinutes;
  const time = minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
  return `${plan.total} to review · ${time}`;
}

/**
 * The count of items that are overdue (as opposed to merely due). Used for
 * the "overdue" badge, which is the thing a student should feel behind about.
 */
export function countOverdue(plan: ReviewPlan): number {
  return plan.items.filter(i => i.reason === 'overdue').length;
}

/**
 * The next `days` days of scheduled work, oldest first — the forecast.
 *
 * This is the "how much is coming" view. Each entry is the number of items
 * whose scheduled date falls on that day. Items already overdue are counted
 * on today's row, because that is when they need doing.
 *
 * Days with no scheduled work are included as zero rows, so the chart always
 * has the same shape.
 */
export interface ForecastDay {
  /** YYYY-MM-DD, local time. */
  date: string;
  /** Short label for the chart, e.g. "Mon". */
  label: string;
  /** Total items scheduled for that day. */
  total: number;
  /** Breakdown by kind. */
  cards: number;
  questions: number;
  notes: number;
}

export function buildForecast(
  flashcards: Flashcard[],
  questions: PracticeQuestion[],
  notes: Note[],
  now: Date = new Date(),
  days = 14,
): ForecastDay[] {
  const buckets = new Map<string, ForecastDay>();
  const todayKey = dayKey(now);

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    buckets.set(dayKey(d), {
      date: dayKey(d),
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      total: 0,
      cards: 0,
      questions: 0,
      notes: 0,
    });
  }

  const add = (due: Date | undefined, kind: PlanKind) => {
    if (!due) return;
    // Overdue work is counted on today — that is when it needs doing.
    const key = due.getTime() <= now.getTime() ? todayKey : dayKey(due);
    const bucket = buckets.get(key);
    if (!bucket) return; // scheduled beyond the forecast window
    bucket.total++;
    if (kind === 'card') bucket.cards++;
    else if (kind === 'question') bucket.questions++;
    else bucket.notes++;
  };

  for (const c of flashcards) add(c.nextReview ? new Date(c.nextReview) : undefined, 'card');
  for (const q of questions) add(q.nextReview ? new Date(q.nextReview) : undefined, 'question');
  for (const n of notes) {
    // A note can be scheduled by the student or by the SM-2 scheduler. Both
    // are counted, so the forecast shows the real workload.
    add(n.nextReminder ? new Date(n.nextReminder) : undefined, 'note');
    add(n.nextReview ? new Date(n.nextReview) : undefined, 'note');
  }

  return Array.from(buckets.values());
}

/**
 * The busiest day in a forecast. Returns null when there is no work at all.
 * The dashboard uses this to warn a student before a pile-up lands.
 */
export function peakDay(forecast: ForecastDay[]): ForecastDay | null {
  let peak: ForecastDay | null = null;
  for (const day of forecast) {
    if (!peak || day.total > peak.total) peak = day;
  }
  return peak && peak.total > 0 ? peak : null;
}
