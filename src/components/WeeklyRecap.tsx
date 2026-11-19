/**
 * WeeklyRecap — the last seven days, told as a story.
 *
 * A heatmap shows effort; a recap shows what it turned into. The numbers
 * come from the progression store (XP per day) and the review statistics the
 * app already keeps, so this is a summary of real work rather than a
 * motivational poster.
 */
import { useMemo } from 'react';
import { useProgression } from '../game/ProgressionContext';
import { isoDate } from '../game/rules';

export interface WeeklyRecapProps {
  /** Cards reviewed in the last seven days. */
  cardsReviewed?: number;
  /** Accuracy over the same window, 0-100. */
  accuracy?: number;
  /** Minutes focused in the last seven days. */
  minutes?: number;
  /** Current study streak in days. */
  streak?: number;
}

/** Last seven days, oldest first. */
function lastSevenDays(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(isoDate(new Date(Date.now() - i * 86400000)));
  }
  return days;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function WeeklyRecap({
  cardsReviewed = 0,
  accuracy = 0,
  minutes = 0,
  streak = 0,
}: WeeklyRecapProps) {
  const { dailyXp, xp, level, levelTitle, season } = useProgression();

  const days = useMemo(() => lastSevenDays(), []);
  const values = days.map(d => dailyXp[d] ?? 0);
  const max = Math.max(1, ...values);
  const weekTotal = values.reduce((a, b) => a + b, 0);

  const best = days.reduce(
    (acc, day, i) => (values[i] > acc.value ? { day, value: values[i] } : acc),
    { day: '', value: 0 },
  );

  const summary = useMemo(() => {
    const lines = [
      `My StudyWorks week (${days[0]} → ${days[6]})`,
      `⚡ ${weekTotal} XP · level ${level} ${levelTitle}`,
      `🃏 ${cardsReviewed} cards reviewed${accuracy ? ` at ${accuracy}% accuracy` : ''}`,
    ];
    if (minutes) lines.push(`⏳ ${minutes} minutes focused`);
    if (streak) lines.push(`🔥 ${streak}-day streak`);
    if (best.value > 0) lines.push(`🏆 Best day: ${best.day} (${best.value} XP)`);
    if (season) lines.push(`${season.icon} ${season.name} — ×${season.xpMultiplier} XP`);
    return lines.join('\n');
  }, [days, weekTotal, level, levelTitle, cardsReviewed, accuracy, minutes, streak, best, season]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      /* clipboard blocked — the summary is still on screen */
    }
  };

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">📊 Your week</h3>
          <p className="sw-panel-sub">
            {weekTotal > 0 ? `${weekTotal} XP earned in the last seven days` : 'No XP yet this week'}
          </p>
        </div>
        <div className="sw-panel-actions">
          <button className="btn btn-ghost btn-sm" onClick={copySummary} title="Copy a summary of your week">
            Copy
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '0.4rem',
          alignItems: 'end',
          height: '110px',
          marginBottom: '0.75rem',
        }}
      >
        {values.map((value, i) => {
          const heightPct = value > 0 ? Math.max(8, (value / max) * 100) : 3;
          const isToday = i === values.length - 1;
          return (
            <div key={days[i]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', height: '100%', justifyContent: 'flex-end' }}>
              <span
                style={{
                  width: '100%',
                  height: `${heightPct}%`,
                  minHeight: '4px',
                  borderRadius: 'var(--r-full)',
                  background:
                    value > 0
                      ? isToday
                        ? 'var(--accent)'
                        : 'var(--accent-soft, var(--surface-3))'
                      : 'var(--surface-3)',
                  transition: 'height .4s ease',
                }}
                title={`${days[i]}: ${value} XP`}
              />
              <span style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>{DAY_LABELS[i]}</span>
            </div>
          );
        })}
      </div>

      <div className="sw-stat-grid">
        <div className="sw-stat-tile">
          <div className="sw-stat-tile-value">{weekTotal}</div>
          <div className="sw-stat-tile-label">XP this week</div>
        </div>
        <div className="sw-stat-tile">
          <div className="sw-stat-tile-value">{cardsReviewed}</div>
          <div className="sw-stat-tile-label">Cards reviewed</div>
        </div>
        <div className="sw-stat-tile">
          <div className="sw-stat-tile-value">{accuracy ? `${accuracy}%` : '—'}</div>
          <div className="sw-stat-tile-label">Accuracy</div>
        </div>
        <div className="sw-stat-tile">
          <div className="sw-stat-tile-value">{streak}</div>
          <div className="sw-stat-tile-label">Day streak</div>
        </div>
      </div>

      {season && (
        <p
          style={{
            marginTop: '0.75rem',
            fontSize: '0.78rem',
            color: 'var(--text-2)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>{season.icon}</span>
          <span>
            <strong style={{ color: 'var(--text)' }}>{season.name}</strong> — {season.description}
          </span>
        </p>
      )}

      <p style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-3)' }}>
        {xp} XP in total · level {level} {levelTitle}
      </p>
    </div>
  );
}
