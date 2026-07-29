interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['⌘', 'Z'],        label: 'Undo' },
  { keys: ['⌘', '⇧', 'Z'],   label: 'Redo' },
  { keys: ['⌘', '1'],        label: 'Go to Dashboard' },
  { keys: ['⌘', '2'],        label: 'Go to Notes' },
  { keys: ['⌘', '3'],        label: 'Go to People' },
  { keys: ['⌘', '4'],        label: 'Go to Flashcards' },
  { keys: ['⌘', '5'],        label: 'Go to Pricing' },
  { keys: ['⌘', '6'],        label: 'Go to Settings' },
  { keys: ['Escape'],         label: 'Close modal / panel' },
  { keys: ['Enter'],          label: 'Flip flashcard' },
  { keys: ['?'],              label: 'Show keyboard shortcuts' },
];

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        className="card animate-in"
        style={{ maxWidth: '400px', width: '100%', padding: '1.75rem' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="card-header">
          <span className="card-title">⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {SHORTCUTS.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="text-sm text-muted">{s.label}</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {s.keys.map(k => (
                  <kbd key={k} style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0.15rem 0.45rem', fontSize: '0.75rem', fontFamily: 'inherit',
                    fontWeight: 600, background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-2)',
                    boxShadow: '0 1px 0 var(--border)',
                  }}>
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted" style={{ marginTop: '1.25rem' }}>On Windows/Linux, ⌘ = Ctrl</p>
      </div>
    </div>
  );
}
