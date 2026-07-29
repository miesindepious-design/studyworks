/**
 * StreakRing — animated circular progress ring for the daily streak.
 *
 * Shows the current streak number in the centre, a glowing arc that fills
 * proportional to `progress` (0..1), and a flame icon. The arc animates
 * from 0 → progress on mount.
 */
import { useEffect, useState } from 'react';

interface Props {
  value: number;          // current streak
  progress: number;       // 0..1 fill of the ring
  emoji: string;          // tier flame
  color: string;          // arc color
}

const SIZE = 84;
const STROKE = 7;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export default function StreakRing({ value, progress, emoji, color }: Props) {
  const [p, setP] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setP(progress); return; }
    const id = requestAnimationFrame(() => setP(progress));
    return () => cancelAnimationFrame(id);
  }, [progress]);

  const offset = CIRC * (1 - Math.min(1, Math.max(0, p)));

  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
      <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="var(--surface-3)" strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke={color} strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)', filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>{emoji}</span>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {value}
        </span>
      </div>
    </div>
  );
}
