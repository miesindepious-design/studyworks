interface ConfirmModalProps {
  title:       string;
  description: string;
  confirmLabel?: string;
  cancelLabel?:  string;
  danger?:       boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
}

export default function ConfirmModal({
  title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ color: 'var(--text-3)' }}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ lineHeight: 1.7, fontSize: '0.9375rem', color: 'var(--text-2)' }}>{description}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { onConfirm(); }}
            style={danger ? { background: 'var(--danger)', color: '#fff', border: 'none' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
