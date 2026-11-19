/**
 * FocusForest — one tree per finished focus session.
 *
 * A timer that only shows a number is easy to ignore. A garden that grows is
 * not: missing a day leaves a gap you can see. The trees come from the
 * progression store, so the forest follows the student across devices.
 */
import { useProgression } from '../game/ProgressionContext';

export interface FocusForestProps {
  /** Trees to draw (defaults to the number of completed sessions). */
  count?: number;
  /** How many trees to actually render — the rest are shown as a count. */
  max?: number;
}

/** A small tree. Different shapes so the row does not look like a barcode. */
function Tree({ index, size = 26 }: { index: number; size?: number }) {
  const variant = index % 3;
  const trunk = 'var(--text-3)';
  const leaf = 'var(--success, #34d399)';

  if (variant === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="11" y="14" width="2" height="8" rx="1" fill={trunk} />
        <circle cx="12" cy="10" r="7" fill={leaf} />
      </svg>
    );
  }
  if (variant === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="11" y="12" width="2" height="10" rx="1" fill={trunk} />
        <path d="M12 3 L18 13 H6 Z" fill={leaf} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="11" y="15" width="2" height="7" rx="1" fill={trunk} />
      <path d="M12 4 C16 8 17 12 12 17 C7 12 8 8 12 4 Z" fill={leaf} />
    </svg>
  );
}

export default function FocusForest({ count, max = 24 }: FocusForestProps) {
  const { focusTrees } = useProgression();
  const total = count ?? focusTrees;

  if (total <= 0) {
    return (
      <div className="sw-panel">
        <div className="sw-panel-head">
          <h3 className="sw-panel-title">🌳 Focus forest</h3>
        </div>
        <p className="sw-panel-sub">
          Finish a focus session and a tree appears here. Keep the forest growing.
        </p>
      </div>
    );
  }

  const shown = Math.min(total, max);

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🌳 Focus forest</h3>
          <p className="sw-panel-sub">
            {total} focus session{total === 1 ? '' : 's'} completed
            {total > shown && ` · showing the last ${shown}`}
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '0.25rem',
          padding: '0.75rem 0.25rem 0.25rem',
          background: 'linear-gradient(180deg, transparent 60%, rgba(52,211,153,.08))',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} style={{ display: 'inline-flex', animation: 'none' }}>
            <Tree index={i} />
          </span>
        ))}
      </div>
    </div>
  );
}
