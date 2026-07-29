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
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onCancel}
    >
      <div
        className="card animate-in"
        style={{ maxWidth: '420px', width: '100%', padding: '1.75rem' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontWeight: 700, fontSize: '1.0625rem', marginBottom: '0.625rem' }}>{title}</h3>
        <p className="text-sm text-muted" style={{ lineHeight: 1.7, marginBottom: '1.5rem' }}>{description}</p>
        <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
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
