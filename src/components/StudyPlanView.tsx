/**
 * StudyPlanView — the "what should I do now?" screen.
 *
 * Everything in the app that can be reviewed used to live behind its own
 * screen: flashcards in one place, practice questions in another, notes in a
 * third. A student opening the app had to decide for themselves what to
 * study, which is exactly the decision the app should be making for them.
 *
 * This view answers that question once:
 *
 *   1. **The plan** — every card, question and note that is due, ordered by
 *      what actually needs attention first (tough cards and wrong answers
 *      before merely overdue work before new material). One list, one order.
 *   2. **The forecast** — the next fortnight of scheduled work, so a pile-up
 *      can be seen before it lands rather than after.
 *   3. **The mistakes book** — everything the student has got wrong, in one
 *      place, from both cards and questions.
 *
 * All three are computed by pure modules in `src/utils/`, so the ordering
 * rules are testable without a browser.
 */
import { useMemo, useState } from 'react';
import type { Flashcard, Note, PracticeQuestion } from '../types';
import {
  buildReviewPlan,
  buildForecast,
  peakDay,
  countOverdue,
  planSummary,
  reasonLabel,
  type PlanItem,
  type PlanKind,
} from '../utils/reviewPlan';
import { buildMistakes, groupMistakesByTopic, mistakesSummary } from '../utils/errorNotebook';
import { IconArrowRight, IconCards, IconNotes, IconTarget } from './icons';

interface Props {
  flashcards: Flashcard[];
  practiceQuestions: PracticeQuestion[];
  notes: Note[];
  /** Navigate to another view (flashcards, notes…). */
  setCurrentView: (view: string) => void;
  /** Called when the student starts a review from the plan. */
  onStartReview?: (item: PlanItem) => void;
}

type Tab = 'plan' | 'forecast' | 'mistakes';

const KIND_ICON: Record<PlanKind, string> = {
  card: '🃏',
  question: '❓',
  note: '📝',
};

/** The colour chip for a reason, so urgency reads at a glance. */
const REASON_CLASS: Record<string, string> = {
  leech:   'danger',
  wrong:   'danger',
  overdue: 'warning',
  due:     'accent',
  new:     'info',
};

