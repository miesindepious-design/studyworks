/**
 * FocusDial — the circular timer face used by the dashboard's focus room and
 * the settings page's focus-timer card.
 *
 * A ring of sixty minute ticks with a progress arc underneath, a soft inner
 * disc and a slot for the readout in the middle. It is purely visual: the
 * timer state lives in the parent, this just renders it.
 *
 * Every measurement is derived from the requested size, so the same component
 * renders correctly at 288px on the dashboard and at 132px inside a settings
 * card without a second set of magic numbers.
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

/** The size the geometry constants below were authored against. */
const BASE_SIZE = 288;

export default function FocusDial({
  seconds,
  total,
  color = 'var(--sw-accent)',
  mutedColor = 'var(--sw-dial-muted, #788866)',
  size = BASE_SIZE,
  children,
}: FocusDialProps) {
  const radius = size / 2;
  const safeTotal = total > 0 ? total : 1;
  const progress = Math.max(0, Math.min(1, seconds / safeTotal));

  // One scale factor keeps the ring identical at every size: the gaps
  // between the ticks, the arc and the inner disc all shrink together.
  const k = size / BASE_SIZE;

  // Ticks sit on a circle just inside the edge; every fifth tick is longer,
  // which gives the ring a readable "minutes" rhythm.
  const tickOuter     = radius - 8 * k;
  const tickInnerBase = radius - 18 * k;
  const tickInnerMajor = radius - 25 * k;

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
  const arcRadius = radius - 34 * k;
  const circumference = 2 * Math.PI * arcRadius;
  const dash = circumference * progress;

  // Hairlines disappear entirely at small sizes, so keep a floor.
  const tickWidth = (w: number) => Math.max(1, w * k);
  const arcWidth = Math.max(1.25, 2 * k);

  // The readout scales with the face so the numbers never overflow the disc.
  const readoutSize = 3.25 * k;

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
          r={radius - 44 * k}
          fill="var(--sw-dial-face, #2B422D)"
        />
        <circle
          cx={radius}
          cy={radius}
          r={radius - 43 * k}
          fill="none"
          stroke="var(--sw-dial-ring, #516944)"
          strokeWidth={Math.max(1, k)}
        />

        {/* Progress arc */}
        <circle
          cx={radius}
          cy={radius}
          r={arcRadius}
          fill="none"
          stroke={color}
          strokeWidth={arcWidth}
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
            strokeWidth={tickWidth(t.major ? 3 : 2)}
            strokeLinecap="round"
            opacity={t.lit ? 1 : 0.85}
          />
        ))}
      </svg>

      <div
        className="sw-dial-center"
        style={{
          gap: Math.max(1, 4 * k),
          fontSize: `${readoutSize}rem`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
