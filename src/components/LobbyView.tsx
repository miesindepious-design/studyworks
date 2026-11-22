import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getLobby, listMyLobbies, joinLobby, closeLobby, createLobby,
  deleteLobby, deleteEndedLobbies, reopenLobby,
  type LobbyDetail, type MyLobby,
} from '../api/lobby';
import type { RoomFileInfo } from '../api/roomFiles';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmModal from './ConfirmModal';
import LobbyShare from './LobbyShare';
import RoomFilesPanel from './RoomFilesPanel';

/**
 * Has this lobby finished?
 *
 * The server says so directly now, but a lobby that was closed or has aged
 * out has always been recognisable from its own status — so fall back to
 * that rather than trusting the client to have the newest server.
 */
function hasEnded(l: MyLobby): boolean {
  return l.isEnded ?? (l.status === 'closed' || l.expired);
}

/**
 * How long ago something happened, in words.
 *
 * "Ended 4 days ago" tells the host more than a date does — the point of
 * the ended list is to let them judge at a glance whether a lobby is still
 * worth keeping.
 */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

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
  onEnterStudy: (voiceRoomId: string, roomUrl: string | null, lobbyCode: string | null) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  /** Open the AI tutor with a shared file as the material to study. */
  onStudyWithTutor?: (lobbyCode: string, file: RoomFileInfo) => void;
  /** Start a live quiz battle from the shared files. */
  onQuizFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
  /** Start an asynchronous duel from the shared files. */
  onDuelFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
}

type Phase = 'idle' | 'loading' | 'ready' | 'error';

