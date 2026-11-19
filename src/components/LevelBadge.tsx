/**
 * LevelBadge — the student's progress, always in sight.
 *
 * A small pill in the top bar: the level, the title that goes with it and a
 * thin bar showing how far the next level is. It is the anchor for the whole
 * progression system — the student should always be able to see that the
 * work they are doing is going somewhere.
 */
import { useProgression } from '../game/ProgressionContext';

export interface LevelBadgeProps {
  /** Show the title next to the level. */
  showTitle?: boolean;
}

export default function LevelBadge({ showTitle = true }: LevelBadgeProps) {
  const { level, levelTitle, progressPct, xp, xpIntoLevel, xpForNextLevel, season } = useProgression();

  return (
    <div
      title={`${xp} XP · level ${level} ${levelTitle} — ${xpIntoLevel}/${xpForNextLevel} to level ${level + 1}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.3rem 0.6rem',
        borderRadius: 'var(--r-full)',
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
        minWidth: '7.5rem',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: '1.6rem',
          height: '1.6rem',
          borderRadius: 'var(--r-full)',
          background: 'var(--accent)',
          color: 'var(--surface-0, #fff)',
          fontSize: '0.72rem',
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {level}
      </span>

      {showTitle && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 650, lineHeight: 1 }}>
            {levelTitle}
            {season && <span title={season.name}> {season.icon}</span>}
          </span>
          <span
            style={{
              display: 'block',
              height: '3px',
              borderRadius: 'var(--r-full)',
              background: 'var(--surface-3)',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${Math.max(3, progressPct * 100)}%`,
                background: 'var(--accent)',
                transition: 'width .4s ease',
              }}
            />
          </span>
        </span>
      )}
    </div>
  );
}
