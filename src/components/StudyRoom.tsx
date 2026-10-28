import { useCallback, useEffect, useRef, useState } from 'react';
import { createStudyRoom } from '../api/studyRoom';

interface Props {
  userId: string;
  userName: string;
  tier: string;
  setCurrentView: (v: string) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type StudyPhase = 'idle' | 'creating' | 'ready' | 'error';

type TimerMode = 'focus' | 'break';
const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;

export default function StudyRoom({ userId, userName, tier, setCurrentView, addToast }: Props) {
  const [phase, setPhase] = useState<StudyPhase>('idle');
  const [roomName, setRoomName] = useState('');
  const [room, setRoom] = useState<{ id: string; name: string; url: string | null; provider: string; maxParticipants: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [goals, setGoals] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [timerMode, setTimerMode] = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft] = useState(FOCUS_MINUTES * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [participants] = useState([
    { id: userId, name: userName, status: 'ready' as const },
    { id: 'p2', name: 'Alex', status: 'studying' as const },
    { id: 'p3', name: 'Jordan', status: 'away' as const },
  ]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  useEffect(() => {
    if (!timerRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerMode === 'focus') {
            setTimerMode('break');
            return BREAK_MINUTES * 60;
          } else {
            setTimerMode('focus');
            return FOCUS_MINUTES * 60;
          }
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

  const toggleTimer = useCallback(() => {
    setTimerRunning(r => !r);
  }, []);

  const resetTimer = useCallback(() => {
    setTimerRunning(false);
    setTimerMode('focus');
    setTimeLeft(FOCUS_MINUTES * 60);
  }, []);

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
      addToast('Study room created!', 'success');
    } catch (e: any) {
      setPhase('error');
      addToast(e?.message || 'Could not create room', 'error');
    }
  }, [roomName, tier, addToast, setCurrentView]);

  const joinIfReady = () => {
    if (!room?.url) return;
    const w = window.open(room.url, '_blank', 'noopener,noreferrer');
    if (!w) addToast('Popup blocked — allow popups for this site to join the room.', 'error');
  };

  const copyLink = async () => {
    if (!room?.url) return;
    await navigator.clipboard.writeText(room.url).catch(() => {});
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
  };

  const inviteFriends = async () => {
    const text = goals
      ? `Hey! Join my study session: "${roomName || 'Study Room'}". Goal: ${goals}. Link: ${room?.url}`
      : `Hey! Join my study session: "${roomName || 'Study Room'}". Link: ${room?.url}`;
    await navigator.clipboard.writeText(text).catch(() => {});
    addToast('Invite message copied to clipboard!', 'success');
  };

  if (phase === 'ready' && room) {
    return (
      <div className="animate-in" style={{ maxWidth: 780, margin: '0 auto' }}>
        <div className="dash-hero" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h2 className="dash-hero-title">{room.name || 'Study Room'}</h2>
            <p className="text-muted">Share this link with friends to join the call. You can share your screen and chat while you study together.</p>
          </div>
          <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Pro</span>
        </div>

        {/* Room preview */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 700 }}>Participants</h3>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {participants.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
                <div className="avatar avatar-sm">{p.name.charAt(0).toUpperCase()}</div>
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{p.name}</p>
                  <p className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>{p.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

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
          <label className="text-muted text-xs">Room link</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input className="input" readOnly value={room.url ?? ''} onClick={e => (e.target as HTMLInputElement).select()} />
            <button className="btn btn-outline" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            <button className="btn btn-primary" onClick={joinIfReady}>Join call</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={inviteFriends}>📨 Invite friends</button>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '0.75rem' }}>
            Provider: <b>{room.provider === 'daily' ? 'Daily.co' : 'local preview'}</b> · Max participants: {room.maxParticipants}
          </p>
          {room.provider !== 'daily' && (
            <p className="text-xs" style={{ marginTop: '0.5rem' }}>
              Add <code>DAILY_API_KEY</code> in your server environment to enable real video rooms.
            </p>
          )}
        </div>

        {/* Tips accordion */}
        <div className="accordion">
          <button
            className="accordion-trigger"
            onClick={() => setTipsOpen(o => !o)}
          >
            <span>💡 Study room tips</span>
            <span style={{ fontSize: '0.8rem' }}>{tipsOpen ? '▼' : '▶'}</span>
          </button>
          {tipsOpen && (
            <div className="accordion-body">
              <ul>
                <li>Use screen share to review notes or flashcards together.</li>
                <li>Chat is available inside the call.</li>
                <li>Leave the call anytime — the room closes after everyone disconnects.</li>
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

  return (
    <div className="animate-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="dash-hero" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h2 className="dash-hero-title">Study Room</h2>
          <p className="text-muted">Create a private video call to study with friends. Share your screen, review notes, and quiz each other live.</p>
        </div>
        {tier !== 'pro' && <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Pro</span>}
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
          💡 <b>How it works:</b> Create a room, copy the link, and share it with friends. The call supports screen share and in-call chat.
          {roomName === '' && ' Add a room name above to make it easier to recognize.'}
        </p>
      </div>
    </div>
  );
}
