/**
 * grades — the maths behind the grade tracker.
 *
 * A grade is not an average of averages. A 90% on a 1% quiz and a 60% on a
 * 99% final mean something very different, so every number here is computed
 * from *weighted points* rather than from averaged percentages.
 *
 * The three questions a student actually has:
 *
 *   - "Where am I now?"                  → `summarise(...).currentGrade`
 *   - "What do I need on the rest?"      → `requiredAverage(target, summary)`
 *   - "Where do I land if I score X?"    → `projectGrade(assignments, x)`
 *
 * Everything here is pure: no React, no network, no dates beyond parsing.
 */

/** One piece of graded work. */
export interface GradeAssignment {
  id: string;
  title: string;
  /** The course this belongs to. Grades are computed per course. */
  course: string;
  /** Homework, Quiz, Exam, Project… Used for grouping, not for maths. */
  category: string;
  /** How many percentage points of the final grade this is worth. */
  weight: number;
  /** The mark received. `null` means it has not been marked yet. */
  score: number | null;
  /** The mark it is out of. */
  maxScore: number;
  dueDate?: string | Date | null;
  notes?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/** One band of a letter-grade scale. */
export interface LetterBand {
  letter: string;
  /** The lowest percentage that earns this band. */
  min: number;
}

/**
 * The default scale. Institutions differ, so this is a starting point the
 * student can change in the view — but an app that refuses to call a 91% an
 * A- because it is unsure is useless, so a sensible default ships.
 */
export const DEFAULT_LETTER_SCALE: LetterBand[] = [
  { letter: 'A',  min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B',  min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C',  min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D',  min: 63 },
  { letter: 'D-', min: 60 },
  { letter: 'F',  min: 0 },
];

/** The letter for a percentage, using the given scale. */
export function letterGrade(pct: number, scale: LetterBand[] = DEFAULT_LETTER_SCALE): string {
  if (!Number.isFinite(pct)) return '—';
  for (const band of scale) {
    if (pct >= band.min) return band.letter;
  }
  return scale[scale.length - 1]?.letter ?? '—';
}

/** The percentage a mark represents, or null when it cannot be read. */
export function percentageOf(a: GradeAssignment): number | null {
  if (a.score === null || a.score === undefined) return null;
  if (!a.maxScore || a.maxScore <= 0) return null;
  if (!Number.isFinite(a.score) || !Number.isFinite(a.maxScore)) return null;
  return (a.score / a.maxScore) * 100;
}

/** The weighted points an assignment has contributed so far. */
export function earnedWeightedPoints(a: GradeAssignment): number {
  const pct = percentageOf(a);
  if (pct === null) return 0;
  return (pct / 100) * a.weight;
}

/** What the assignment would contribute at full marks. */
export function possibleWeightedPoints(a: GradeAssignment): number {
  return a.weight;
}

/** The summary of a set of assignments. */
export interface GradeSummary {
  /** Weighted average over the work that has been marked, or null. */
  currentGrade: number | null;
  /** Letter for the current grade. */
  letter: string;
  /** Total weight of every assignment. Normally 100. */
  totalWeight: number;
  /** How much of that weight has been marked. */
  gradedWeight: number;
  /** How much is still unmarked. */
  remainingWeight: number;
  /** Weighted points banked so far (out of `gradedWeight` × 100). */
  earnedPoints: number;
  /** Weighted points still on the table. */
  remainingPoints: number;
  /** How many assignments are marked / how many exist. */
  gradedCount: number;
  count: number;
}

/**
 * Summarise a set of assignments.
 *
 * `currentGrade` is the weighted average over the *marked* work only, with
 * the marked weights re-normalised — so a student who has only been marked on
 * a small quiz sees how they are doing on that quiz, not a number dragged
 * down by everything not yet marked.
 */
export function summarise(assignments: GradeAssignment[]): GradeSummary {
  let totalWeight = 0;
  let gradedWeight = 0;
  let earnedPoints = 0;
  let gradedCount = 0;

  for (const a of assignments) {
    const weight = Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 0;
    totalWeight += weight;
    const pct = percentageOf(a);
    if (pct === null) continue;
    gradedCount++;
    gradedWeight += weight;
    earnedPoints += (pct / 100) * weight;
  }

  const currentGrade = gradedWeight > 0 ? (earnedPoints / gradedWeight) * 100 : null;

  return {
    currentGrade,
    letter: currentGrade === null ? '—' : letterGrade(currentGrade),
    totalWeight,
    gradedWeight,
    remainingWeight: Math.max(0, totalWeight - gradedWeight),
    earnedPoints,
    remainingPoints: Math.max(0, totalWeight - gradedWeight),
    gradedCount,
    count: assignments.length,
  };
}

/**
 * Where the student lands if the rest of the course scores `assumedPct`.
 *
 * This is the honest number: it counts the unmade-up weight, so a student
 * who has aced everything so far but has a huge final still sees the final
 * in the maths.
 */
export function projectGrade(assignments: GradeAssignment[], assumedPct: number): number | null {
  const s = summarise(assignments);
  if (s.totalWeight <= 0) return null;
  const assumed = Number.isFinite(assumedPct) ? assumedPct : 0;
  const total = s.earnedPoints + (s.remainingWeight / 100) * assumed;
  return (total / s.totalWeight) * 100;
}

/** What the student must score on the remaining work to hit a target. */
export interface RequiredAverage {
  /** The average percentage needed across the remaining weight, or null. */
  needed: number | null;
  /** Whether the target is still reachable. */
  possible: boolean;
  /** Whether the target is already met. */
  alreadyAchieved: boolean;
  /** A sentence explaining the number. */
  reason: string;
}

/**
 * What average is needed on the remaining work to finish at `targetPct`.
 *
 * When the target is already met the answer is "nothing — you have it".
 * When it is out of reach the answer says so rather than asking for 143%.
 */
export function requiredAverage(
  targetPct: number,
  assignments: GradeAssignment[],
): RequiredAverage {
  const s = summarise(assignments);

  if (!Number.isFinite(targetPct) || s.totalWeight <= 0) {
    return { needed: null, possible: false, alreadyAchieved: false, reason: 'No graded work yet.' };
  }

  const target = targetPct / 100;

  if (s.remainingWeight <= 0) {
    const achieved = s.currentGrade ?? 0;
    return {
      needed: null,
      possible: achieved >= targetPct,
      alreadyAchieved: achieved >= targetPct,
      reason: achieved >= targetPct
        ? `You are already at ${achieved.toFixed(1)}% — every mark is in.`
        : `Everything is marked and you finished at ${achieved.toFixed(1)}%.`,
    };
  }

  // Weighted points still needed, divided by the weight still to come.
  const pointsNeeded = target * s.totalWeight - s.earnedPoints;
  const needed = (pointsNeeded / s.remainingWeight) * 100;

  if (pointsNeeded <= 0) {
    return {
      needed: 0,
      possible: true,
      alreadyAchieved: true,
      reason: `You have already banked ${s.earnedPoints.toFixed(1)} of ${s.totalWeight.toFixed(0)} points — the target is met whatever happens next.`,
    };
  }

  if (needed > 100) {
    return {
      needed,
      possible: false,
      alreadyAchieved: false,
      reason: `You need ${needed.toFixed(1)}% on the rest, which is more than the maximum. The target is out of reach.`,
    };
  }

  return {
    needed,
    possible: true,
    alreadyAchieved: false,
    reason: `You need ${needed.toFixed(1)}% across the remaining ${s.remainingWeight.toFixed(0)}% of the course.`,
  };
}

/** Group assignments by course, keeping the course order stable. */
export function groupByCourse(assignments: GradeAssignment[]): { course: string; items: GradeAssignment[] }[] {
  const map = new Map<string, GradeAssignment[]>();
  for (const a of assignments) {
    const key = (a.course || 'General').trim() || 'General';
    const list = map.get(key);
    if (list) list.push(a);
    else map.set(key, [a]);
  }
  return Array.from(map.entries()).map(([course, items]) => ({ course, items }));
}

/** The courses present, in the order they first appear. */
export function courseList(assignments: GradeAssignment[]): string[] {
  return groupByCourse(assignments).map(g => g.course);
}

/**
 * The order assignments should be shown in: unmarked first when they are due
 * soonest, marked ones newest first.
 */
export function sortAssignments(assignments: GradeAssignment[]): GradeAssignment[] {
  const now = Date.now();
  return [...assignments].sort((a, b) => {
    const aGraded = percentageOf(a) !== null;
    const bGraded = percentageOf(b) !== null;
    if (aGraded !== bGraded) return aGraded ? 1 : -1;   // unmarked first
    if (!aGraded) {
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.title.localeCompare(b.title);
    }
    const aAt = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bAt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (aAt !== bAt) return bAt - aAt;
    return now - now;
  });
}

/** How many days until a due date. Negative when it has passed. */
export function daysUntil(dueDate?: string | Date | null): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
