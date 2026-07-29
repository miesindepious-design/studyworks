/**
 * sm2.ts — SuperMemo 2 algorithm, used for both Flashcard and PracticeQuestion.
 *
 * Earlier versions hard-coded the easiness factor `ef` to 2.5 and never
 * updated it on review, so cards always grew easier by clockwork regardless
 * of actual performance. This is the real SM-2 spec, with ef persisted per
 * item and updated on every review.
 *
 * The same shape applies to anything that has `repetitions`, `interval`,
 * `ef`, and `nextReview` fields. PracticeQuestion reuses this so the
 * "review due" queue can be a single sorted view across both types.
 */

export interface SRSState {
  repetitions?: number;
  interval?:    number;
  ef?:          number;
  nextReview?:  Date;
}

/** Quality scale (SM-2):
 *   0 = Again (complete blackout) — repetitions reset
 *   1 = Hard (recalled with serious difficulty)
 *   2 = Good (recalled with some effort)
 *   3 = Easy (recalled with no effort)
 */
export function sm2(state: SRSState, quality: 0 | 1 | 2 | 3, now = new Date()): Required<SRSState> {
  const reps = state.repetitions ?? 0;
  const iv   = state.interval    ?? 0;
  const ef0  = state.ef          ?? 2.5;
  let newIv: number, newReps: number, newEf: number;

  if (quality === 0) {
    newIv  = 1;
    newReps = 0;
  } else if (quality === 1) {
    newIv  = Math.max(1, Math.round(iv * 1.2));
    newReps = reps + 1;
  } else if (quality === 2) {
    newIv  = reps === 0 ? 1 : reps === 1 ? 4 : Math.round(iv * ef0);
    newReps = reps + 1;
  } else {
    newIv  = reps === 0 ? 4 : reps === 1 ? 7 : Math.round(iv * ef0 * 1.3);
    newReps = reps + 1;
  }

  if (quality > 0) {
    newEf = Math.max(1.3, ef0 + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  } else {
    newEf = reps > 0
      ? Math.max(1.3, ef0 + (0.1 - (5 - 3) * (0.08 + (5 - 3) * 0.02)))
      : ef0;
  }

  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + newIv);
  return { repetitions: newReps, interval: newIv, ef: newEf, nextReview };
}

/** True if the item is due for review now (or never reviewed). */
export function isDue(state: SRSState, now = new Date()): boolean {
  if (!state.nextReview) return true;
  return new Date(state.nextReview).getTime() <= now.getTime();
}

/** Sort helper: most-due first (undefined nextReview → top). */
export function byUrgency<T extends SRSState>(a: T, b: T): number {
  if (!a.nextReview && !b.nextReview) return 0;
  if (!a.nextReview) return -1;
  if (!b.nextReview) return 1;
  return a.nextReview.getTime() - b.nextReview.getTime();
}
