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

export default function StudyRoom({ userName, tier, setCurrentView, addToast }: Props) {
  const [phase, setPhase] = useState<StudyPhase>('idle');
  const [roomName, setRoomName] = useState('');
  const [room, setRoom] = useState<{ id: string; name: string; url: string | null; provider: string; maxParticipants: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

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

        <div className="card" style={{ padding: '1.25rem' }}>
          <label className="text-muted text-xs">Room link</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input className="input" readOnly value={room.url ?? ''} onClick={e => (e.target as HTMLInputElement).select()} />
            <button className="btn btn-outline" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            <button className="btn btn-primary" onClick={joinIfReady}>Join call</button>
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

        <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>Study room tips</h3>
          <ul className="text-sm text-muted" style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <li>Use screen share to review notes or flashcards together.</li>
            <li>Chat is available inside the call.</li>
            <li>Leave the call anytime — the room closes after everyone disconnects.</li>
          </ul>
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
