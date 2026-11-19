/**
 * MasteryMap — what do you actually know?
 *
 * Every card and practice question carries a topic. This groups them and
 * shows how well each topic is known, using the spaced-repetition state that
 * is already on the cards: a card is mastered once it has been repeated a
 * few times *and* its ease factor says the student finds it easy.
 *
 * The bars are ordered from "needs work" to "solid", so the first thing on
 * the list is always the best thing to study next.
 */
import { useMemo } from 'react';
import type { Flashcard, PracticeQuestion } from '../types';
import { computeMastery, weakestTopics } from '../utils/mastery';

export interface MasteryMapProps {
  flashcards: Flashcard[];
  practiceQuestions?: PracticeQuestion[];
  /** Called with a topic when the student clicks one. */
  onPickTopic?: (topic: string) => void;
  /** How many topics to show. */
  limit?: number;
}

function barColour(pct: number): string {
  if (pct >= 75) return 'var(--success, #34d399)';
  if (pct >= 45) return 'var(--accent)';
  if (pct >= 20) return 'var(--warning, #fbbf24)';
  return 'var(--danger, #f87171)';
}

export default function MasteryMap({
  flashcards,
  practiceQuestions = [],
  onPickTopic,
  limit = 8,
}: MasteryMapProps) {
  const mastery = useMemo(
    () => computeMastery(flashcards, practiceQuestions),
    [flashcards, practiceQuestions],
  );

  const topics = mastery.slice(0, limit);
  const weakest = useMemo(() => weakestTopics(mastery, 3), [mastery]);

  const totals = useMemo(() => {
    const total = mastery.reduce((a, m) => a + m.total, 0);
    const mastered = mastery.reduce((a, m) => a + m.mastered, 0);
    const due = mastery.reduce((a, m) => a + m.due, 0);
    return { total, mastered, due };
  }, [mastery]);

  if (!mastery.length) {
    return (
      <div className="sw-panel">
        <div className="sw-panel-head">
          <h3 className="sw-panel-title">🗺️ Mastery map</h3>
        </div>
        <div className="sw-empty">
          <div className="sw-empty-icon">🗺️</div>
          <p className="sw-empty-title">No map yet</p>
          <p className="sw-empty-sub">
            Tag your flashcards with a topic — Biology, Quadratics, whatever you call it — and this
            becomes a map of what you know.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🗺️ Mastery map</h3>
          <p className="sw-panel-sub">
            {totals.mastered} of {totals.total} cards mastered
            {totals.due > 0 && ` · ${totals.due} due`}
          </p>
        </div>
      </div>

      {weakest.length > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', margin: '0 0 0.75rem' }}>
          Focus next:{' '}
          {weakest.map((t, i) => (
            <span key={t.topic}>
              {i > 0 && ', '}
              <strong style={{ color: 'var(--text)' }}>{t.topic}</strong>
            </span>
          ))}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        {topics.map(topic => {
          const pct = topic.masteryPct;
          return (
            <button
              key={topic.topic}
              onClick={() => onPickTopic?.(topic.topic)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: onPickTopic ? 'pointer' : 'default',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{topic.topic}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                  {topic.mastered} mastered · {topic.learning} learning · {topic.new} new
                  {topic.accuracyPct > 0 && ` · ${topic.accuracyPct}% correct`}
                  {topic.leeches > 0 && ` · ${topic.leeches} tough`}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: barColour(pct),
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {pct}%
                </span>
              </span>
              <span
                style={{
                  display: 'block',
                  height: '8px',
                  borderRadius: 'var(--r-full)',
                  background: 'var(--surface-3)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${Math.max(2, pct)}%`,
                    borderRadius: 'var(--r-full)',
                    background: barColour(pct),
                    transition: 'width .4s ease',
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
