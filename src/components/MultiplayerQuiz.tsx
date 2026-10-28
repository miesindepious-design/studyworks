import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSocket, ServerMessage } from '../lib/wsClient';
import {
  createGameRoom, getGameRoom, getGameTicket, startGameRoom, listMyGameRooms,
} from '../api/game';
import Celebration from './Celebration';
import type { PowerUpState, GameHistoryEntry, LobbyReaction } from '../types';

interface Props {
  db: { xp: number; setXp: (v: number | ((p: number) => number)) => void };
  userId: string;
  userName: string;
  tier: string;
  setCurrentView: (v: string) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface ChatLine { id: number; userId: string; name: string; text: string; mine: boolean; }
interface ScoreRow { userId: string; name: string; xp: number; ready?: boolean; }

type Phase = 'lobby' | 'live' | 'finished';

export default function MultiplayerQuiz({ db, userId, userName, tier, setCurrentView, addToast }: Props) {
  const [phase, setPhase] = useState<Phase>('lobby');
  const [myRooms, setMyRooms] = useState<Array<{ code: string; status: string; source: string; host: string; questionCount: number }>>([]);
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [perQuestionSec, setPerQuestionSec] = useState(15);

  const [players, setPlayers] = useState<ScoreRow[]>([]);
  const [question, setQuestion] = useState<{ index: number; total: number; prompt: string; options: string[]; questionId: string; deadline: number; explanation?: string } | null>(null);
  const [answerIdx, setAnswerIdx] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [hostId, setHostId] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<{ rank: number; xp: number } | null>(null);
  const [winnerName, setWinnerName] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [celebrate, setCelebrate] = useState<{ emoji: string; title: string; subtitle?: string } | null>(null);

  const [powerUps, setPowerUps] = useState<Record<string, PowerUpState>>({});
  const [streak, setStreak] = useState(0);
  const [pendingDouble, setPendingDouble] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);
  const [lobbyReactions, setLobbyReactions] = useState<LobbyReaction[]>([]);
  const [disabledOptions, setDisabledOptions] = useState<Set<number>>(new Set());

  const socketRef = useRef<GameSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(Date.now());
  const answeredRef = useRef(false);

  const refreshMyRooms = useCallback(() => {
    listMyGameRooms().then(setMyRooms).catch(() => {});
  }, []);

  useEffect(() => { refreshMyRooms(); }, [refreshMyRooms]);

