/**
 * Phase2Tools — folder sharing, email-to-save, and support inbox.
 *
 * Self-contained: fetches its own share list, inbound address, and tickets.
 * Rendered inside SettingsView. Folder sharing is Pro-only (enforced server
 * side too); the UI shows an upgrade nudge for free users.
 */
import { useEffect, useState } from 'react';
import type { Folder } from '../types';
import {
  listShares, createShare, revokeShare, type FolderShare,
  getInboundAddress, type InboundAddress,
  listTickets, createTicket, type SupportTicket,
} from '../api/phase2';

interface Props {
  folders: Folder[];
  tier: string;
  onAddToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Phase2Tools({ folders, tier, onAddToast }: Props) {
  const isPro = tier === 'pro';

  // ── Folder sharing ──────────────────────────────────────────────────────────
  const [shares, setShares] = useState<FolderShare[]>([]);
  const [shareFolder, setShareFolder] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Email-to-save ───────────────────────────────────────────────────────────
  const [inbound, setInbound] = useState<InboundAddress | null>(null);

  // ── Support ─────────────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isPro) listShares().then(setShares).catch(() => {});
    getInboundAddress().then(setInbound).catch(() => {});
    listTickets().then(setTickets).catch(() => {});
  }, [isPro]);

  const shareUrl = (token: string) => `${window.location.origin}/shared/${token}`;

  const handleCreateShare = async () => {
    if (!shareFolder) { onAddToast('Pick a folder to share.', 'info'); return; }
    setCreating(true);
    try {
      const share = await createShare(shareFolder);
      setShares([share, ...shares]);
      await navigator.clipboard?.writeText(shareUrl(share.token)).catch(() => {});
      onAddToast('Share link created & copied!', 'success');
    } catch (e: any) {
      onAddToast(e?.message || 'Could not create share link.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeShare(id);
      setShares(shares.filter(s => s.id !== id));
      onAddToast('Share link revoked.', 'success');
    } catch (e: any) {
      onAddToast(e?.message || 'Could not revoke.', 'error');
    }
  };

  const handleSubmitTicket = async () => {
    if (!subject.trim() || !body.trim()) { onAddToast('Fill in subject and message.', 'info'); return; }
    setSending(true);
    try {
      const t = await createTicket(subject.trim(), body.trim());
      setTickets([t, ...tickets]);
      setSubject(''); setBody('');
      onAddToast('Support request sent!', 'success');
    } catch (e: any) {
      onAddToast(e?.message || 'Could not send.', 'error');
    } finally {
      setSending(false);
    }
  };

  const folderName = (id: string) => folders.find(f => f.id === id)?.name ?? 'Unknown folder';

  return (
    <>
      {/* ── Folder sharing ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">🔗 Folder Sharing</span>
          {!isPro && <span className="tag accent text-xs">Pro</span>}
        </div>
        {!isPro ? (
          <p className="text-sm text-muted">Upgrade to Pro to create read-only share links for your folders.</p>
        ) : (
          <>
            <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>Create a public read-only link to any folder. Anyone with the link can view (not edit) its notes.</p>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <select className="select" value={shareFolder} onChange={e => setShareFolder(e.target.value)} style={{ flex: 1 }}>
                <option value="">Select a folder…</option>
                {folders.filter(f => f.id !== 'default').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button className="btn btn-primary" onClick={handleCreateShare} disabled={creating || !shareFolder}>{creating ? 'Creating…' : 'Create link'}</button>
            </div>
            {shares.length === 0 ? (
              <p className="text-sm text-muted">No active share links.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {shares.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface-2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-sm" style={{ fontWeight: 600 }}>📁 {folderName(s.folderId)}</div>
                      <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shareUrl(s.token)}</div>
                    </div>
                    <button className="btn btn-secondary btn-xs" onClick={() => { navigator.clipboard?.writeText(shareUrl(s.token)); onAddToast('Copied!', 'success'); }}>Copy</button>
                    <button className="btn btn-ghost btn-xs" style={{ color: 'var(--danger)' }} onClick={() => handleRevoke(s.id)}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Email-to-save ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-title">📧 Save by Email</span></div>
        {inbound?.enabled && inbound.address ? (
          <>
            <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>Email anything to this address and it becomes a note automatically:</p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code style={{ flex: 1, background: 'var(--surface-2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inbound.address}</code>
              <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(inbound.address!); onAddToast('Copied!', 'success'); }}>Copy</button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Email-to-save isn't configured on this server yet. Once an inbound email domain is set up, your personal save address will appear here.</p>
        )}
      </div>

      {/* ── Support ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-title">💬 Contact Support</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          <input className="input" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
          <textarea className="input" placeholder="How can we help?" value={body} onChange={e => setBody(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
          <button className="btn btn-primary" onClick={handleSubmitTicket} disabled={sending} style={{ alignSelf: 'flex-start' }}>{sending ? 'Sending…' : 'Send message'}</button>
        </div>
        {tickets.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <div className="text-xs text-muted" style={{ marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your requests</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tickets.map(t => (
                <div key={t.id} style={{ background: 'var(--surface-2)', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-sm" style={{ fontWeight: 600 }}>{t.subject}</span>
                    <span className={`tag text-xs ${t.status === 'open' ? 'accent' : t.status === 'replied' ? 'success' : ''}`}>{t.status}</span>
                  </div>
                  {t.reply && <p className="text-sm" style={{ marginTop: '0.5rem', color: 'var(--success)' }}>↳ {t.reply}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
