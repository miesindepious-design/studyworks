/**
 * StudyTimer — Pomodoro timer with circular progress, daily session counter,
 * Web Audio beep, auto-start breaks, and localStorage persistence.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const FOCUS_MS = 25 * 60_000;

export interface TimerSettings {
  focusDuration: number;   // minutes
  breakDuration: number;   // minutes
  autoStartBreak: boolean;
  soundEnabled: boolean;
}
const DEFAULT_SETTINGS: TimerSettings = {
  focusDuration: 25,
  breakDuration: 5,
  autoStartBreak: false,
  soundEnabled:  true,
};

function loadSettings(): TimerSettings {
  try {
    const raw = localStorage.getItem('studyworks:timerSettings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function loadDailyCounters(): { count: number; date: string } {
  try {
    const raw = localStorage.getItem('studyworks:timerDaily');
    const today = new Date().toDateString();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === today) return parsed;
    }
  } catch {}
  return { count: 0, date: new Date().toDateString() };
}

function saveDailyCounters(counters: { count: number; date: string }) {
  localStorage.setItem('studyworks:timerDaily', JSON.stringify(counters));
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 880 : 660, now + offset);
      gain.gain.setValueAtTime(0.35, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Phase = 'focus' | 'break';

export default function StudyTimer() {
  const [settings, setSettings]     = useState<TimerSettings>(DEFAULT_SETTINGS);
  const [task, setTask]             = useState('');
  const [phase, setPhase]           = useState<Phase>('focus');
  const [remaining, setRemaining]   = useState(FOCUS_MS);
  const [running, setRunning]       = useState(false);
  const [counters, setCounters]     = useState<{ count: number; date: string }>({ count: 0, date: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask]   = useState(false);

  const rafRef    = useRef<number>(0);
  const lastTick  = useRef<number>(0);
  const endedRef  = useRef(false);

  // Hydrate settings + counters from localStorage once on mount.
  useEffect(() => {
    setSettings(loadSettings());
    setCounters(loadDailyCounters());
  }, []);

  // Recompute remaining whenever settings or phase changes while paused.
  useEffect(() => {
    if (!running) {
      const focusMs = settings.focusDuration * 60_000;
      const breakMs = settings.breakDuration * 60_000;
      setRemaining(phase === 'focus' ? focusMs : breakMs);
    }
  }, [settings.focusDuration, settings.breakDuration, phase, running]);

  // Persist settings.
  useEffect(() => {
    localStorage.setItem('studyworks:timerSettings', JSON.stringify(settings));
  }, [settings]);

  // Persist daily counters.
  useEffect(() => {
    if (counters.date) saveDailyCounters(counters);
  }, [counters]);

  // Tick loop.
  useEffect(() => {
    if (!running) { cancelAnimationFrame(rafRef.current); return; }
    lastTick.current  = performance.now();
    endedRef.current  = false;

    const tick = (now: number) => {
      const delta = now - lastTick.current;
      lastTick.current = now;
      setRemaining(prev => {
        const next = prev - delta;
        if (next <= 0 && !endedRef.current) {
          endedRef.current = true;
          if (settings.soundEnabled) playBeep();
          if (phase === 'focus') {
            setCounters(c => {
              const today = new Date().toDateString();
              const nextCounters = c.date === today
                ? { ...c, count: c.count + 1 }
                : { count: 1, date: today };
              saveDailyCounters(nextCounters);
              return nextCounters;
            });
            setPhase('break');
            setRunning(settings.autoStartBreak);
            return settings.breakDuration * 60_000;
          } else {
            setPhase('focus');
            setRunning(settings.autoStartBreak);
            return settings.focusDuration * 60_000;
          }
        }
        return Math.max(0, next);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, phase, settings]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const focusMs  = settings.focusDuration * 60_000;
  const breakMs  = settings.breakDuration * 60_000;
  const totalMs  = phase === 'focus' ? focusMs : breakMs;
  const progress = totalMs > 0 ? remaining / totalMs : 0;

  // SVG ring geometry.
  const R = 130, C = 2 * Math.PI * R;
  const dash = progress * C;
  const circumference = C;

  const label =
    phase === 'focus'
      ? '🎯 Focus'
      : '☕ Break';

  const handleReset = useCallback(() => {
    setRunning(false);
    endedRef.current = false;
    setPhase('focus');
    setRemaining(focusMs);
  }, [focusMs]);

  const toggleRunning = useCallback(() => {
    if (running) { setRunning(false); return; }
    endedRef.current = false;
    setRunning(true);
  }, [running]);

  const skipPhase = useCallback(() => {
    setRunning(false);
    endedRef.current = true;
    if (phase === 'focus') {
      setPhase('break');
      setRemaining(breakMs);
    } else {
      setPhase('focus');
      setRemaining(focusMs);
    }
  }, [phase, focusMs, breakMs]);

  const updateSetting = <K extends keyof TimerSettings>(key: K, value: TimerSettings[K]) => {
    setSettings(s => ({ ...s, [key]: value }));
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="animate-in" style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            ⏱️ Study Timer
          </h2>
          <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>
            Stay focused with Pomodoro sessions
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSettings(s => !s)}
            style={{ color: 'var(--text-2)' }}
          >
            ⚙️ Settings
          </button>
          <button className="icon-btn" onClick={handleReset} title="Reset timer" style={{ width: 38, height: 38 }}>
            🔄
          </button>
        </div>
      </div>

      {/* Timer card */}
      <div
        className="card"
        style={{
          marginBottom: '1.5rem',
          background: phase === 'focus'
            ? 'linear-gradient(135deg, var(--surface-1), var(--surface-0))'
            : 'linear-gradient(135deg, var(--accent-soft), var(--accent-soft-2))',
          borderColor: phase === 'focus' ? 'var(--border)' : 'rgb(99 102 241 / .28)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '1.5rem 0' }}>

          {/* Phase label */}
          <span
            className="badge"
            style={{
              fontSize: '0.8rem',
              padding: '0.3rem 0.9rem',
              background: phase === 'focus' ? 'var(--accent-soft)' : 'var(--accent)',
              color: phase === 'focus' ? 'var(--accent)' : 'var(--accent-ink)',
              border: `1px solid ${phase === 'focus' ? 'rgb(99 102 241 / .28)' : 'var(--accent)'}`,
            }}
          >
            {label}
          </span>

          {/* Circular progress ring */}
          <div className="timer-ring-wrap">
            <svg viewBox="0 0 300 300">
              <circle cx="150" cy="150" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
              <circle
                cx="150" cy="150" r={R} fill="none"
                stroke={phase === 'focus' ? 'url(#timerGrad)' : 'var(--accent)'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                style={{ transition: running ? 'none' : 'stroke-dasharray 0.5s ease' }}
              />
              <defs>
                <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="100%" stopColor="var(--accent-2)" />
                </linearGradient>
              </defs>
            </svg>

            {/* Center content */}
            <div className="timer-ring-center">
              <span style={{ fontSize: '3.25rem', fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(remaining)}
              </span>
              <span className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                {phase === 'focus' ? 'Focus time' : 'Break time'}
              </span>
            </div>
          </div>

          {/* Task label */}
          <div style={{ width: '100%', maxWidth: '360px' }}>
            {editingTask ? (
              <input
                className="input"
                value={task}
                onChange={e => setTask(e.target.value)}
                onBlur={() => setEditingTask(false)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingTask(false); }}
                placeholder="What are you studying?"
                autoFocus
                style={{ textAlign: 'center' }}
              />
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingTask(true)}
                style={{ width: '100%', color: 'var(--text-2)', fontStyle: task ? 'normal' : 'italic' }}
              >
                {task || '📝 Click to set a task…'}
              </button>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              className="btn btn-lg"
              onClick={skipPhase}
              disabled={!running && remaining === (phase === 'focus' ? focusMs : breakMs)}
              style={{ minWidth: 100, opacity: (!running && remaining === (phase === 'focus' ? focusMs : breakMs)) ? 0.4 : 1 }}
            >
              ⏭ Skip
            </button>

            <button
              className="btn btn-primary btn-lg"
              onClick={toggleRunning}
              style={{ minWidth: 140, boxShadow: '0 4px 24px var(--accent-glow)' }}
            >
              {running ? '⏸ Pause' : phase === 'focus' ? '▶ Start Focus' : '▶ Start Break'}
            </button>

            <button
              className="btn btn-secondary btn-lg"
              onClick={handleReset}
              style={{ minWidth: 100 }}
            >
              🔄 Reset
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div>
            <div className="stat-value">{counters.count}</div>
            <div className="stat-label">Pomodoros today</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⏱️</div>
          <div>
            <div className="stat-value">{counters.count * settings.focusDuration}</div>
            <div className="stat-label">Focus minutes today</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div>
            <div className="stat-value">{phase === 'focus' ? 'Focus' : 'Break'}</div>
            <div className="stat-label">Current phase</div>
          </div>
        </div>
      </div>

      {/* Timer settings panel */}
      {showSettings && (
        <div className="card study-timer-settings animate-in">
          <div className="card-header">
            <span className="card-title">⏱️ Timer Settings</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(false)} style={{ color: 'var(--text-3)' }}>
              Close
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Focus duration */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label">Focus duration</label>
                <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  {settings.focusDuration} min
                </span>
              </div>
              <input
                type="range" min="5" max="60" step="5"
                value={settings.focusDuration}
                onChange={e => updateSetting('focusDuration', +e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-xs text-muted">5 min</span>
                <span className="text-xs text-muted">60 min</span>
              </div>
            </div>

            {/* Break duration */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label">Break duration</label>
                <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  {settings.breakDuration} min
                </span>
              </div>
              <input
                type="range" min="1" max="30" step="1"
                value={settings.breakDuration}
                onChange={e => updateSetting('breakDuration', +e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-xs text-muted">1 min</span>
                <span className="text-xs text-muted">30 min</span>
              </div>
            </div>

            {/* Auto-start break */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Auto-start breaks</p>
                <p className="text-xs text-muted">Automatically start the break after each focus session.</p>
              </div>
              <button
                className="toggle"
                onClick={() => updateSetting('autoStartBreak', !settings.autoStartBreak)}
                role="switch" aria-checked={settings.autoStartBreak}
              />
            </div>

            {/* Sound on/off */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>🔔 Sound notification</p>
                <p className="text-xs text-muted">Play a chime when each session ends.</p>
              </div>
              <button
                className="toggle"
                onClick={() => {
                  const next = !settings.soundEnabled;
                  updateSetting('soundEnabled', next);
                  if (next) playBeep();
                }}
                role="switch" aria-checked={settings.soundEnabled}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
