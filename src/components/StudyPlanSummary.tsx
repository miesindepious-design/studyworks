/**
 * StudyPlanSummary — the plan, in one panel on the dashboard.
 *
 * The full Study Plan page has the whole ordered list, the fortnight
 * forecast and the mistakes book. This is the condensed version that lives
 * on the dashboard: how much is due, what is most urgent, and one button to
 * get on with it.
 *
 * It reads from the same pure module as the full page, so the dashboard can
 * never disagree with the plan about what is due.
 */
import { useMemo } from 'react';
import type { Flashcard, Note, PracticeQuestion } from '../types';
import {
  buildReviewPlan,
  countOverdue,
  reasonLabel,
  type PlanItem,
} from '../utils/reviewPlan';
import { IconArrowRight, IconTarget } from './icons';

interface Props {
  flashcards: Flashcard[];
  practiceQuestions: PracticeQuestion[];
  notes: Note[];
  /** How many of the most urgent items to show. */
  limit?: number;
  /** Open the full Study Plan page. */
  onOpenPlan: () => void;
  /** Start reviewing a specific item. */
  onStartReview?: (item: PlanItem) => void;
}

const REASON_CLASS: Record<string, string> = {
  leech:   'danger',
  wrong:   'danger',
  overdue: 'warning',
  due:     'accent',
  new:     'info',
};

export default function StudyPlanSummary({
  flashcards,
  practiceQuestions,
  notes,
  limit = 4,
  onOpenPlan,
  onStartReview,
}: Props) {
  const plan = useMemo(
    () => buildReviewPlan(flashcards, practiceQuestions, notes, new Date()),
    [flashcards, practiceQuestions, notes],
  );

  const overdue = countOverdue(plan);
  const top = plan.items.slice(0, limit);

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🎯 Today&rsquo;s plan</h3>
          <p className="sw-panel-sub">
            {plan.total === 0
              ? 'Nothing due — you are all caught up.'
              : `${plan.total} to review${overdue > 0 ? ` · ${overdue} overdue` : ''}`}
          </p>
        </div>
        <div className="sw-panel-actions">
          <button className="sw-btn ghost sm" onClick={onOpenPlan}>
            Open plan <IconArrowRight size={13} />
          </button>
        </div>
      </div>

      {plan.total === 0 ? (
        <div className="sw-empty">
          <div className="sw-empty-icon"><IconTarget size={20} /></div>
          <p className="sw-empty-title">All caught up</p>
          <p className="sw-empty-sub">
            Nothing is due right now. Come back tomorrow — the gap is what builds memory.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
            {top.map(item => (
              <button
                key={`${item.kind}-${item.id}`}
                className="sw-plan-item"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => onStartReview?.(item)}
                aria-label={`Review: ${item.title}`}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="sw-plan-item-title" style={{ display: 'block' }}>
                    {item.title}
                  </span>
                  <span className="sw-plan-item-sub" style={{ display: 'block' }}>
                    {item.topic}
                  </span>
                </span>
                <span className={`sw-chip ${REASON_CLASS[item.reason] ?? ''}`}>
                  {reasonLabel(item.reason)}
                </span>
              </button>
            ))}
          </div>

          {plan.total > top.length && (
            <button className="sw-btn secondary sm" onClick={onOpenPlan} style={{ width: '100%' }}>
              {plan.total - top.length} more <IconArrowRight size={13} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
