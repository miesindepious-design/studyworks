import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStudyRoom } from '../api/studyRoom';
import { closeLobby, getLobby, joinLobby, leaveLobby, type LobbyParticipantInfo } from '../api/lobby';
import type { RoomFileInfo } from '../api/roomFiles';
import VoiceChat from './VoiceChat';
import LobbyShare from './LobbyShare';
import RoomFilesPanel from './RoomFilesPanel';

interface Props {
  userId: string;
  userName: string;
  tier: string;
  setCurrentView: (v: string) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  signalingUrl?: string;
  /** A study session the player was referred to from a lobby. */
  joinRoom?: { id: string; url: string | null; lobbyCode?: string | null } | null;
  /** Called once the referred session has been taken off the queue. */
  onRoomConsumed?: () => void;
  /** Open the AI tutor with a shared file as the material to study. */
  onStudyWithTutor?: (lobbyCode: string, file: RoomFileInfo) => void;
  /** Start a live quiz battle from the shared files. */
  onQuizFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
  /** Start an asynchronous duel from the shared files. */
  onDuelFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
}

type StudyPhase = 'idle' | 'creating' | 'ready' | 'error';
type TimerMode  = 'focus' | 'break';

const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;

interface Participant {
  id:     string;
  name:   string;
  /** 'me' for the local user; remote peers show as 'connected', muted/deafened state reflected */
  status: 'me' | 'connected' | 'muted' | 'deafened';
}

