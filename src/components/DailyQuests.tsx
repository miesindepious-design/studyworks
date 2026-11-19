/**
 * DailyQuests — the three things worth doing today.
 *
 * A quest is a small, concrete target (review 15 cards, focus 25 minutes,
 * win a battle). Three a day is enough to feel like a to-do list and small
 * enough to actually finish, which is what makes the streak work.
 *
 * The quest definitions live in the shared rules file, so the server and the
 * browser always agree on what today's quests are.
 */
import { useProgression } from '../game/ProgressionContext';

export interface DailyQuestsProps {
  /** Hide the panel heading — used when it is embedded in another panel. */
  bare?: boolean;
  /** Called when the student taps a quest that has somewhere to go. */
  onNavigate?: (view: string) => void;
}

/** Where a quest takes you when tapped. */
const QUEST_TARGET: Record<string, string> = {
  review: 'flashcards',
  focus: 'timer',
  tutor: 'tutor',
  notes: 'notes',
  battle: 'multiplayer',
  practice: 'flashcards',
  summary: 'notes',
  cards: 'flashcards',
  quest: 'dashboard',
};

export default function DailyQuests({ bare = false, onNavigate }: DailyQuestsProps) {
  const { quests } = useProgression();

  if (!quests.length) return null;

  const doneCount = quests.filter(q => q.done).length;
  const allDone = doneCount === quests.length;

  return (
    <div className="sw-panel">
      {!bare && (
        <div className="sw-panel-head">
          <div>
            <h3 className="sw-panel-title">🎯 Today's quests</h3>
            <p className="sw-panel-sub">
              {allDone
                ? 'All done — the day is yours.'
                : `${doneCount} of ${quests.length} done · ${quests.reduce((a, q) => a + q.xp, 0)} XP on the table`}
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {quests.map(quest => {
          const pct = quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0;
          const complete = quest.done;
          return (
            <button
              key={quest.id}
              onClick={() => !complete && onNavigate?.(QUEST_TARGET[quest.type] ?? 'dashboard')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                width: '100%',
                textAlign: 'left',
                padding: '0.75rem 0.875rem',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${complete ? 'var(--border)' : 'var(--border-strong)'}`,
                background: complete ? 'var(--surface-1)' : 'var(--surface-2)',
                cursor: complete ? 'default' : 'pointer',
                opacity: complete ? 0.72 : 1,
                transition: 'border-color .15s ease, transform .15s ease',
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: '1.35rem',
                  width: '2.25rem',
                  height: '2.25rem',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 'var(--r-full)',
                  background: complete ? 'var(--accent)' : 'var(--surface-3)',
                  flexShrink: 0,
                }}
              >
                {complete ? '✓' : quest.icon}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.875rem' }}>{quest.title}</strong>
                  <span className="sw-chip">+{quest.xp} XP</span>
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    color: 'var(--text-2)',
                    marginTop: '0.15rem',
                  }}
                >
                  {quest.description}
                </span>
                {!complete && (
                  <span className="sw-meter" style={{ display: 'block', marginTop: '0.4rem' }}>
                    <span
                      className="sw-meter-fill"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </span>
                )}
              </span>

              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-3)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {complete ? 'Done' : `${quest.progress}/${quest.target}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
