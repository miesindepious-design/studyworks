/**
 * KeyPointsPanel — the "important points" panel.
 *
 * The same panel renders in two places:
 *   - inside a tutor reply, so a plain topic search also shows what the
 *     student must remember;
 *   - inside the document briefing, so an uploaded file is distilled into
 *     the points that actually matter.
 *
 * Points are grouped by importance ("must know" / "should know" /
 * "good to know") because that ordering is what makes a revision list
 * usable under exam pressure.
 */

import type { KeyPoint, KeyPointImportance } from '../api/ai';

interface Props {
  points: KeyPoint[];
  /** Panel heading. */
  title?: string;
  /** Smaller type + tighter spacing — used inside chat turns. */
  compact?: boolean;
  /** Shown instead of the panel when there is nothing to show. */
  emptyHint?: string;
}

const GROUPS: { id: KeyPointImportance; label: string; hint: string }[] = [
  { id: 'must-know',    label: 'Must know',    hint: 'Exam-critical — learn these first' },
  { id: 'should-know',  label: 'Should know',  hint: 'Supporting detail that earns marks' },
  { id: 'good-to-know', label: 'Good to know', hint: 'Useful context, lower priority' },
];

export default function KeyPointsPanel({ points, title = 'Key points to remember', compact = false, emptyHint }: Props) {
  const valid = points.filter(p => p && p.point && p.point.trim().length > 0);
  if (valid.length === 0) {
    if (!emptyHint) return null;
    return <p className="text-sm text-muted sw-kp-empty">{emptyHint}</p>;
  }

  return (
    <div className={`sw-kp ${compact ? 'sw-kp-compact' : ''}`}>
      <div className="sw-kp-head">
        <span className="sw-kp-icon" aria-hidden="true">🎯</span>
        <span className="sw-kp-title">{title}</span>
        <span className="sw-kp-count">{valid.length} point{valid.length === 1 ? '' : 's'}</span>
      </div>

      {GROUPS.map(group => {
        const groupPoints = valid.filter(p => p.importance === group.id);
        if (groupPoints.length === 0) return null;
        return (
          <div key={group.id} className={`sw-kp-group sw-kp-${group.id}`}>
            <div className="sw-kp-group-head">
              <span className="sw-kp-dot" aria-hidden="true" />
              <span className="sw-kp-group-label">{group.label}</span>
              <span className="sw-kp-group-count">{groupPoints.length}</span>
            </div>
            <p className="sw-kp-group-hint">{group.hint}</p>
            <ol className="sw-kp-list">
              {groupPoints.map((p, i) => (
                <li key={`${group.id}-${i}`} className="sw-kp-item">
                  <span className="sw-kp-item-text">{p.point}</span>
                  {p.why && <span className="sw-kp-item-why">{p.why}</span>}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
