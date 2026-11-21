import { useState } from 'react';
import QRCode from 'react-qr-code';
import { lobbyShareUrl } from '../api/lobby';

/**
 * LobbyShare — the block a host uses to bring people into a session.
 *
 * It shows the three things a player needs to join:
 *   • the six-digit code, to type in
 *   • a shareable link, to send in a message
 *   • a QR code, to scan in person
 *
 * All three point at the same lobby, so whichever the player uses they land
 * in the same place. The QR encodes the link (not the bare code) so that a
 * scan works from any device, signed in or not.
 */
interface Props {
  /** The six-digit lobby code. */
  code: string;
  /** Shown above the code, e.g. "Quiz Battle" or "Study Room". */
  label?: string;
  /** Optional extra line under the code, e.g. "4 players waiting". */
  hint?: string;
  /** Compact mode drops the QR code — used in tight spots like the quiz waiting room. */
  compact?: boolean;
  /** When present, the card grows a Close button — shown to the host only. */
  onClose?: () => void;
  /** Disables the Close button while the request is in flight. */
  closing?: boolean;
}

export default function LobbyShare({ code, label, hint, compact, onClose, closing }: Props) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const link = lobbyShareUrl(code);

  const copy = async (what: 'code' | 'link', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission). The
      // text is on screen and selectable, so failing silently is acceptable.
      return;
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {label && (
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>{label}</h3>
      )}

      {/* The code — big enough to read across a room. */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <div
          style={{
            fontFamily: 'var(--sw-font-mono)',
            fontSize: '2.25rem',
            fontWeight: 800,
            letterSpacing: '0.22em',
            // Keep the six digits grouped visually even with the tracking.
            paddingLeft: '0.22em',
            color: 'var(--accent)',
            userSelect: 'all',
          }}
        >
          {code}
        </div>
        {hint && (
          <p className="text-xs text-muted" style={{ margin: '0.35rem 0 0' }}>{hint}</p>
        )}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: '0.5rem' }}
          onClick={() => copy('code', code)}
        >
          {copied === 'code' ? '✓ Copied' : 'Copy code'}
        </button>
      </div>

      {/* The link. */}
      <div style={{ marginBottom: compact ? 0 : '1rem' }}>
        <label className="text-muted text-xs">Shareable link</label>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
          <input
            className="input"
            readOnly
            value={link}
            onClick={e => (e.target as HTMLInputElement).select()}
            style={{ fontSize: '0.8125rem' }}
          />
          <button className="btn btn-outline" onClick={() => copy('link', link)}>
            {copied === 'link' ? '✓' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-muted" style={{ margin: '0.4rem 0 0' }}>
          Anyone who opens this link lands straight in the lobby.
        </p>
      </div>

      {/* The QR code — same destination as the link. */}
      {!compact && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '1rem',
            background: '#ffffff',
            borderRadius: 'var(--sw-r, 12px)',
          }}
        >
          <QRCode
            value={link}
            size={176}
            bgColor="#ffffff"
            fgColor="#0b0b12"
            level="M"
            title={`Lobby ${code}`}
          />
          <p
            style={{
              margin: '0.6rem 0 0',
              fontSize: '0.75rem',
              color: '#0b0b12',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            Scan to join lobby {code}
          </p>
        </div>
      )}

      {/* Host-only escape hatch: closing kills the code, the link and the QR
          in one move, so nobody new can arrive after the session is over. */}
      {onClose && (
        <div
          style={{
            marginTop: compact ? '0.75rem' : '1rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid rgba(128, 128, 128, 0.2)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={closing}>
            {closing ? 'Closing…' : '✕ Close lobby'}
          </button>
        </div>
      )}
    </div>
  );
}