export default function StudyRoom({ userId, userName, tier, setCurrentView, addToast, signalingUrl, joinRoom, onRoomConsumed, onStudyWithTutor, onQuizFiles, onDuelFiles }: Props) {
  const [phase, setPhase]               = useState<StudyPhase>('idle');
  const [roomName, setRoomName]         = useState('');
  const [room, setRoom]                 = useState<{ id: string; name: string; url: string | null; provider: string; maxParticipants: number } | null>(null);
  const [copied, setCopied]             = useState(false);
  const [goals, setGoals]               = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [timerMode, setTimerMode]       = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft]         = useState(FOCUS_MINUTES * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [tipsOpen, setTipsOpen]         = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  /** The six-digit lobby code for the room this client is in — hosting or joining. */
  const [lobbyCode, setLobbyCode]     = useState<string | null>(null);
  /** Who is in the session right now, as the lobby sees it (server truth). */
  const [roster, setRoster]           = useState<LobbyParticipantInfo[]>([]);
  /** Who hosts the session right now — the creator, or whoever took over. */
  const [hostUserId, setHostUserId]   = useState<string | null>(null);
  const [closingLobby, setClosingLobby] = useState(false);

  // ── Real participant list ─────────────────────────────────────────────────
  // Starts with just the current user. Remote peers are added/removed as they
  // connect to the voice signaling server. We listen on the same socket that
  // VoiceChat uses so there's no second connection — VoiceChat exposes its
  // socket events via the window custom event bus below.
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Initialise participant list with just the current user once a room is ready.
  const initParticipants = useCallback(() => {
    setParticipants([{ id: userId, name: userName, status: 'me' }]);
  }, [userId, userName]);

  // ── Join a session the player was referred to from a lobby ─────────────────
  // The lobby resolves a six-digit code to a study session and hands us the
  // voice room id. Adopting it drops us straight into that session's room —
  // the room id doubles as the voice room key, so everyone lands together.
  const joinedRef = useRef<string | null>(null);
  useEffect(() => {
    const target = joinRoom;
    if (!target?.id) return;
    // Guard against re-running when the parent re-renders with the same target.
    if (joinedRef.current === target.id) return;
    joinedRef.current = target.id;

    setRoom({
      id: target.id,
      name: 'Study Room',
      url: target.url ?? null,
      provider: target.url ? 'daily' : 'local',
      maxParticipants: 6,
    });
    // The referred session carries its lobby code so this screen can keep
    // presence (roster, host handoff, close) running while the player is in.
    setLobbyCode(target.lobbyCode ?? null);
    setPhase('ready');
    initParticipants();
    onRoomConsumed?.();
  }, [joinRoom, initParticipants, onRoomConsumed]);

  // VoiceChat fires custom DOM events so StudyRoom can reflect real peer state
  // without needing to share a socket ref. Mute/deafen state lands in its own
  // map so it can overlay the server roster (which doesn't know about audio).
  const [voiceStatus, setVoiceStatus] = useState<Record<string, Participant['status']>>({});
  useEffect(() => {
    const onJoin = (e: Event) => {
      const { playerId } = (e as CustomEvent<{ playerId: string }>).detail;
      if (playerId === userId) return;
      setVoiceStatus(prev => ({ ...prev, [playerId]: 'connected' }));
      setParticipants(prev => {
        if (prev.some(p => p.id === playerId)) return prev;
        return [...prev, { id: playerId, name: `Peer ${playerId.slice(-4)}`, status: 'connected' }];
      });
    };

    const onLeave = (e: Event) => {
      const { playerId } = (e as CustomEvent<{ playerId: string }>).detail;
      setParticipants(prev => prev.filter(p => p.id !== playerId));
    };

    const onState = (e: Event) => {
      const { playerId, isMuted, isDeafened } = (e as CustomEvent<{ playerId: string; isMuted: boolean; isDeafened: boolean }>).detail;
      const status: Participant['status'] = isDeafened ? 'deafened' : isMuted ? 'muted' : 'connected';
      setVoiceStatus(prev => ({ ...prev, [playerId]: status }));
      setParticipants(prev => prev.map(p => {
        if (p.id !== playerId) return p;
        return { ...p, status };
      }));
    };

    window.addEventListener('voice:peer_joined',  onJoin);
    window.addEventListener('voice:peer_left',    onLeave);
    window.addEventListener('voice:peer_state',   onState);
    return () => {
      window.removeEventListener('voice:peer_joined',  onJoin);
      window.removeEventListener('voice:peer_left',    onLeave);
      window.removeEventListener('voice:peer_state',   onState);
    };
  }, [userId]);

  // Stable peer id list for VoiceChat (excludes self — VoiceChat uses it to
  // decide who to call). Derived from the lobby roster — the server's view of
  // who is in the session — merged with peers the voice layer discovered, so
  // a call goes out even if one of the two lists is late.
  const peerIds = useMemo(() => {
    const ids = [
      ...roster.map(p => p.userId),
      ...participants.map(p => p.id),
    ].filter(id => id && id !== userId);
    return Array.from(new Set(ids));
  }, [roster, participants, userId]);

  // ── Who is in the session ──────────────────────────────────────────────────
  // Server-tracked presence is the truth when the lobby knows: it has real
  // names, and it works even with voice chat off. The voice peer events
  // stay as the fallback for a session without lobby tracking, and overlay
  // the mute/deafen state either way.
  const sessionRoster = useMemo<Participant[]>(() => {
    const base: Participant[] = roster.length > 0
      ? roster.map(p => ({ id: p.userId, name: p.name || 'Guest', status: 'connected' as const }))
      : participants;
    return base.map(p => ({
      ...p,
      status: p.id === userId ? 'me' as const : (voiceStatus[p.id] ?? p.status),
    }));
  }, [roster, participants, voiceStatus, userId]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  useEffect(() => {
    if (!timerRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerMode === 'focus') { setTimerMode('break'); return BREAK_MINUTES * 60; }
          else                       { setTimerMode('focus'); return FOCUS_MINUTES * 60; }
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerMode]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const toggleTimer = useCallback(() => setTimerRunning(r => !r), []);
  const resetTimer  = useCallback(() => {
    setTimerRunning(false);
    setTimerMode('focus');
    setTimeLeft(FOCUS_MINUTES * 60);
  }, []);

  // ── Room actions ──────────────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    if (tier !== 'pro') {
      addToast('Study Rooms are a Pro feature!', 'info');
      setCurrentView('pricing');
      return;
    }
    setPhase('creating');
    try {
      const res = await createStudyRoom({ name: roomName || undefined, maxParticipants: 6 });
      setRoom({ id: res.id, name: res.name, url: res.url, provider: res.provider, maxParticipants: res.maxParticipants });
      setLobbyCode(res.lobbyCode ?? null);
      setPhase('ready');
      initParticipants();
      addToast('Study room created!', 'success');
    } catch (e: any) {
      setPhase('error');
      addToast(e?.message || 'Could not create room', 'error');
    }
  }, [roomName, tier, addToast, setCurrentView, initParticipants]);

  const joinIfReady = () => {
    if (!room?.url) {
      addToast('No video URL available. Add DAILY_API_KEY to your server to enable video rooms.', 'info');
      return;
    }
    const w = window.open(room.url, '_blank', 'noopener,noreferrer');
    if (!w) addToast('Popup blocked — allow popups for this site to join the room.', 'error');
  };

  const copyLink = async () => {
    const link = room?.url ?? window.location.origin;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // The lobby code travels in a ref so the unmount cleanup — the "I left"
  // call — always sees the latest value, even after a fresh session opened.
  const lobbyCodeRef = useRef<string | null>(null);
  useEffect(() => { lobbyCodeRef.current = lobbyCode; }, [lobbyCode]);

  /**
   * Tell the lobby we're gone. If we were hosting, the participant who has
   * been there longest takes over; if nobody is left, the sweep closes the
   * lobby two minutes after the last departure.
   */
  const reportLeave = useCallback(() => {
    const code = lobbyCodeRef.current;
    if (code) void leaveLobby(code).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    reportLeave();
    setPhase('idle');
    setRoom(null);
    setLobbyCode(null);
    setRoster([]);
    setHostUserId(null);
    joinedRef.current = null;
    setRoomName('');
    setGoals('');
    setSessionNotes('');
    setTimerRunning(false);
    setTimerMode('focus');
    setTimeLeft(FOCUS_MINUTES * 60);
    setParticipants([]);
  }, [reportLeave]);

  // ── Lobby presence ────────────────────────────────────────────────────────
  // While a session is live, the client polls the lobby every fifteen
  // seconds. That one poll does four jobs: it registers/renews the caller's
  // presence on the server, it refreshes the roster and the host (so a
  // handoff shows up without any socket plumbing), and it notices when the
  // lobby has been closed — by the host, or by the sweep after everybody
  // left.
  useEffect(() => {
    if (phase !== 'ready' || !lobbyCode) return;
    let stopped = false;

    const beat = async () => {
      try {
        const detail = await getLobby(lobbyCode);
        if (stopped) return;
        if (detail.status === 'closed') {
          addToast('This study session has ended.', 'info');
          reset();
          return;
        }
        setHostUserId(detail.hostUserId ?? null);
        setRoster(detail.participants ?? []);
      } catch {
        // Transient — the next beat retries; presence just skips a beat.
      }
    };

    joinLobby(lobbyCode).then(beat).catch(() => {});
    const timer = setInterval(beat, 15_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [phase, lobbyCode, addToast, reset]);

  // Leaving the session — navigating away, or the tab closing (best effort)
  // — must reach the lobby so the host handoff and the empty sweep run.
  useEffect(() => () => reportLeave(), [reportLeave]);

  // ── Close the lobby ───────────────────────────────────────────────────────
  // Done with the session? The host can kill the six-digit code, the share
  // link and the QR in one move.
  const closeLobbyNow = async () => {
    if (!lobbyCode || closingLobby) return;
    setClosingLobby(true);
    try {
      await closeLobby(lobbyCode);
      addToast('Lobby closed — the code no longer works.', 'success');
      reset();
    } catch (e: any) {
      addToast(e?.message || 'Could not close the lobby', 'error');
    } finally { setClosingLobby(false); }
  };

  const inviteFriends = async () => {
    const link = room?.url ? room.url : `${window.location.origin} (voice-only — join the Study Room)`;
    const text = goals
      ? `Hey! Join my study session: "${room?.name || 'Study Room'}". Goal: ${goals}. Link: ${link}`
      : `Hey! Join my study session: "${room?.name || 'Study Room'}". Link: ${link}`;
    await navigator.clipboard.writeText(text).catch(() => {});
    addToast('Invite message copied to clipboard!', 'success');
  };

  // ── Status helpers ────────────────────────────────────────────────────────
  const statusIcon = (s: Participant['status']) => {
    if (s === 'me')       return '🟢';
    if (s === 'muted')    return '🔇';
    if (s === 'deafened') return '🔕';
    return '🎙️';
  };
  const statusLabel = (s: Participant['status']) => {
    if (s === 'me')       return 'you';
    if (s === 'muted')    return 'muted';
    if (s === 'deafened') return 'deafened';
    return 'connected';
  };

  // ── Ready view ────────────────────────────────────────────────────────────
  if (phase === 'ready' && room) {
    return (
      <div className="animate-in" style={{ maxWidth: 780, margin: '0 auto' }}>
        <div className="dash-hero" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h2 className="dash-hero-title">{room.name || 'Study Room'}</h2>
            <p className="text-muted">
              {room.url
                ? 'Share this link with friends to join the video call.'
                : 'Voice-only mode. Share the invite below for others to join.'}
            </p>
          </div>
          <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Pro</span>
        </div>

        {/* Participants */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Participants
              <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8125rem', marginLeft: '0.4rem' }}>
                ({sessionRoster.length})
              </span>
            </h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={e => setVoiceEnabled(e.target.checked)}
              />
              Voice chat
            </label>
          </div>

          {sessionRoster.length === 0 ? (
            <p className="text-sm text-muted">Waiting for participants to join…</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {sessionRoster.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r)',
                  border: `1px solid ${p.status === 'me' ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                  <div className="avatar avatar-sm">{p.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                      {p.name}
                      {p.id === hostUserId && (
                        <span className="tag" style={{ marginLeft: '0.4rem', background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Host</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {statusIcon(p.status)} {statusLabel(p.status)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The group's shared material — the file everybody is studying,
            dropped right here in the lobby of the study room. */}
        {lobbyCode && (
          <RoomFilesPanel
            lobbyCode={lobbyCode}
            addToast={addToast}
            onStudyWithTutor={onStudyWithTutor}
            onQuizFiles={onQuizFiles}
            onDuelFiles={onDuelFiles}
            title="Shared material"
            hint="Drop in what the group is working on — everyone can study it, battle each other on it, or set a duel from it."
          />
        )}

        {/* Voice chat */}
        {voiceEnabled && signalingUrl && (
          <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <VoiceChat
                signalingUrl={signalingUrl}
                roomId={room.id}
                myPlayerId={userId}
                peerIds={peerIds}
                isVoiceActive={voiceEnabled}
              />
              <span className="text-xs text-muted">Mute / Deafen controls</span>
            </div>
          </div>
        )}

        {/* No signaling URL warning */}
        {voiceEnabled && !signalingUrl && (
          <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', borderColor: 'var(--warning)' }}>
            <p className="text-sm" style={{ color: 'var(--warning)' }}>
              ⚠️ Voice chat is not configured. Set <code>VITE_VOICE_SIGNALING_URL</code> in your Vercel environment variables.
            </p>
          </div>
        )}

        {/* Pomodoro timer */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 700 }}>Pomodoro Timer</h3>
          <div style={{ fontSize: '3rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: timerMode === 'focus' ? 'var(--accent)' : 'var(--warning)' }}>
            {formatTime(timeLeft)}
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem', textTransform: 'capitalize' }}>
            {timerMode === 'focus' ? '🍅 Focus time' : '☕ Break time'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={toggleTimer}>
              {timerRunning ? 'Pause' : 'Start'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={resetTimer}>Reset</button>
          </div>
        </div>

        {/* Session goals */}
        {goals && (
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 700 }}>Session Goals</h3>
            <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{goals}</p>
          </div>
        )}

        {/* Session notes */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 700 }}>Session Notes</h3>
          <textarea
            className="textarea"
            placeholder="Jot down quick notes during the study session..."
            value={sessionNotes}
            onChange={e => setSessionNotes(e.target.value)}
            rows={4}
          />
        </div>

        {/* Room link + actions */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <label className="text-muted text-xs">
            {room.url ? 'Room link' : 'Room link (voice-only — no video URL available)'}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input
              className="input"
              readOnly
              value={room.url ?? '(no video room — voice chat active above)'}
              onClick={e => room.url && (e.target as HTMLInputElement).select()}
              style={{ color: room.url ? undefined : 'var(--text-muted)', fontStyle: room.url ? undefined : 'italic' }}
            />
            {room.url && (
              <button className="btn btn-outline" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            )}
            <button
              className="btn btn-primary"
              onClick={joinIfReady}
              disabled={!room.url}
              title={room.url ? 'Open video call' : 'No video room — use voice chat above'}
            >
              Join call
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={inviteFriends}>📨 Invite friends</button>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '0.75rem' }}>
            Provider: <b>{room.provider === 'daily' ? 'Daily.co' : 'voice-only'}</b> · Max participants: {room.maxParticipants}
          </p>
          {room.provider !== 'daily' && (
            <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
              Add <code>DAILY_API_KEY</code> to your server environment to enable video rooms.
            </p>
          )}
        </div>

        {/* The lobby: a six-digit code, a share link and a QR code — all three
            point at the same lobby, so friends can use whichever is easiest. */}
        {lobbyCode && (
          <div style={{ marginBottom: '1rem' }}>
            <LobbyShare
              code={lobbyCode}
              label="Share this lobby"
              hint="Friends who join with this code are referred straight into this study session."
            />
          </div>
        )}

        {/* Tips accordion */}
        <div className="accordion">
          <button className="accordion-trigger" onClick={() => setTipsOpen(o => !o)}>
            <span>💡 Study room tips</span>
            <span style={{ fontSize: '0.8rem' }}>{tipsOpen ? '▼' : '▶'}</span>
          </button>
          {tipsOpen && (
            <div className="accordion-body">
              <ul>
                <li>Use the voice chat above to talk with your study partners in real time.</li>
                <li>If you have a video room (Daily.co), use "Join call" to open it in a new tab.</li>
                <li>Share your session goals in the invite so everyone arrives prepared.</li>
                <li>The Pomodoro timer keeps everyone in sync — 25 min focus, 5 min break.</li>
              </ul>
            </div>
          )}
        </div>

        {/* Done with the session? The host closes the lobby, which kills the
            code, the link and the QR in one move. Everyone else just leaves. */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Leave session</button>
          {lobbyCode && (!hostUserId || hostUserId === userId) && (
            <button className="btn btn-outline btn-sm" onClick={closeLobbyNow} disabled={closingLobby}>
              {closingLobby ? 'Closing…' : 'Close lobby'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Idle / creating view ──────────────────────────────────────────────────
  return (
    <div className="animate-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="sw-hero" style={{ marginBottom: '1.25rem' }}>
        <div className="sw-hero-main">
          <span className="sw-label">Create</span>
          <h2 className="sw-hero-title">Study Room</h2>
          <p className="sw-hero-sub">Create a private room to study with friends. Talk via voice chat, run a Pomodoro timer together, and take shared notes.</p>
        </div>
        {tier !== 'pro' && (
          <span className="sw-chip accent">Pro</span>
        )}
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <label className="text-muted text-xs">Room name</label>
        <input
          className="input"
          placeholder={`${userName}'s study session`}
          value={roomName}
          onChange={e => setRoomName(e.target.value)}
          style={{ margin: '0.35rem 0 1rem' }}
        />

        <label className="text-muted text-xs">Study session goals (optional)</label>
        <textarea
          className="textarea"
          placeholder="What do you want to accomplish? e.g. Review chapter 3, finish 20 flashcards..."
          value={goals}
          onChange={e => setGoals(e.target.value)}
          rows={2}
          style={{ margin: '0.35rem 0 1rem' }}
        />

        <button className="btn btn-primary" onClick={createRoom} disabled={phase === 'creating'}>
          {phase === 'creating' ? 'Creating…' : 'Create room'}
        </button>

        {tier !== 'pro' && (
          <p className="text-xs text-muted" style={{ marginTop: '0.75rem' }}>
            Upgrade to Pro to create study rooms with friends.
          </p>
        )}
        {phase === 'error' && (
          <p className="text-xs" style={{ marginTop: '0.75rem', color: 'var(--danger)' }}>
            Something went wrong. Try again, or contact support if it keeps failing.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: '1rem 1.25rem', marginTop: '1rem', background: 'var(--surface-1)' }}>
        <p className="text-xs text-muted">
          💡 <b>How it works:</b> Create a room, share the invite with friends, and use voice chat to talk together in real time.
          {!signalingUrl && ' (Voice chat requires VITE_VOICE_SIGNALING_URL to be configured.)'}
        </p>
      </div>
    </div>
  );
}
