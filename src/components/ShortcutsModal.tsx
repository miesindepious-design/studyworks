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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {SHORTCUTS.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="text-sm text-muted">{s.label}</span>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {s.keys.map(k => (
                    <span key={k} className="keycap">{k}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '1.25rem' }}>On Windows/Linux, ⌘ = Ctrl</p>
        </div>
      </div>
    </div>
  );
}
