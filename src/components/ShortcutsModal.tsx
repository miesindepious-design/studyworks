import { SHORTCUT_DEFS, comboToKeys, resolveCombo } from '../config/shortcuts';
import { useShortcutOverrides } from '../hooks/useShortcuts';

interface ShortcutsModalProps {
  onClose: () => void;
}

/**
 * The shortcuts reference sheet.
 *
 * It used to carry its own hardcoded list, which drifted away from the real
 * bindings. It now renders the shared registry with any custom rebinds
 * applied, so it always tells the truth.
 */
export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { overrides } = useShortcutOverrides();

  const groups = ['Navigate', 'Edit', 'General'] as const;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {groups.map(group => {
            const items = SHORTCUT_DEFS.filter(d => d.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} style={{ marginBottom: '1.25rem' }}>
                <p className="cmdk-group-label" style={{ padding: 0, marginBottom: '0.5rem' }}>{group}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  {items.map(d => {
                    const combo = resolveCombo(overrides, d.id, d.combo);
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                        <span className="text-sm text-muted">{d.label}</span>
                        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                          {comboToKeys(combo).map((k, i) => (
                            <span key={`${k}-${i}`} className="keycap">{k}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted">On Windows/Linux, ⌘ = Ctrl · Rebind any of these in Settings.</p>
        </div>
      </div>
    </div>
  );
}
