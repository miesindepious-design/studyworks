/**
 * Ring — a circular progress indicator.
 *
 * Used for the weekly goal in the dashboard hero, the study timer, and the
 * day-streak badge. Sized in pixels; the value sits in the middle.
 */

interface RingProps {
  /** Current value, 0–100. */
  value: number;
  /** Diameter in pixels. */
  size?: number;
  /** Stroke width in pixels. */
  thickness?: number;
  /** Fill colour (defaults to the accent). */
  color?: string;
  /** Big number in the centre. */
  label?: string;
  /** Small caption under the number. */
  caption?: string;
  /** Rendered instead of the label (e.g. a flame icon). */
  children?: React.ReactNode;
  className?: string;
}

export default function Ring({
  value, size = 108, thickness = 8, color,
  label, caption, children, className,
}: RingProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={`sw-ring${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="sw-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
        />
        <circle
          className="sw-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="sw-ring-center">
        {children ?? (
          <div>
            <div className="sw-ring-value" style={{ fontSize: size * 0.26 }}>{label}</div>
            {caption && <div className="sw-ring-caption">{caption}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
