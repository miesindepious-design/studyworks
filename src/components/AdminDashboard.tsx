import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteAdminUser,
  getAdminStats,
  getAdminUser,
  getAdminUsers,
  setUserTier,
} from '../api/admin';
import type { AdminUser, AdminUserDetail, AdminStats } from '../api/admin';
import AdminDeleteUserModal from './AdminDeleteUserModal';

interface Props {
  adminEmail: string;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function AdminDashboard({ adminEmail, addToast }: Props) {
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [updating, setUpdating] = useState<string | null>(null); // userId being updated

  // Delete-account flow
  const [deleteTarget, setDeleteTarget] = useState<AdminUserDetail | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null); // fetching the impact summary
  const [deleting, setDeleting]           = useState(false); // the delete request is in flight
  const [deleteError, setDeleteError]     = useState<string | null>(null);

  const searchTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const [statsRes, usersRes] = await Promise.all([
        getAdminStats(),
        getAdminUsers(q),
      ]);
      setStats(statsRes);
      setUsers(usersRes.users);
    } catch (err: any) {
      addToast(err.message || 'Failed to load admin data', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadData(val || undefined), 350);
  };

  const handleToggleTier = async (user: AdminUser) => {
    const next = user.tier === 'PRO' ? 'FREE' : 'PRO';
    setUpdating(user.id);
    try {
      const res = await setUserTier(user.id, next);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, tier: res.user.tier } : u));
      setStats(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pro:  next === 'PRO' ? prev.pro + 1 : prev.pro - 1,
          free: next === 'FREE' ? prev.free + 1 : prev.free - 1,
        };
      });
      addToast(`${user.email} → ${next}`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Update failed', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ── Delete an account ───────────────────────────────────────────────────────

  /** Open the confirmation dialog, loading what would be lost first. */
  const handleOpenDelete = async (user: AdminUser) => {
    setDeleteError(null);
    setDeleteTarget(null);
    setDeleteLoadingId(user.id);
    try {
      const detail = await getAdminUser(user.id);
      setDeleteTarget(detail);
    } catch (err: any) {
      addToast(err.message || 'Could not load the account details', 'error');
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const handleCloseDelete = () => {
    if (deleting) return; // don't let the dialog vanish mid-request
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async (email: string) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAdminUser(target.user.id, email);

      // Drop the row and fix the tier counters.
      setUsers(prev => prev.filter(u => u.id !== target.user.id));
      setStats(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          total: prev.total - 1,
          pro:   target.user.tier === 'PRO' ? prev.pro - 1 : prev.pro,
          free:  target.user.tier === 'FREE' ? prev.free - 1 : prev.free,
        };
      });

      setDeleteTarget(null);
      addToast(`Deleted ${result.deleted.email}`, 'success');
      for (const warning of result.warnings) addToast(warning, 'info');
    } catch (err: any) {
      setDeleteError(err.message || 'The account could not be deleted');
    } finally {
      setDeleting(false);
    }
  };

  /** The signed-in admin may not delete their own account (the server refuses too). */
  const isAdminRow = (user: AdminUser) =>
    user.email.toLowerCase() === adminEmail.toLowerCase();

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div className="page-header">
        <div>
          <span className="sw-label">Admin</span>
          <h1>Admin Dashboard</h1>
          <p className="text-sm text-muted">Signed in as <strong>{adminEmail}</strong></p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="sw-grid sw-grid-3" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Users',  value: stats?.total, color: 'var(--sw-accent)' },
          { label: 'Pro Users',    value: stats?.pro,   color: 'var(--sw-success)' },
          { label: 'Free Users',   value: stats?.free,  color: 'var(--sw-text-3)' },
        ].map(card => (
          <div key={card.label} className="sw-stat" style={{ alignItems: 'center', textAlign: 'center', padding: '18px 15px' }}>
            <div style={{ fontFamily: 'var(--sw-font-head)', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', color: card.color }}>
              {stats === null ? '—' : card.value}
            </div>
            <div className="sw-stat-label" style={{ marginTop: 4 }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Search + table */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: '200px' }}
            placeholder="Search by email or name…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => loadData(search || undefined)}
            disabled={loading}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {loading && users.length === 0 ? (
          <div className="text-sm text-muted" style={{ padding: '2rem', textAlign: 'center' }}>
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="text-sm text-muted" style={{ padding: '2rem', textAlign: 'center' }}>
            No users found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['User', 'Joined', 'Tier', 'Subscription', 'Action'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '0.5rem 0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr
                    key={user.id}
                    style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    {/* User */}
                    <td style={{ padding: '0.65rem 0.75rem' }}>
                      <div style={{ fontWeight: 600 }}>{user.name || '—'}</div>
                      <div className="text-muted" style={{ fontSize: '0.78rem' }}>{user.email}</div>
                    </td>

                    {/* Joined */}
                    <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(user.createdAt)}
                    </td>

                    {/* Tier badge */}
                    <td style={{ padding: '0.65rem 0.75rem' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: user.tier === 'PRO' ? 'var(--accent-soft, rgba(99,102,241,0.12))' : 'var(--surface-2)',
                        color: user.tier === 'PRO' ? 'var(--accent)' : 'var(--text-muted)',
                      }}>
                        {user.tier === 'PRO' ? '⭐ PRO' : 'FREE'}
                      </span>
                    </td>

                    {/* Subscription */}
                    <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      {user.stripeSubscriptionId ? (
                        <div>
                          <div>Stripe sub</div>
                          {user.stripeCurrentPeriodEnd && (
                            <div>Renews {formatDate(user.stripeCurrentPeriodEnd)}</div>
                          )}
                        </div>
                      ) : (
                        <span>—</span>
                      )}
                    </td>

                    {/* Action */}
                    <td style={{ padding: '0.65rem 0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          className={`btn btn-sm ${user.tier === 'PRO' ? 'btn-secondary' : 'btn-primary'}`}
                          disabled={updating === user.id}
                          onClick={() => handleToggleTier(user)}
                          style={{ minWidth: '100px' }}
                        >
                          {updating === user.id
                            ? 'Saving…'
                            : user.tier === 'PRO'
                              ? '↓ Downgrade'
                              : '↑ Upgrade to Pro'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleOpenDelete(user)}
                          disabled={deleteLoadingId === user.id || isAdminRow(user)}
                          title={isAdminRow(user)
                            ? 'You cannot delete your own admin account'
                            : 'Delete this account and everything in it'}
                        >
                          {deleteLoadingId === user.id ? '…' : '🗑 Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted" style={{ marginTop: '0.75rem', textAlign: 'right' }}>
              Showing {users.length} user{users.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ' (most recent first, max 200)'}
            </p>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <AdminDeleteUserModal
          detail={deleteTarget}
          deleting={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={handleCloseDelete}
        />
      )}
    </div>
  );
}
