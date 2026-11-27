/**
 * GradesCard — where the student stands, and what is still coming.
 *
 * A grade tracker that only lives on its own page is a page nobody opens.
 * The two things a student wants to know on the dashboard are both about
 * time: "am I on track" and "what is due next". So this card answers both
 * in one strip:
 *
 *   - the current weighted grade, as a percentage and a letter;
 *   - the next few deadlines, with how many days are left;
 *   - and, when the target is out of reach, what the remaining work has to
 *     average to get there.
 *
 * Assignments come from the server when the student is signed in, and from
 * localStorage otherwise — the same fallback the Grades page uses, so the
 * two never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAssignments, type GradeAssignmentDTO } from '../api/grades';
import {
  daysUntil,
  requiredAverage,
  sortAssignments,
  summarise,
  type GradeAssignment,
} from '../utils/grades';

const LOCAL_KEY = 'sw-assignments';

/** How many deadlines the card shows. More than this and it stops being a card. */
const MAX_UPCOMING = 4;

export interface GradesCardProps {
  authenticated: boolean;
  /** Where the "open grades" button goes. */
  onOpenGrades?: () => void;
}

function toAssignment(dto: GradeAssignmentDTO): GradeAssignment {
  return {
    id: dto.id,
    title: dto.title,
    course: dto.course,
    category: dto.category,
    weight: dto.weight,
    score: dto.score,
    maxScore: dto.maxScore,
    dueDate: dto.dueDate ?? null,
    notes: dto.notes ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function loadLocal(): GradeAssignmentDTO[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GradeAssignmentDTO[]) : [];
  } catch {
    return [];
  }
}

/** "in 3 days", "today", "2 days ago", "no date". */
function dueLabel(days: number | null): string {
  if (days === null) return 'No date';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 0) return `Due in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export default function GradesCard({ authenticated, onOpenGrades }: GradesCardProps) {
  const [assignments, setAssignments] = useState<GradeAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (authenticated) {
      try {
        const remote = await listAssignments();
        setAssignments(remote.map(toAssignment));
        setLoading(false);
        return;
      } catch {
        /* fall through to the local copy */
      }
    }
    setAssignments(loadLocal().map(toAssignment));
    setLoading(false);
  }, [authenticated]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const summary = useMemo(() => summarise(assignments), [assignments]);

  /** The deadlines that are still ahead, soonest first. */
  const upcoming = useMemo(() => {
    return sortAssignments(assignments)
      .filter(a => {
        const days = daysUntil(a.dueDate);
        return days !== null && days >= 0;
      })
      .slice(0, MAX_UPCOMING);
  }, [assignments]);

  /**
   * What the remaining work has to average to reach an A. Only worth saying
   * when there is something left to do — and when it is out of reach, the
   * card says that instead of pretending.
   */
  const needed = useMemo(() => {
    const result = requiredAverage(90, assignments);
    if (result.alreadyAchieved) return null;
    return result;
  }, [assignments]);

  if (loading) return null;

  // Nothing to say: no assignments at all.
  if (assignments.length === 0) {
    return (
      <section className="card sw-grade-card">
        <div className="card-header">
          <span className="card-title">📊 Grades</span>
        </div>
        <p className="card-note">
          Track your assignments and the app will work out where you stand and what is left.
        </p>
        {onOpenGrades && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenGrades}>
            Add your first assignment
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="card sw-grade-card">
      <div className="card-header">
        <span className="card-title">📊 Grades</span>
        {onOpenGrades && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={onOpenGrades}>
            Open →
          </button>
        )}
      </div>

      <div className="sw-grade-summary">
        <div className="sw-grade-figure">
          <span className="sw-grade-pct">
            {summary.currentGrade === null ? '—' : `${summary.currentGrade.toFixed(1)}%`}
          </span>
          <span className="sw-grade-letter">{summary.letter}</span>
        </div>
        <div className="sw-grade-detail">
          <div>
            <strong>{summary.gradedCount}</strong> of {summary.count} assignments marked
          </div>
          {needed && needed.possible && needed.needed !== null && (
            <div className="sw-grade-needed">
              To reach 90% you need {needed.needed.toFixed(1)}% on what is left
            </div>
          )}
          {needed && !needed.possible && (
            <div className="sw-grade-needed is-warn">An A is out of reach now</div>
          )}
          {!needed && (
            <div className="sw-grade-needed is-good">On track for an A</div>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <>
          <div className="sw-grade-upcoming-head">Coming up</div>
          <ul className="sw-grade-upcoming">
            {upcoming.map(a => {
              const days = daysUntil(a.dueDate);
              return (
                <li key={a.id} className={`sw-grade-due${days !== null && days <= 2 ? ' is-soon' : ''}`}>
                  <span className="sw-grade-due-title">{a.title}</span>
                  <span className="sw-grade-due-course">{a.course}</span>
                  <span className="sw-grade-due-when">{dueLabel(days)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
