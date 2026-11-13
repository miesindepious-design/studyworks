/**
 * FocusDial — the circular timer face used by the dashboard's focus room.
 *
 * A ring of sixty minute ticks with a progress arc underneath, a soft inner
 * disc and a slot for the readout in the middle. It is purely visual: the
 * timer state lives in the parent, this just renders it.
 */
import type { ReactNode } from 'react';

interface FocusDialProps {
  /** Seconds left on the clock. */
  seconds: number;
  /** Total seconds for the current phase (used for the arc + tick fill). */
  total: number;
  /** Colour of the lit ticks and the arc. Defaults to the app accent. */
  color?: string;
  /** Colour of the unlit ticks. */
  mutedColor?: string;
  size?: number;
  children?: ReactNode;
}

const TICKS = 60;

export default function FocusDial({
  seconds,
  total,
  color = 'var(--sw-accent)',
  mutedColor = 'var(--sw-dial-muted, #788866)',
  size = 288,
  children,
}: FocusDialProps) {
  const radius = size / 2;
  const safeTotal = total > 0 ? total : 1;
  const progress = Math.max(0, Math.min(1, seconds / safeTotal));

  // Ticks sit on a circle just inside the edge; every fifth tick is longer,
  // which gives the ring a readable "minutes" rhythm.
  const tickOuter = radius - 8;
  const tickInnerBase = radius - 18;
  const tickInnerMajor = radius - 25;

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const inner = major ? tickInnerMajor : tickInnerBase;
    const lit = i < Math.round(progress * TICKS);
    const x1 = radius + Math.cos(angle) * inner;
    const y1 = radius + Math.sin(angle) * inner;
    const x2 = radius + Math.cos(angle) * tickOuter;
    const y2 = radius + Math.sin(angle) * tickOuter;
    return { x1, y1, x2, y2, lit, major, key: i };
  });

  // Progress arc: a circle whose dash offset is driven by the time left.
  const arcRadius = radius - 34;
  const circumference = 2 * Math.PI * arcRadius;
  const dash = circumference * progress;

  return (
    <div
      className="sw-dial"
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Inner disc */}
        <circle
          cx={radius}
          cy={radius}
          r={radius - 44}
          fill="var(--sw-dial-face, #2B422D)"
        />
        <circle
          cx={radius}
          cy={radius}
          r={radius - 43}
          fill="none"
          stroke="var(--sw-dial-ring, #516944)"
          strokeWidth={1}
        />

        {/* Progress arc */}
        <circle
          cx={radius}
          cy={radius}
          r={arcRadius}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          opacity={0.55}
          transform={`rotate(-90 ${radius} ${radius})`}
        />

        {/* Minute ticks */}
        {ticks.map(t => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.lit ? color : mutedColor}
            strokeWidth={t.major ? 3 : 2}
            strokeLinecap="round"
            opacity={t.lit ? 1 : 0.85}
          />
        ))}
      </svg>

      <div className="sw-dial-center">{children}</div>
    </div>
  );
}