export default function LobbyView({
  code, onCodeConsumed, onEnterQuiz, onEnterStudy, addToast,
  onStudyWithTutor, onQuizFiles, onDuelFiles,
}: Props) {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [lobby, setLobby] = useState<LobbyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myLobbies, setMyLobbies] = useState<MyLobby[]>([]);
  const [showMine, setShowMine] = useState(false);
  /** The lobby currently being closed, so its button can show progress. */
  const [closingCode, setClosingCode] = useState<string | null>(null);
  /** The lobby currently being deleted, so its button can show progress. */
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  /** The lobby currently being reopened, so its button can show progress. */
  const [reopeningCode, setReopeningCode] = useState<string | null>(null);
  /** True while every ended lobby is being cleared in one go. */
  const [clearingEnded, setClearingEnded] = useState(false);
  /** The name of the study group being created. */
  const [groupName, setGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const refreshMine = useCallback(() => {
    listMyLobbies().then(setMyLobbies).catch(() => {});
  }, []);

  useEffect(() => { refreshMine(); }, [refreshMine]);

  // Live lobbies are the ones people still use; ended ones are kept out of
  // the way until the host asks to see them. A host with a screenful of dead
  // rooms should open this card and find the live ones, not a graveyard.
  const { activeLobbies, endedLobbies } = useMemo(() => {
    const active = myLobbies.filter(l => !hasEnded(l));
    const ended = myLobbies.filter(hasEnded);
    return { activeLobbies: active, endedLobbies: ended };
  }, [myLobbies]);

  // A group that exists only to hold material can be brought back after it
  // closed itself for sitting idle. A lobby that fronts a finished session
  // cannot — there is nothing behind it any more.
  const canReopen = (l: MyLobby) =>
    l.kind === 'study' && !l.target.voiceRoomId && !l.target.roomUrl;

  // ── Close one of my lobbies ────────────────────────────────────────────────
  // Host-only. Closing kills the code, the link and the QR in one move —
  // this is how a session the host abandoned stops accepting players.
  const closeMine = useCallback(async (code: string) => {
    if (closingCode) return;
    setClosingCode(code);
    try {
      await closeLobby(code);
      addToast(`Lobby ${code} closed — the code no longer works.`, 'success');
      setMyLobbies(prev => prev.map(l => (l.code === code ? { ...l, status: 'closed' as const, isEnded: true } : l)));
    } catch (err: any) {
      addToast(err?.message || 'Could not close that lobby.', 'error');
    } finally {
      setClosingCode(null);
    }
  }, [closingCode, addToast]);

  // ── Delete one of my lobbies ──────────────────────────────────────────────
  // The real removal: the lobby, its roster and anything shared on it. It
  // works on a closed lobby too — a lobby that has ended but cannot be
  // deleted is exactly the kind of dead weight that piles up.
  const deleteMine = useCallback(async (lobby: MyLobby) => {
    const ok = await confirm({
      title: `Delete "${lobby.title}"?`,
      description:
        'This removes the lobby for good, along with anything shared on it. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    setDeletingCode(lobby.code);
    try {
      await deleteLobby(lobby.code);
      setMyLobbies(prev => prev.filter(l => l.code !== lobby.code));
      addToast(`Lobby ${lobby.code} deleted.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not delete that lobby.', 'error');
    } finally {
      setDeletingCode(null);
    }
  }, [confirm, addToast]);

  // ── Clear every ended lobby ───────────────────────────────────────────────
  // For the host who has a screenful of dead rooms and no interest in going
  // through them one at a time.
  const clearEnded = useCallback(async () => {
    if (clearingEnded) return;
    const ok = await confirm({
      title: 'Delete all ended lobbies?',
      description:
        'Every lobby of yours that has already ended — along with anything shared on them — will be removed. This cannot be undone.',
      confirmLabel: 'Delete them all',
      danger: true,
    });
    if (!ok) return;

    setClearingEnded(true);
    try {
      const { deleted } = await deleteEndedLobbies();
      setMyLobbies(prev => prev.filter(l => !hasEnded(l)));
      addToast(
        deleted > 0
          ? `Deleted ${deleted} ended lobby${deleted === 1 ? '' : 's'}.`
          : 'No ended lobbies to delete.',
        'success',
      );
    } catch (err: any) {
      addToast(err?.message || 'Could not clear your ended lobbies.', 'error');
    } finally {
      setClearingEnded(false);
    }
  }, [clearingEnded, confirm, addToast]);

  // ── Bring a study group back ──────────────────────────────────────────────
  const reopenMine = useCallback(async (lobby: MyLobby) => {
    if (reopeningCode) return;
    setReopeningCode(lobby.code);
    try {
      await reopenLobby(lobby.code);
      addToast(`"${lobby.title}" is open again.`, 'success');
      refreshMine();
    } catch (err: any) {
      addToast(err?.message || 'Could not reopen that group.', 'error');
    } finally {
      setReopeningCode(null);
    }
  }, [reopeningCode, addToast, refreshMine]);

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

  // ── Create a study group ──────────────────────────────────────────────────
  // A lobby is where the group agrees what it is studying: a code, a link and
  // a shared shelf of files. The group may never open a quiz or a study
  // room — the material itself is the point.
  const createGroup = useCallback(async () => {
    if (creatingGroup) return;
    setCreatingGroup(true);
    try {
      const title = groupName.trim() || 'Study group';
      const created = await createLobby({ kind: 'study', title });
      setGroupName('');
      await resolve(created.code);
      refreshMine();
      addToast(`Study group ready — share code ${created.code}.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not create the study group.', 'error');
    } finally {
      setCreatingGroup(false);
    }
  }, [creatingGroup, groupName, resolve, refreshMine, addToast]);

  useEffect(() => {
    if (!code) return;
    resolve(code);
    onCodeConsumed?.(null);
  }, [code, resolve, onCodeConsumed]);

  const enter = async () => {
    if (!lobby) return;
    if (lobby.status === 'closed') {
      addToast('That session has already ended.', 'info');
      return;
    }
    if (lobby.target.kind === 'quiz' && lobby.target.roomCode) {
      onEnterQuiz(lobby.target.roomCode);
    } else if (lobby.target.kind === 'study') {
      // Register presence before handing the player over: a full room or a
      // lobby the host has closed is explained here, where the player still
      // has the code on screen, rather than inside the session screen.
      try {
        await joinLobby(lobby.code);
      } catch (err: any) {
        addToast(err?.message || 'Could not join that session.', 'error');
        return;
      }
      onEnterStudy(
        lobby.target.voiceRoomId ?? '',
        lobby.target.roomUrl ?? null,
        lobby.code,
      );
    }
  };

  const kindLabel = lobby?.target.kind === 'quiz' ? 'Quiz Battle' : 'Study Room';
  const kindIcon  = lobby?.target.kind === 'quiz' ? '🏆' : '🎓';
  // A group lobby may exist only to hold material — there is no session to
  // enter, so the Enter button would lead nowhere.
  const hasSession = lobby
    ? (lobby.target.kind === 'quiz'
        ? Boolean(lobby.target.roomCode)
        : Boolean(lobby.target.voiceRoomId || lobby.target.roomUrl))
    : false;
  const isMaterialOnly = Boolean(lobby && lobby.target.kind === 'study' && !hasSession);

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

      {/* ── Create a study group ───────────────────────────────────────── */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem', fontWeight: 700 }}>👥 Start a study group</h3>
        <p className="text-xs text-muted" style={{ margin: '0 0 0.75rem' }}>
          Create a lobby for the material your group is working on. Share the code,
          drop in the files, then battle each other over them.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="input"
            placeholder="Group name (optional)"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createGroup(); }}
          />
          <button className="btn btn-secondary" onClick={createGroup} disabled={creatingGroup}>
            {creatingGroup ? 'Creating…' : 'Create'}
          </button>
        </div>
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
          <div style={{ fontSize: '2.25rem', lineHeight: 1 }}>{isMaterialOnly ? '👥' : kindIcon}</div>
          <h3 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.25rem', fontWeight: 800 }}>
            {lobby.sessionTitle}
          </h3>
          <p className="text-muted text-sm" style={{ margin: '0 0 0.75rem' }}>
            {isMaterialOnly ? 'Study group' : kindLabel}
            {lobby.hostName ? ` · hosted by ${lobby.hostName}` : ''}
            {/* How many people are already in — the joiner sees the room's
                occupancy before committing to it. Quizzes count players in
                the game room; study sessions count the live roster. */}
            {lobby.playerCount != null
              ? ` · ${lobby.playerCount} player${lobby.playerCount === 1 ? '' : 's'}`
              : lobby.participants.length > 0
                ? ` · ${lobby.participants.length} of ${lobby.maxParticipants} in session`
                : ''}
          </p>

          {lobby.status === 'closed' ? (
            <p className="text-sm" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              This session has already ended.
            </p>
          ) : isMaterialOnly ? (
            <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
              This is a study group — share your material below, then battle each
              other over it.
            </p>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={enter}>
              Enter {kindLabel}
            </button>
          )}

          {/* A material-only group lives on its code and its link — put them
              where the host can pick them up right away. */}
          {isMaterialOnly && (
            <div style={{ marginTop: '1rem', textAlign: 'left' }}>
              <LobbyShare
                code={lobby.code}
                label="Share this group"
                hint="Friends who open the link land here and can see the material you share."
                compact
              />
            </div>
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

      {/* ── The group's shared material ───────────────────────────────────
          The lobby is where the group agrees what it is studying. Whoever
          drops the file in, everybody else can study it, battle each other
          over it, or set a duel from it. */}
      {phase === 'ready' && lobby && lobby.status !== 'closed' && (
        <RoomFilesPanel
          lobbyCode={lobby.code}
          addToast={addToast}
          onStudyWithTutor={onStudyWithTutor}
          onQuizFiles={onQuizFiles}
          onDuelFiles={onDuelFiles}
          title="Study material for this group"
        />
      )}

      {/* ── Lobbies I host ──────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Your lobbies
            {activeLobbies.length > 0 && (
              <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8125rem', marginLeft: '0.4rem' }}>
                ({activeLobbies.length} live)
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
              {/* ── Live lobbies ──────────────────────────────────────────
                  The ones people can still join. Each gets the share code
                  and a Close button, plus a Delete button — closing stops
                  people arriving, deleting removes it for good. */}
              {activeLobbies.map(l => (
                <LobbyShare
                  key={l.code}
                  code={l.code}
                  label={`${l.kind === 'quiz' ? '🏆' : '🎓'} ${l.title}`}
                  hint="Share this code, link, or QR with the people you want to invite"
                  compact
                  onClose={() => closeMine(l.code)}
                  closing={closingCode === l.code}
                  onDelete={() => deleteMine(l)}
                  deleting={deletingCode === l.code}
                />
              ))}

              {activeLobbies.length === 0 && (
                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  No live lobbies right now. Everything you have hosted has ended.
                </p>
              )}

              {/* ── Ended lobbies ────────────────────────────────────────
                  Kept out of the way until the host asks for them, but never
                  unreachable: each one can be deleted, and a study group
                  that closed itself for sitting idle can be reopened. */}
              {endedLobbies.length > 0 && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    paddingTop: '0.85rem',
                    borderTop: '1px solid rgba(128, 128, 128, 0.2)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <span className="text-muted" style={{ fontSize: '0.8125rem' }}>
                      Ended ({endedLobbies.length})
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={clearEnded}
                      disabled={clearingEnded}
                    >
                      {clearingEnded ? 'Clearing…' : 'Delete all ended'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {endedLobbies.map(l => (
                      <div
                        key={l.code}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          padding: '0.6rem 0.75rem',
                          borderRadius: 'var(--sw-r, 12px)',
                          background: 'rgba(128, 128, 128, 0.07)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.kind === 'quiz' ? '🏆' : '🎓'} {l.title}
                          </div>
                          <div className="text-xs text-muted">
                            {l.code} · ended {ago(l.createdAt)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                          {canReopen(l) && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => reopenMine(l)}
                              disabled={reopeningCode === l.code}
                            >
                              {reopeningCode === l.code ? 'Reopening…' : 'Reopen'}
                            </button>
                          )}
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => deleteMine(l)}
                            disabled={deletingCode === l.code}
                            style={{ color: 'var(--danger)' }}
                          >
                            {deletingCode === l.code ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {ConfirmDialog && <ConfirmModal {...ConfirmDialog} />}
    </div>
  );
}