  useEffect(() => {
    if (phase !== 'live' || !question) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [phase, question]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  useEffect(() => {
    setPowerUps(prev => {
      const next = { ...prev };
      players.forEach(p => {
        if (!next[p.userId]) {
          next[p.userId] = { fiftyFifty: true, extraTime: true, doublePoints: true, pendingDouble: false };
        }
      });
      return next;
    });
  }, [players]);

  const connect = useCallback(async (code: string) => {
    const { ticket } = await getGameTicket(code);
    const sock = new GameSocket();
    socketRef.current = sock;

    sock.connect(code.toUpperCase(), ticket, {
      onOpen: () => setConnected(true),
      onClose: () => { setConnected(false); },
      onMessage: (msg: ServerMessage) => handleMessage(msg, code.toUpperCase()),
    });
  }, []);

  const handleMessage = useCallback((msg: ServerMessage, code: string) => {
    switch (msg.type) {
      case 'player-joined':
      case 'player-left':
        getGameRoom(code).then(r => {
          setPlayers(r.players.map(p => ({ userId: p.userId, name: p.name, xp: p.xp })));
          setHostId(r.host.id);
          if (msg.type === 'player-joined') addToast(`${msg.name} joined`, 'info');
        }).catch(() => {});
        break;
      case 'scores':
        setPlayers(msg.scores);
        break;
      case 'question':
        setQuestion(msg);
        setAnswerIdx(null);
        setCorrectIdx(null);
        setRevealed(false);
        setDisabledOptions(new Set());
        answeredRef.current = false;
        setPhase('live');
        break;
      case 'reveal':
        setRevealed(true);
        setCorrectIdx(msg.answerIdx);
        break;
      case 'answer-ack':
        if (msg.userId === userId) {
          if (msg.correct) {
            setStreak(s => {
              const next = s + 1;
              if (next >= 2) addToast(`🔥 ${next}x streak!`, 'success');
              return next;
            });
          } else {
            setStreak(0);
          }
        }
        break;
      case 'chat':
        setChat(prev => [...prev, { id: Date.now() + Math.random(), userId: msg.userId, name: msg.name, text: msg.text, mine: msg.userId === userId }]);
        break;
      case 'finished':
        setPhase('finished');
        setPlayers(msg.ranking.map(r => ({ userId: r.userId, name: r.name, xp: r.xp })));
        const me = msg.ranking.find(r => r.userId === userId);
        setMyRank(me ? { rank: me.rank, xp: me.xp } : null);
        const win = msg.ranking.find(r => r.userId === msg.winnerId);
        setWinnerName(win?.name ?? null);
        if (me) {
          const earned = me.xp + (pendingDouble ? me.xp : 0);
          db.setXp(prev => prev + earned);
          setGameHistory(h => [...h, {
            id: Date.now().toString(),
            date: new Date(),
            opponent: msg.ranking.find(r => r.userId !== userId)?.name ?? 'Unknown',
            myScore: me.xp,
            opponentScore: msg.ranking.find(r => r.userId !== userId)?.xp ?? 0,
            result: me.rank === 1 ? 'win' : 'loss',
            xpEarned: earned,
            questionCount: question?.total ?? 0,
          }]);
          setTimeout(() => setCelebrate({
            emoji: me.rank === 1 ? '👑' : '🎉',
            title: me.rank === 1 ? 'You won!' : `Game over — rank #${me.rank}`,
            subtitle: `+${earned} XP earned (total ${db.xp + earned})`,
          }), 400);
        }
        setPendingDouble(false);
        setStreak(0);
        break;
      case 'room-ended':
        addToast('Room ended', 'info');
        setPhase('lobby');
        setConnected(false);
        refreshMyRooms();
        break;
      case 'error':
        addToast(msg.message, 'error');
        break;
      case 'lobby-reaction':
        setLobbyReactions(prev => [...prev.slice(-20), { emoji: msg.emoji, userId: msg.userId, userName: msg.userName, timestamp: Date.now() }]);
        break;
      case 'power-up-used':
        setPowerUps(prev => ({
          ...prev,
          [msg.userId]: { ...(prev[msg.userId] || { fiftyFifty: true, extraTime: true, doublePoints: true, pendingDouble: false }), [msg.powerUp === '50/50' ? 'fiftyFifty' : msg.powerUp === 'extra-time' ? 'extraTime' : 'doublePoints']: false }
        }));
        break;
    }
  }, [userId, db, addToast, refreshMyRooms, pendingDouble, question]);

  const handleCreate = async () => {
    if (tier !== 'pro') { addToast('Multiplayer quiz is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    setCreating(true);
    try {
      const { code } = await createGameRoom({ source: 'flashcards', perQuestionSec });
      await connect(code);
      refreshMyRooms();
      addToast(`Room ${code} created — share the code!`, 'success');
    } catch (e: any) {
      addToast(e?.message || 'Could not create room', 'error');
    } finally { setCreating(false); }
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      await getGameRoom(code);
      await connect(code);
    } catch (e: any) {
      addToast(e?.message || 'Room not found', 'error');
    }
  };

  const handleStart = async () => {
    if (!hostId) return;
    try { await startGameRoom(joinCodeOrCurrent()); }
    catch (e: any) { addToast(e?.message || 'Could not start', 'error'); }
  };

  const currentCodeRef = useRef('');
  const joinCodeOrCurrent = () => currentCodeRef.current || joinCode.trim().toUpperCase();
  useEffect(() => { if (connected) currentCodeRef.current = joinCode.trim().toUpperCase(); }, [connected, joinCode]);

  const sendAnswer = (idx: number) => {
    if (!question || answeredRef.current || revealed) return;
    answeredRef.current = true;
    setAnswerIdx(idx);
    socketRef.current?.sendAnswer(question.questionId, idx);
  };

  const usePowerUp = (type: '50/50' | 'extra-time' | 'double-points') => {
    const myPowerUps = powerUps[userId];
    if (!myPowerUps || !myPowerUps[type === '50/50' ? 'fiftyFifty' : type === 'extra-time' ? 'extraTime' : 'doublePoints']) return;
    if (!question || revealed) return;

    if (type === '50/50') {
      const wrongIdxs = question.options.map((_, i) => i).filter(i => i !== correctIdx);
      const toHide = wrongIdxs.sort(() => Math.random() - 0.5).slice(0, 2);
      setDisabledOptions(prev => new Set([...prev, ...toHide]));
    } else if (type === 'extra-time') {
      setQuestion(prev => prev ? { ...prev, deadline: prev.deadline + 10000 } : null);
    } else if (type === 'double-points') {
      setPendingDouble(true);
    }

    setPowerUps(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [type === '50/50' ? 'fiftyFifty' : type === 'extra-time' ? 'extraTime' : 'doublePoints']: false }
    }));
    socketRef.current?.sendPowerUp(joinCodeOrCurrent(), type);
    addToast(`Power-up used: ${type}`, 'success');
  };

