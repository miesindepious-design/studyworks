import { useCallback, useEffect, useRef, useState } from 'react';
import { getLobby, listMyLobbies, type LobbyDetail, type MyLobby } from '../api/lobby';
import LobbyShare from './LobbyShare';

/**
 * LobbyView — the front door to every live session.
 *
 * A player arrives here in one of three ways:
 *   • they followed a share link or scanned a QR code (the code is passed in)
 *   • they typed a six-digit code
 *   • they opened the lobby from the sidebar and want to see their own rooms
 *
 * From here the player is referred to the right session: a quiz battle or a
 * study room. The host side shows every lobby they own, each with its code,
 * share link and QR code.
 */
interface Props {
  /** A six-digit code to resolve on arrival (from ?lobby= or a scan). */
  code?: string | null;
  /** Reports a lobby code back to the app so the URL can be kept in sync. */
  onCodeConsumed?: (code: string | null) => void;
  /** Navigate to the session the lobby points at. */
  onEnterQuiz: (roomCode: string) => void;
  onEnterStudy: (voiceRoomId: string, roomUrl: string | null) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type Phase = 'idle' | 'loading' | 'ready' | 'error';

export default function LobbyView({
  code, onCodeConsumed, onEnterQuiz, onEnterStudy, addToast,
}: Props) {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [lobby, setLobby] = useState<LobbyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myLobbies, setMyLobbies] = useState<MyLobby[]>([]);
  const [showMine, setShowMine] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshMine = useCallback(() => {
    listMyLobbies().then(setMyLobbies).catch(() => {});
  }, []);

  useEffect(() => { refreshMine(); }, [refreshMine]);

  // Resolve a code that arrived from outside (deep link, QR scan, paste).
  const resolve = useCallback(async (raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Lobby codes are six digits.');
      setPhase('error');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const detail = await getLobby(clean);
      setLobby(detail);
      setPhase('ready');
      setInput(clean);
    } catch (err: any) {
      setError(err?.message || 'Could not find that lobby.');
      setLobby(null);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (!code) return;
    resolve(code);
    onCodeConsumed?.(null);
  }, [code, resolve, onCodeConsumed]);

  const enter = () => {
    if (!lobby) return;
    if (lobby.status === 'closed') {
      addToast('That session has already ended.', 'info');
      return;
    }
    if (lobby.target.kind === 'quiz' && lobby.target.roomCode) {
      onEnterQuiz(lobby.target.roomCode);
    } else if (lobby.target.kind === 'study') {
      onEnterStudy(lobby.target.voiceRoomId ?? '', lobby.target.roomUrl ?? null);
    }
  };

  const kindLabel = lobby?.target.kind === 'quiz' ? 'Quiz Battle' : 'Study Room';
  const kindIcon  = lobby?.target.kind === 'quiz' ? '🏆' : '🎓';

  return (
    <div className="animate-in" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="sw-hero" style={{ marginBottom: '1.25rem' }}>
        <div className="sw-hero-main">
          <span className="sw-label">Join</span>
          <h2 className="sw-hero-title">Lobby</h2>
          <p className="sw-hero-sub">
            Enter the six-digit code from your host, or open the link they sent you.
            We'll take you straight to the right session.
          </p>
        </div>
      </div>

      {/* ── Enter a code ────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>🔑 Enter lobby code</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            ref={inputRef}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000000"
            value={input}
            onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter') resolve(input); }}
            style={{
              fontFamily: 'var(--sw-font-mono)',
              fontSize: '1.5rem',
              letterSpacing: '0.35em',
              textAlign: 'center',
              fontWeight: 700,
            }}
            aria-label="Six-digit lobby code"
          />
          <button
            className="btn btn-primary"
            onClick={() => resolve(input)}
            disabled={input.length !== 6 || phase === 'loading'}
          >
            {phase === 'loading' ? 'Finding…' : 'Join'}
          </button>
        </div>
        {phase === 'error' && error && (
          <p className="text-sm" style={{ margin: '0.6rem 0 0', color: 'var(--danger)' }}>{error}</p>
        )}
      </div>

      {/* ── Resolved lobby ──────────────────────────────────────────────── */}
      {phase === 'ready' && lobby && (
        <div
          className="card"
          style={{
            padding: '1.5rem',
            marginBottom: '1rem',
            borderColor: 'var(--accent)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.25rem', lineHeight: 1 }}>{kindIcon}</div>
          <h3 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.25rem', fontWeight: 800 }}>
            {lobby.sessionTitle}
          </h3>
          <p className="text-muted text-sm" style={{ margin: '0 0 0.75rem' }}>
            {kindLabel}
            {lobby.hostName ? ` · hosted by ${lobby.hostName}` : ''}
            {lobby.playerCount != null ? ` · ${lobby.playerCount} player${lobby.playerCount === 1 ? '' : 's'}` : ''}
          </p>

          {lobby.status === 'closed' ? (
            <p className="text-sm" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              This session has already ended.
            </p>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={enter}>
              Enter {kindLabel}
            </button>
          )}

          <div style={{ marginTop: '1rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setPhase('idle'); setLobby(null); setInput(''); inputRef.current?.focus(); }}
            >
              Use a different code
            </button>
          </div>
        </div>
      )}

      {/* ── Lobbies I host ──────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Your lobbies
            {myLobbies.length > 0 && (
              <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8125rem', marginLeft: '0.4rem' }}>
                ({myLobbies.length})
              </span>
            )}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowMine(s => !s)}>
            {showMine ? 'Hide' : 'Show'}
          </button>
        </div>

        {showMine && (
          myLobbies.length === 0 ? (
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              You have no lobbies yet. Create a Quiz Battle or a Study Room and its lobby code
              appears in the waiting room.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {myLobbies.map(l => (
                <LobbyShare
                  key={l.code}
                  code={l.code}
                  label={`${l.kind === 'quiz' ? '🏆' : '🎓'} ${l.title}`}
                  hint={
                    l.expired
                      ? 'Expired — this lobby is no longer joinable'
                      : l.status === 'closed'
                        ? 'This session has ended'
                        : 'Share this code, link, or QR with the people you want to invite'
                  }
                  compact
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
