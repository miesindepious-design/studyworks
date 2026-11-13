import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStudyRoom } from '../api/studyRoom';
import VoiceChat from './VoiceChat';

interface Props {
  userId: string;
  userName: string;
  tier: string;
  setCurrentView: (v: string) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  signalingUrl?: string;
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

export default function StudyRoom({ userId, userName, tier, setCurrentView, addToast, signalingUrl }: Props) {
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

  // VoiceChat fires custom DOM events so StudyRoom can reflect real peer state
  // without needing to share a socket ref.
  useEffect(() => {
    const onJoin = (e: Event) => {
      const { playerId } = (e as CustomEvent<{ playerId: string }>).detail;
      if (playerId === userId) return;
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
      setParticipants(prev => prev.map(p => {
        if (p.id !== playerId) return p;
        const status: Participant['status'] = isDeafened ? 'deafened' : isMuted ? 'muted' : 'connected';
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
  // decide who to call). Derived from participants so it stays in sync.
  const peerIds = useMemo(
    () => participants.filter(p => p.id !== userId).map(p => p.id),
    [participants, userId],
  );

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

  const reset = () => {
    setPhase('idle');
    setRoom(null);
    setRoomName('');
    setGoals('');
    setSessionNotes('');
    setTimerRunning(false);
    setTimerMode('focus');
    setTimeLeft(FOCUS_MINUTES * 60);
    setParticipants([]);
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
                ({participants.length})
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

          {participants.length === 0 ? (
            <p className="text-sm text-muted">Waiting for participants to join…</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {participants.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r)',
                  border: `1px solid ${p.status === 'me' ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                  <div className="avatar avatar-sm">{p.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{p.name}</p>
                    <p className="text-xs text-muted">
                      {statusIcon(p.status)} {statusLabel(p.status)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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

        <div style={{ marginTop: '1rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Create another room</button>
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