  const sendReaction = (emoji: string) => {
    socketRef.current?.sendReaction(emoji);
    setLobbyReactions(prev => [...prev.slice(-20), { emoji, userId, userName, timestamp: Date.now() }]);
  };

  const sendChat = () => {
    const t = chatInput.trim();
    if (!t) return;
    socketRef.current?.sendChat(t);
    setChatInput('');
  };

  const leaveGame = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setPhase('lobby');
    setConnected(false);
    setQuestion(null);
    setPlayers([]);
    setChat([]);
    setPowerUps({});
    setStreak(0);
    setPendingDouble(false);
    setDisabledOptions(new Set());
    setIsSpectating(false);
    setLobbyReactions([]);
    refreshMyRooms();
  };

  const toggleSpectate = () => {
    const next = !isSpectating;
    setIsSpectating(next);
    socketRef.current?.toggleSpectate(joinCodeOrCurrent(), next);
    addToast(next ? 'Now spectating' : 'Left spectate mode', 'info');
  };

  if (phase === 'lobby' && !connected) {
    return (
      <div className="animate-in" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="dash-hero" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h2 className="dash-hero-title">Quiz Battle</h2>
            <p className="text-muted">Host a room with your flashcards, share the code, and play live. Use power-ups, build streaks for bonus XP, and climb the leaderboard.</p>
          </div>
          {tier !== 'pro' && <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Pro</span>}
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>🎯 Create a room</h3>
            <label className="text-muted text-xs">Seconds per question</label>
            <input className="input" type="number" min={5} max={60} value={perQuestionSec}
              onChange={e => setPerQuestionSec(Number(e.target.value))} style={{ margin: '0.35rem 0 1rem' }} />
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || tier !== 'pro'}>
              {creating ? 'Creating…' : 'Create room'}
            </button>
            {tier !== 'pro' && <p className="text-xs text-muted" style={{ marginTop: '0.75rem' }}>Upgrade to Pro to host live quiz games with friends.</p>}
          </div>

          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>🔑 Join a room</h3>
            <input className="input" placeholder="Enter room code" value={joinCode} maxLength={12}
              onChange={e => setJoinCode(e.target.value.toUpperCase())} style={{ marginBottom: '1rem', textTransform: 'uppercase' }} />
            <button className="btn btn-outline" onClick={handleJoin} disabled={!joinCode.trim()}>Join</button>
            {joinCode.trim() && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={toggleSpectate}>
                {isSpectating ? '👁 Stop spectating' : '👁 Spectate'}
              </button>
            )}
          </div>
        </div>

        {gameHistory.length > 0 && (
          <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0 }}>📜 Recent games</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(h => !h)}>
                {showHistory ? 'Hide' : 'Show'}
              </button>
            </div>
            {showHistory && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {gameHistory.slice().reverse().slice(0, 10).map(g => (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'var(--surface-1)', borderRadius: 'var(--radius)' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{g.result === 'win' ? '🏆' : '🎮'} vs {g.opponent}</span>
                      <span className="text-xs text-muted" style={{ marginLeft: '0.5rem' }}>{new Date(g.date).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <span className="text-sm">{g.myScore}-{g.opponentScore}</span>
                      <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>+{g.xpEarned} XP</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {myRooms.length > 0 && (
          <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>Your active rooms</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {myRooms.map(r => (
                <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span><b>{r.code}</b> · {r.status} · {r.questionCount} Qs</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setJoinCode(r.code); handleJoin(); }}>Rejoin</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: '1rem 1.25rem', marginTop: '1rem', background: 'var(--surface-1)' }}>
          <p className="text-xs text-muted">💡 <b>How it works:</b> Host picks their flashcards. Everyone joins with the code. Each question has a countdown — answer fast & correct for up to 2× XP. Build streaks for 2-5× multipliers. Use power-ups wisely. The highest XP at the end wins.</p>
        </div>
      </div>
    );
  }

  if (phase === 'lobby' && connected) {
    const code = currentCodeRef.current || joinCode.trim().toUpperCase();
    const isHost = hostId === userId;
    return (
      <div className="animate-in" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>⏳ Waiting room</h2>
          <p className="text-muted">Playing as <b>{userName}</b>. Share this code with friends to let them join:</p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', margin: '1rem 0' }}>
            <code style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: 3, color: 'var(--accent)' }}>{code}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(code)}>Copy</button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', margin: '0.75rem 0', flexWrap: 'wrap' }}>
            {['🔥', '👏', '🚀', '💪', '😎', '🤩'].map(emoji => (
              <button key={emoji} className="btn btn-ghost btn-sm" onClick={() => sendReaction(emoji)}>{emoji}</button>
            ))}
          </div>
          {lobbyReactions.length > 0 && (
            <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', opacity: 0.8, fontSize: '1.25rem' }}>
              {lobbyReactions.slice(-8).map((r, i) => (
                <span key={i} title={r.userName} style={{ animation: 'fadeIn 0.3s ease' }}>{r.emoji}</span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: '1rem 0', textAlign: 'left' }}>
            {players.map(p => {
              const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={p.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--surface-1)', borderRadius: 'var(--radius)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '0.75rem' }}>
                      {initials}
                    </div>
                    <span>{p.name}{p.userId === userId ? ' (you)' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {p.userId === hostId && <span className="tag">Host</span>}
                    <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>✓</span>
                  </div>
                </div>
              );
            })}
            {players.length === 0 && <p className="text-muted text-sm">No one here yet…</p>}
          </div>
          {isHost
            ? <button className="btn btn-primary" onClick={handleStart} disabled={players.length < 1}>Start game ▶</button>
            : <p className="text-muted">Waiting for the host to start…</p>}
          <div style={{ marginTop: '1rem' }}><button className="btn btn-ghost btn-sm" onClick={leaveGame}>Leave</button></div>
        </div>
      </div>
    );
  }

  const timeLeft = question ? Math.max(0, question.deadline - now) : 0;
  const timeFrac = question ? Math.min(1, timeLeft / (perQuestionSec * 1000)) : 0;
  const myPU = powerUps[userId] || { fiftyFifty: true, extraTime: true, doublePoints: true, pendingDouble: false };
  const streakMultiplier = streak >= 5 ? 5 : streak >= 2 ? streak : 1;
  const showStreak = streak >= 2;

  return (
    <div className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.25rem', alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="tag" style={{ background: connected ? 'var(--success-soft)' : 'var(--danger-soft)', color: connected ? 'var(--success-ink)' : 'var(--danger-ink)' }}>
              {connected ? '● Live' : '○ Connecting…'}
            </span>
            {showStreak && (
              <span className="tag" style={{ background: '#fff1f2', color: '#e11d48', animation: 'pulse 1s infinite' }}>
                🔥 {streak}x streak ({streakMultiplier}× XP)
              </span>
            )}
            {pendingDouble && <span className="tag" style={{ background: '#fef3c7', color: '#b45309' }}>2× Points active</span>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={leaveGame}>Leave</button>
        </div>

        {question && (
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span className="text-muted text-xs">Question {question.index + 1} / {question.total}</span>
              <span className="text-muted text-xs">{Math.ceil(timeLeft / 1000)}s</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', marginBottom: '1rem' }}>
              <div style={{
                height: '100%', width: `${timeFrac * 100}%`,
                background: timeFrac > 0.4 ? 'linear-gradient(90deg,var(--accent),var(--accent-2))' : 'var(--danger)',
                transition: 'width 0.1s linear',
              }} />
            </div>

            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', lineHeight: 1.4 }}>{question.prompt}</h3>

            {!revealed && !answeredRef.current && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <button className="power-chip btn-sm" disabled={!myPU.fiftyFifty} onClick={() => usePowerUp('50/50')} data-tooltip="Remove 2 wrong answers" style={{ borderRadius: 'var(--r-full)' }}>
                  🎯 50/50
                </button>
                <button className="power-chip btn-sm" disabled={!myPU.extraTime} onClick={() => usePowerUp('extra-time')} data-tooltip="+10 seconds" style={{ borderRadius: 'var(--r-full)' }}>
                  ⏰ +10s
                </button>
                <button className="power-chip btn-sm" disabled={!myPU.doublePoints} onClick={() => usePowerUp('double-points')} data-tooltip="Next answer worth 2x" style={{ borderRadius: 'var(--r-full)' }}>
                  ✨ 2× Points
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {question.options.map((opt, i) => {
                if (disabledOptions.has(i)) return null;
                const isAnswer = revealed && i === correctIdx;
                const isChosenWrong = revealed && answeredRef.current && answerIdx === i && i !== correctIdx;
                let cls = 'quiz-option';
                if (isAnswer) cls += ' correct';
                else if (isChosenWrong) cls += ' wrong';
                return (
                  <button
                    key={i}
                    className={cls}
                    disabled={revealed || answeredRef.current}
                    onClick={() => sendAnswer(i)}
                  >
                    <span className="option-letter">{String.fromCharCode(65 + i)}</span>
                    <span style={{ flex: 1 }}>{opt}</span>
                    {isAnswer && <span style={{ marginLeft: 'auto' }}>✓</span>}
                    {isChosenWrong && <span style={{ marginLeft: 'auto' }}>✕</span>}
                  </button>
                );
              })}
            </div>

            {revealed && question.explanation && (
              <div style={{ marginTop: '1rem', padding: '0.875rem 1rem', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.9rem' }}>💡 Explanation</p>
                <p className="text-sm text-muted" style={{ margin: 0 }}>{question.explanation}</p>
              </div>
            )}

            {revealed && (
              <p className="text-muted text-sm" style={{ marginTop: '1rem' }}>
                {answeredRef.current ? (answerIdx !== null ? 'Answer locked in.' : '') : 'Time\'s up!'}
              </p>
            )}
          </div>
        )}

        {phase === 'finished' && (
          <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem', textAlign: 'center',
            background: myRank?.rank === 1 ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--surface-2)' }}>
            <h2 style={{ marginBottom: '0.25rem' }}>{myRank?.rank === 1 ? '👑 You won!' : `Game over — you placed #${myRank?.rank ?? '?'}`}</h2>
            {winnerName && winnerName !== userName && <p className="text-muted">Winner: <b>{winnerName}</b></p>}
            {myRank && <p style={{ fontWeight: 700 }}>{myRank.xp} XP earned this round</p>}
          </div>
        )}

        <div className="card" style={{ padding: '1.25rem', marginTop: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>🏆 Scoreboard</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {[...players].sort((a, b) => b.xp - a.xp).map((p, i) => (
              <div key={p.userId} className="score-row">
                <span style={{ width: 22, fontWeight: 700, opacity: 0.7 }}>{i + 1}</span>
                <div className="avatar avatar-sm">{p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
                <span style={{ flex: 1 }}>{p.name}{p.userId === userId && ' (you)'}</span>
                <span className="badge badge-primary">{p.xp} XP</span>
              </div>
            ))}
            {players.length === 0 && <p className="text-muted text-sm">Waiting for players…</p>}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', height: '70vh', position: 'sticky', top: 12 }}>
        <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem' }}>💬 Live chat</h3>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: 4 }}>
          {chat.map(line => (
            <div key={line.id} style={{ textAlign: line.mine ? 'right' : 'left' }}>
              <div className={`chat-bubble ${line.mine ? 'chat-bubble-mine' : 'chat-bubble-other'}`}>
                {!line.mine && <b style={{ fontSize: '0.72rem', opacity: 0.7, display: 'block', marginBottom: '0.15rem' }}>{line.name}</b>}
                {line.text}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <input className="input" placeholder="Message…" value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()} style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={sendChat}>Send</button>
        </div>
      </div>

      {celebrate && <Celebration emoji={celebrate.emoji} title={celebrate.title} subtitle={celebrate.subtitle} onClose={() => setCelebrate(null)} />}
    </div>
  );
}
