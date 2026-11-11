import { useEffect, useMemo, useState } from 'react';
import {
  SHORTCUT_DEFS,
  comboToLabel,
  eventToCombo,
  resolveCombo,
  setShortcutCapture,
} from '../config/shortcuts';
import { useShortcutOverrides } from '../hooks/useShortcuts';

interface ShortcutEditorProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

/**
 * Rebinds the app's keyboard shortcuts.
 *
 * The previous editor was decorative: it saved to a localStorage key that
 * nothing read, so rebinding a key changed the label and nothing else. This
 * one writes to the shared override store that App.tsx actually binds, and it
 * refuses combinations that are already taken.
 */
export default function ShortcutEditor({ onError, onSuccess }: ShortcutEditorProps) {
  const { overrides, set, reset } = useShortcutOverrides();
  const [capturingId, setCapturingId] = useState<string | null>(null);

  /** The combo each action is currently bound to (override wins over default). */
  const resolved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of SHORTCUT_DEFS) map[d.id] = resolveCombo(overrides, d.id, d.combo);
    return map;
  }, [overrides]);

  // Capture the next keypress for the action being edited. The listener runs
  // in the capture phase so it wins over the global shortcut handler.
  useEffect(() => {
    if (!capturingId) {
      setShortcutCapture(false);
      return;
    }
    setShortcutCapture(true);

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const action = SHORTCUT_DEFS.find(d => d.id === capturingId);
      setCapturingId(null);
      setShortcutCapture(false);

      const combo = eventToCombo(e);
      if (!combo) return;                       // a bare modifier — ignore
      if (combo === 'escape') return;           // Esc cancels

      const clash = SHORTCUT_DEFS.find(d => d.id !== capturingId && resolved[d.id] === combo);
      if (clash) {
        onError(`"${comboToLabel(combo)}" is already assigned to "${clash.label}". Remove it first.`);
        return;
      }

      set(capturingId, combo);
      onSuccess(`${action?.label ?? 'Shortcut'} → ${comboToLabel(combo)}`);
    };

    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      setShortcutCapture(false);
    };
  }, [capturingId, resolved, set, onError, onSuccess]);

  const groups = ['Navigate', 'Edit', 'General'] as const;

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {groups.map(group => {
          const items = SHORTCUT_DEFS.filter(d => d.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <p className="cmdk-group-label" style={{ padding: 0, margin: '0.5rem 0 0.4rem' }}>{group}</p>
              {items.map(d => {
                const currentKey = resolved[d.id];
                const isCustom = overrides[d.id] !== undefined;
                const isEditing = capturingId === d.id;
                return (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                    padding: '0.625rem 0.875rem', marginBottom: '0.375rem', borderRadius: 'var(--radius)',
                    background: isEditing ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: `1px solid ${isEditing ? 'rgb(45 212 191 / .35)' : 'var(--border)'}`,
                    transition: 'all 0.2s ease',
                  }}>
                    <span className="text-sm" style={{ fontWeight: 500, minWidth: 0 }}>
                      {d.label}
                      {isCustom && (
                        <span className="text-xs text-muted" style={{ marginLeft: '0.5rem' }}>
                          (was {comboToLabel(d.combo)})
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => setCapturingId(d.id)}
                      style={{
                        padding: '0.25rem 0.65rem', borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: isEditing ? 'var(--accent)' : 'var(--surface-3)',
                        color: isEditing ? 'var(--accent-ink)' : 'var(--text)',
                        fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'inherit', minWidth: '5.5rem', textAlign: 'center',
                        transition: 'all 0.15s ease', flexShrink: 0,
                      }}
                    >
                      {isEditing ? 'Press keys…' : comboToLabel(currentKey)}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {capturingId && (
        <p className="text-xs text-muted" style={{ marginBottom: '0.75rem', fontStyle: 'italic' }}>
          Press any key combination (e.g. ⌘T). Press <kbd style={{ padding: '0.05rem 0.3rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>Esc</kbd> to cancel.
        </p>
      )}

      <button className="btn btn-secondary btn-sm" onClick={() => { reset(); onSuccess('Shortcuts reset to defaults.'); }}>
        ↺ Reset to defaults
      </button>
    </div>
  );
}