export default function StudyPlanView({
  flashcards,
  practiceQuestions,
  notes,
  setCurrentView,
  onStartReview,
}: Props) {
  const [tab, setTab] = useState<Tab>('plan');

  const plan = useMemo(
    () => buildReviewPlan(flashcards, practiceQuestions, notes, new Date()),
    [flashcards, practiceQuestions, notes],
  );

  const forecast = useMemo(
    () => buildForecast(flashcards, practiceQuestions, notes, new Date(), 14),
    [flashcards, practiceQuestions, notes],
  );

  const peak = useMemo(() => peakDay(forecast), [forecast]);

  const mistakes = useMemo(
    () => buildMistakes(flashcards, practiceQuestions),
    [flashcards, practiceQuestions],
  );

  const mistakeGroups = useMemo(() => groupMistakesByTopic(mistakes), [mistakes]);

  const overdue = countOverdue(plan);
  const hasAnything = flashcards.length > 0 || practiceQuestions.length > 0 || notes.length > 0;

  return (
    <div className="sw-stack animate-in">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <span className="sw-label">Study</span>
          <h2>Study plan</h2>
          <p className="text-sm text-muted">{planSummary(plan)}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {plan.items.length > 0 && onStartReview && (
            <button className="btn btn-primary" onClick={() => onStartReview(plan.items[0])}>
              <IconTarget size={15} /> Start reviewing
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setCurrentView('flashcards')}>
            <IconCards size={15} /> All cards
          </button>
        </div>
      </div>

      {!hasAnything && (
        <div className="sw-panel">
          <div className="sw-empty">
            <div className="sw-empty-icon"><IconTarget size={20} /></div>
            <p className="sw-empty-title">Nothing to plan yet</p>
            <p className="sw-empty-sub">
              Add some notes or flashcards and this page will tell you what to review, in what
              order, and how long it will take.
            </p>
            <button className="btn btn-primary" onClick={() => setCurrentView('notes')} style={{ marginTop: 12 }}>
              Open notes
            </button>
          </div>
        </div>
      )}

      {hasAnything && (
        <>
          {/* ── Tabs ───────────────────────────────────────────────────── */}
          <div className="sw-tabs" role="tablist">
            {([
              ['plan',     `Plan${plan.total ? ` (${plan.total})` : ''}`],
              ['forecast', 'Forecast'],
              ['mistakes', `Mistakes${mistakes.length ? ` (${mistakes.length})` : ''}`],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                className={`sw-tab${tab === key ? ' active' : ''}`}
                onClick={() => setTab(key)}
                role="tab"
                aria-selected={tab === key}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── The plan ───────────────────────────────────────────────── */}
          {tab === 'plan' && (
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div>
                  <h3 className="sw-panel-title">What to review</h3>
                  <p className="sw-panel-sub">
                    {plan.counts.card} card{plan.counts.card === 1 ? '' : 's'} ·{' '}
                    {plan.counts.question} question{plan.counts.question === 1 ? '' : 's'} ·{' '}
                    {plan.counts.note} note{plan.counts.note === 1 ? '' : 's'}
                    {overdue > 0 && ` · ${overdue} overdue`}
                  </p>
                </div>
              </div>

              {plan.items.length === 0 ? (
                <div className="sw-empty">
                  <div className="sw-empty-icon">✅</div>
                  <p className="sw-empty-title">You are all caught up</p>
                  <p className="sw-empty-sub">
                    Nothing is due right now. Come back tomorrow — the gap is what builds memory.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {plan.items.map(item => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      className="sw-plan-item"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => onStartReview?.(item)}
                      aria-label={`Review: ${item.title}`}
                    >
                      <span style={{ fontSize: '1rem', flexShrink: 0 }}>{KIND_ICON[item.kind]}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="sw-plan-item-title" style={{ display: 'block' }}>
                          {item.title}
                        </span>
                        <span className="sw-plan-item-sub" style={{ display: 'block' }}>
                          {item.topic}
                          {item.detail && ` · ${item.detail.slice(0, 80)}`}
                        </span>
                      </span>
                      <span className={`sw-chip ${REASON_CLASS[item.reason] ?? ''}`}>
                        {reasonLabel(item.reason)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── The forecast ───────────────────────────────────────────── */}
          {tab === 'forecast' && (
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div>
                  <h3 className="sw-panel-title">Coming up</h3>
                  <p className="sw-panel-sub">
                    {peak
                      ? `Busiest day: ${peak.label} (${peak.total} item${peak.total === 1 ? '' : 's'})`
                      : 'Nothing scheduled in the next two weeks.'}
                  </p>
                </div>
              </div>

              {forecast.some(d => d.total > 0) ? (
                <>
                  {/* The bars. Height is proportional to the busiest day, so
                      a quiet fortnight looks flat and a pile-up looks tall. */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))`,
                      gap: '0.35rem',
                      alignItems: 'end',
                      height: '120px',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {forecast.map(day => {
                      const max = Math.max(1, ...forecast.map(d => d.total));
                      const heightPct = day.total > 0 ? Math.max(8, (day.total / max) * 100) : 3;
                      return (
                        <div
                          key={day.date}
                          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: '0.25rem' }}
                          title={`${day.date}: ${day.total} due`}
                        >
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                            {day.total > 0 ? day.total : ''}
                          </span>
                          <span
                            style={{
                              width: '100%',
                              height: `${heightPct}%`,
                              minHeight: '3px',
                              borderRadius: 'var(--r-full, 999px)',
                              background: day.total > 0 ? 'var(--accent)' : 'var(--surface-3)',
                              transition: 'height .35s ease',
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))`, gap: '0.35rem' }}>
                    {forecast.map(day => (
                      <span key={day.date} style={{ fontSize: '0.62rem', color: 'var(--text-3)', textAlign: 'center' }}>
                        {day.label}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                    <span className="text-xs text-muted">
                      Total scheduled: {forecast.reduce((s, d) => s + d.total, 0)} items
                    </span>
                    <span className="text-xs text-muted">
                      Cards {forecast.reduce((s, d) => s + d.cards, 0)} ·{' '}
                      Questions {forecast.reduce((s, d) => s + d.questions, 0)} ·{' '}
                      Notes {forecast.reduce((s, d) => s + d.notes, 0)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="sw-empty">
                  <div className="sw-empty-icon">📅</div>
                  <p className="sw-empty-title">Nothing scheduled</p>
                  <p className="sw-empty-sub">
                    Once you review a card or a question, its next due date shows up here.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── The mistakes book ──────────────────────────────────────── */}
          {tab === 'mistakes' && (
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div>
                  <h3 className="sw-panel-title">Mistakes book</h3>
                  <p className="sw-panel-sub">{mistakesSummary(mistakes)}</p>
                </div>
              </div>

              {mistakes.length === 0 ? (
                <div className="sw-empty">
                  <div className="sw-empty-icon">🌟</div>
                  <p className="sw-empty-title">No mistakes logged</p>
                  <p className="sw-empty-sub">
                    Anything you get wrong shows up here so you can come back to it.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Array.from(mistakeGroups.entries()).map(([topic, items]) => (
                    <div key={topic}>
                      <p className="sw-label" style={{ marginBottom: '0.4rem' }}>{topic}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {items.map(m => (
                          <div
                            key={`${m.kind}-${m.id}`}
                            style={{
                              display: 'flex',
                              gap: '0.6rem',
                              alignItems: 'flex-start',
                              padding: '0.55rem 0.7rem',
                              borderRadius: 'var(--radius)',
                              border: '1px solid var(--border)',
                              background: 'var(--surface-2)',
                            }}
                          >
                            <span style={{ flexShrink: 0 }}>{KIND_ICON[m.kind]}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>
                                {m.question}
                              </span>
                              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-2)', marginTop: '0.15rem' }}>
                                {m.answer}
                              </span>
                            </span>
                            <span className={`sw-chip ${m.isLeech ? 'danger' : 'warning'}`}>
                              {m.isLeech ? 'Tough' : `${m.wrongCount}× wrong`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
