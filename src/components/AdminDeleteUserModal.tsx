import { useEffect, useState } from 'react';
import type { AdminUserDetail } from '../api/admin';

interface Props {
  detail:    AdminUserDetail;
  deleting:  boolean;
  error:     string | null;
  onConfirm: (email: string) => void;
  onCancel:  () => void;
}

/**
 * Confirm deleting an account.
 *
 * Deleting an account cannot be undone, so this asks twice over: it shows
 * exactly what is about to be removed, and it makes the admin type the
 * account's email before the delete button unlocks. A mis-click on the
 * wrong row in a long table should not be able to destroy someone's
 * coursework.
 */
export default function AdminDeleteUserModal({ detail, deleting, error, onConfirm, onCancel }: Props) {
  const { user, counts } = detail;
  const [typed, setTyped] = useState('');

  // Reset the typed confirmation whenever the dialog opens on a new user.
  useEffect(() => { setTyped(''); }, [user.id]);

  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

  const rows: Array<[string, number]> = [
    ['Notes',             counts.notes],
    ['Folders',           counts.folders],
    ['Contacts',          counts.contacts],
    ['Flashcards',        counts.flashcards],
    ['Practice questions', counts.practiceQuestions],
    ['Saved searches',    counts.savedSearches],
    ['Uploaded files',    counts.attachments],
    ['Quiz games hosted', counts.gameRooms],
    ['Support tickets',   counts.supportTickets],
  ];
  const totalItems = rows.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Delete account</span>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ color: 'var(--text-3)' }}>✕</button>
        </div>

        <div className="modal-body">
          <p style={{ margin: '0 0 0.75rem', lineHeight: 1.7, fontSize: '0.9375rem', color: 'var(--text-2)' }}>
            This permanently removes <strong style={{ color: 'var(--text)' }}>{user.email}</strong>
            {user.name ? ` (${user.name})` : ''} and everything they created.
            It cannot be undone.
          </p>

          {/* What goes with the account */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md, 10px)',
              padding: '0.75rem 0.9rem',
              background: 'var(--surface-2)',
            }}
          >
            <div className="text-xs text-muted" style={{ marginBottom: '0.45rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Will be deleted
            </div>
            <div className="sw-delete-counts">
              {rows.map(([label, n]) => (
                <div key={label} className="sw-delete-count-row">
                  <span style={{ color: 'var(--text-2)' }}>{label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: n > 0 ? 'var(--text)' : 'var(--text-muted)' }}>{n}</span>
                </div>
              ))}
              <div className="sw-delete-count-total">
                <span style={{ color: 'var(--text)' }}>Total items</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalItems}</span>
              </div>
            </div>
          </div>
        </div>

        {/* The confirmation field sits outside the scrolling body so it is
            always on screen, right above the button that uses it. */}
        <div className="modal-confirm">
          {user.stripeSubscriptionId && (
            <div
              style={{
                border: '1px solid var(--danger, rgb(251 113 133 / .35))',
                background: 'var(--danger-soft, rgba(251 113 133 / .1))',
                color: 'var(--danger, #f87171)',
                borderRadius: 'var(--r-md, 10px)',
                padding: '0.6rem 0.8rem',
                marginBottom: '0.75rem',
                fontSize: '0.8125rem',
                lineHeight: 1.6,
              }}
            >
              This account has an active Stripe subscription. It will be cancelled as
              part of the deletion so the customer is not billed for an account that
              no longer exists.
            </div>
          )}
          <label
            htmlFor="admin-delete-confirm"
            className="text-xs text-muted"
            style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            Type <span style={{ color: 'var(--text)' }}>{user.email}</span> to confirm
          </label>
          <input
            id="admin-delete-confirm"
            className="input"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches && !deleting) onConfirm(typed.trim()); }}
            placeholder={user.email}
            autoComplete="off"
            spellCheck={false}
            style={{ width: '100%' }}
          />

          {error && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.55rem 0.75rem',
                borderRadius: 'var(--r-md, 10px)',
                border: '1px solid var(--danger, rgb(251 113 133 / .35))',
                background: 'var(--danger-soft, rgba(251 113 133 / .1))',
                color: 'var(--danger, #f87171)',
                fontSize: '0.8125rem',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={() => onConfirm(typed.trim())}
            disabled={!matches || deleting}
            style={{ fontWeight: 700 }}
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  );
}
