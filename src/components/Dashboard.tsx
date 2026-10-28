import { Note, Contact, Flashcard, Folder, PracticeQuestion } from '../types';
import type { WeeklyInsights } from '../hooks/useAI';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { getStreakData, last7Days, EMPTY_STREAK } from '../db/streaks';
import type { StreakData } from '../db/schema';
import { useCountUp } from '../hooks/useCountUp';
import StreakRing from './StreakRing';

type Tier = 'free' | 'pro';

interface DashboardProps {
  notes: Note[];
  contacts: Contact[];
  flashcards: Flashcard[];
  tier: Tier;
  totalItems: number;
  aiSummariesThisMonth: number;
  qaQueriesThisMonth: number;
  folders: Folder[];
  practiceQuestions: PracticeQuestion[];
  setCurrentView: (view: string) => void;
  aiReady: boolean;
  aiProvider: string;
  onGenerateInsights: () => void;
  weeklyInsights: WeeklyInsights | null;
  insightsLoading: boolean;
}

// ── Study Goals (localStorage — lightweight, no IDB migration) ───────────────
interface StudyGoals {
  dailyFlashcards: number;
  dailyNotes: number;
  dailyStudyMinutes: number;
}

const DEFAULT_GOALS: StudyGoals = {
  dailyFlashcards: 20,
  dailyNotes: 3,
  dailyStudyMinutes: 60,
};

const GOALS_KEY = 'studyworks-goals';
const STUDY_LOG_KEY = 'studyworks-study-log';
const SESSIONS_KEY = 'studyworks-sessions';
const ACHIEVEMENTS_KEY = 'studyworks-achievements';

function loadGoals(): StudyGoals {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_GOALS;
}

function saveGoals(goals: StudyGoals) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
}

// ── Achievements ─────────────────────────────────────────────────────────────
interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: string;
}

const ALL_ACHIEVEMENTS: Omit<Achievement, 'unlocked' | 'unlockedAt'>[] = [
  { id: 'first_note',       icon: '📝', title: 'First Note',      description: 'Create your first note' },
  { id: 'first_flashcard',  icon: '💡', title: 'First Flashcard', description: 'Create your first flashcard' },
  { id: 'first_contact',    icon: '👥', title: 'First Contact',   description: 'Add your first contact' },
  { id: 'streak_7',         icon: '🔥', title: '7-Day Streak',    description: 'Maintain a 7-day study streak' },
  { id: 'streak_30',        icon: '🏆', title: '30-Day Streak',   description: 'Maintain a 30-day study streak' },
  { id: 'reviews_100',      icon: '⭐', title: 'Centurion',       description: 'Complete 100 reviews' },
  { id: 'reviews_500',      icon: '🌟', title: 'Master Reviewer', description: 'Complete 500 reviews' },
  { id: 'notes_10',         icon: '📚', title: 'Note Taker',      description: 'Create 10 notes' },
  { id: 'flashcards_50',    icon: '🧠', title: 'Flashcard Pro',   description: 'Create 50 flashcards' },
  { id: 'ai_first',         icon: '🤖', title: 'AI Explorer',     description: 'Generate your first AI insight' },
  { id: 'folder_organizer', icon: '📁', title: 'Organizer',       description: 'Create 3 folders' },
  { id: 'practice_20',      icon: '❓', title: 'Quiz Taker',      description: 'Complete 20 practice questions' },
];

function loadAchievements(): Achievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return ALL_ACHIEVEMENTS.map(a => ({ ...a, unlocked: false }));
}

function saveAchievements(achievements: Achievement[]) {
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements));
}

function evaluateAchievements(
  notes: Note[], contacts: Contact[], flashcards: Flashcard[],
  streak: StreakData, aiSummariesThisMonth: number,
  folders: Folder[], practiceQuestions: PracticeQuestion[]
): Achievement[] {
  const base = loadAchievements();
  const map = new Map(base.map(a => [a.id, a]));

  const check = (id: string, condition: boolean) => {
    const existing = map.get(id);
    if (existing && !existing.unlocked && condition) {
      map.set(id, { ...existing, unlocked: true, unlockedAt: new Date().toISOString() });
    }
  };

  check('first_note',       notes.length >= 1);
  check('first_flashcard',  flashcards.length >= 1);
  check('first_contact',    contacts.length >= 1);
  check('streak_7',         streak.currentStreak >= 7);
  check('streak_30',        streak.currentStreak >= 30);
  check('reviews_100',      streak.totalReviews >= 100);
  check('reviews_500',      streak.totalReviews >= 500);
  check('notes_10',         notes.length >= 10);
  check('flashcards_50',    flashcards.length >= 50);
  check('ai_first',         aiSummariesThisMonth >= 1);
  check('folder_organizer', folders.length >= 3);
  check('practice_20',      practiceQuestions.length >= 20);

  const result = Array.from(map.values());
  saveAchievements(result);
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getTrend(current: number, previous: number): { direction: 'up' | 'down' | 'neutral'; percent: number } {
  if (previous === 0) return { direction: current > 0 ? 'up' : 'neutral', percent: current > 0 ? 100 : 0 };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent > 0) return { direction: 'up', percent };
  if (percent < 0) return { direction: 'down', percent: Math.abs(percent) };
  return { direction: 'neutral', percent: 0 };
}

function countUpdatedThisWeek(items: { updatedAt: Date }[]): number {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return items.filter(item => new Date(item.updatedAt) >= weekAgo).length;
}

function countUpdatedLastWeek(items: { updatedAt: Date }[]): number {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return items.filter(item => {
    const d = new Date(item.updatedAt);
    return d >= twoWeeksAgo && d < weekAgo;
  }).length;
}

function getTodayMinutes(): number {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(STUDY_LOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === today) return parsed.minutes || 0;
    }
  } catch {}
  return 0;
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export default function Dashboard({ notes, contacts, flashcards, tier, totalItems, aiSummariesThisMonth, folders, practiceQuestions, setCurrentView, aiReady, aiProvider, onGenerateInsights, weeklyInsights, insightsLoading }: DashboardProps) {
  const stats = [
    { icon: '📝', label: 'Notes',       value: notes.length,           color: 'indigo',  view: 'notes',      items: notes as { updatedAt: Date }[] },
    { icon: '👥', label: 'People',      value: contacts.length,        color: 'violet',  view: 'contacts',   items: contacts as { updatedAt: Date }[] },
    { icon: '💡', label: 'Flashcards',  value: flashcards.length,      color: 'amber',   view: 'flashcards', items: flashcards as { updatedAt: Date }[] },
    { icon: '📁', label: 'Folders',     value: folders.length,         color: 'emerald', view: 'notes',      items: [] as { updatedAt: Date }[] },
    { icon: '❓', label: 'Practice Qs', value: practiceQuestions.length, color: 'rose',   view: 'flashcards', items: practiceQuestions as { updatedAt: Date }[] },
  ];

  const recentNotes = [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
  const overdueContacts = contacts.filter(c => c.nextReminder && new Date(c.nextReminder) < new Date()).length;
  const dueFlashcards = flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= new Date()).length;

  // ── Streak data ───────────────────────────────────────────────────────────
  const [streak, setStreak] = useState<StreakData>(EMPTY_STREAK);
  useEffect(() => {
    let alive = true;
    const reload = () => { getStreakData().then(s => { if (alive) setStreak(s); }); };
    reload();
    window.addEventListener('focus', reload);
    return () => { alive = false; window.removeEventListener('focus', reload); };
  }, [dueFlashcards]);

  // ── Goals ─────────────────────────────────────────────────────────────────
  const [goals, setGoals] = useState<StudyGoals>(loadGoals);
  const [showGoalEditor, setShowGoalEditor] = useState(false);

  const saveGoalsState = useCallback((newGoals: StudyGoals) => {
    setGoals(newGoals);
    saveGoals(newGoals);
  }, []);

  const updateGoal = useCallback((key: keyof StudyGoals, value: number) => {
    saveGoalsState({ ...goals, [key]: value });
  }, [goals, saveGoalsState]);

  // ── Achievements ──────────────────────────────────────────────────────────
  const [achievements, setAchievements] = useState<Achievement[]>(() =>
    evaluateAchievements(notes, contacts, flashcards, streak, aiSummariesThisMonth, folders, practiceQuestions)
  );

  useEffect(() => {
    setAchievements(evaluateAchievements(notes, contacts, flashcards, streak, aiSummariesThisMonth, folders, practiceQuestions));
  }, [notes, contacts, flashcards, streak, aiSummariesThisMonth, folders, practiceQuestions]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // ── Study Timer (Pomodoro) ────────────────────────────────────────────────
  const WORK_SECONDS = 25 * 60;
  const BREAK_SECONDS = 5 * 60;

  const [timerMode, setTimerMode] = useState<'work' | 'break'>('work');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(WORK_SECONDS);
  const [, setCompletedSessions] = useState(() => {
    try { return parseInt(localStorage.getItem(SESSIONS_KEY) || '0', 10); } catch { return 0; }
  });
  const [todaysStudyMinutes, setTodaysStudyMinutes] = useState(getTodayMinutes);

  const dailyStudyLogRef = useRef(todaysStudyMinutes);
  dailyStudyLogRef.current = todaysStudyMinutes;

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          if (timerMode === 'work') {
            const nextMinutes = dailyStudyLogRef.current + 25;
            setTodaysStudyMinutes(nextMinutes);
            localStorage.setItem(STUDY_LOG_KEY, JSON.stringify({ date: todayKey, minutes: nextMinutes }));
            setCompletedSessions(c => {
              const next = c + 1;
              localStorage.setItem(SESSIONS_KEY, next.toString());
              return next;
            });
            setTimerMode('break');
            return BREAK_SECONDS;
          } else {
            setTimerMode('work');
            setTimerRunning(false);
            return WORK_SECONDS;
          }
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, timerMode, todayKey]);

  const toggleTimer = useCallback(() => setTimerRunning(r => !r), []);
  const resetTimer = useCallback(() => {
    setTimerRunning(false);
    setTimerMode('work');
    setTimerSeconds(WORK_SECONDS);
  }, [WORK_SECONDS]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ── Activity Heatmap data (last 12 weeks) ─────────────────────────────────
  const heatmapDays = useMemo(() => {
    const days: { date: string; count: number; dayOfWeek: number; weekIndex: number }[] = [];
    const now = new Date();
    for (let i = 83; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        date: key,
        count: streak.dailyCounts[key] || 0,
        dayOfWeek: d.getDay(),
        weekIndex: Math.floor((83 - i) / 7),
      });
    }
    return days;
  }, [streak.dailyCounts]);

  // ── Goal progress ─────────────────────────────────────────────────────────
  const todayReviews = streak.dailyCounts[todayKey] || 0;
  const todayNotes = notes.filter(n => n.createdAt && new Date(n.createdAt).toISOString().slice(0, 10) === todayKey).length;

  // ── Stat trends ───────────────────────────────────────────────────────────
  const trends = useMemo(() => stats.map(s => ({
    ...s,
    trend: getTrend(countUpdatedThisWeek(s.items), countUpdatedLastWeek(s.items)),
  })), [stats]);

  // ── Dynamic Quick Tips ────────────────────────────────────────────────────
  const quickTips = useMemo(() => {
    const tips: { icon: string; text: string; action?: () => void }[] = [];
    if (notes.length === 0) tips.push({ icon: '📝', text: 'Create your first note to start building your knowledge base', action: () => setCurrentView('notes') });
    if (contacts.length === 0) tips.push({ icon: '👥', text: 'Add people and set reminders to stay connected', action: () => setCurrentView('contacts') });
    if (flashcards.length === 0) tips.push({ icon: '💡', text: 'Make flashcards for active recall — the most effective study technique', action: () => setCurrentView('flashcards') });
    if (!aiReady) tips.push({ icon: '🤖', text: 'Set up AI in Settings for summaries, Q&A, and smart insights', action: () => setCurrentView('settings') });
    if (streak.currentStreak === 0 && streak.totalReviews > 0) tips.push({ icon: '🔥', text: 'Your streak broke! Review a card today to restart it', action: () => setCurrentView('flashcards') });
    if (folders.length <= 1) tips.push({ icon: '📁', text: 'Organize with folders — create topic folders to group related items', action: () => setCurrentView('notes') });
    if (practiceQuestions.length === 0) tips.push({ icon: '❓', text: 'Practice questions test your knowledge under exam conditions', action: () => setCurrentView('flashcards') });
    if (tier === 'free' && totalItems > 30) tips.push({ icon: '💎', text: 'Upgrade to Pro for unlimited items, AI, and spaced repetition', action: () => setCurrentView('pricing') });
    if (tier === 'free' && totalItems <= 30) tips.push({ icon: '💎', text: 'Try Pro free — unlimited items, AI summaries, and more', action: () => setCurrentView('pricing') });
    if (streak.currentStreak >= 7 && streak.currentStreak < 30) tips.push({ icon: '🏆', text: 'Great streak! Keep it going to unlock the 30-day badge', action: () => setCurrentView('flashcards') });
    if (tips.length === 0) {
      tips.push({ icon: '🧠', text: 'Use Spaced Review daily for long-term retention' });
      tips.push({ icon: '⏰', text: 'Set revisit reminders on notes to reinforce learning' });
      tips.push({ icon: '📊', text: 'Check your weekly insights for personalised study guidance' });
    }
    return tips.slice(0, 5);
  }, [notes.length, contacts.length, flashcards.length, aiReady, streak.currentStreak, streak.totalReviews, folders.length, practiceQuestions.length, tier, totalItems, setCurrentView]);

  // ── Heatmap rows (7 days × 12 weeks) ──────────────────────────────────────
  const heatmapRows = useMemo(() => {
    return Array.from({ length: 7 }, (_, dayOfWeek) =>
      Array.from({ length: 12 }, (_, weekIndex) =>
        heatmapDays.find(d => d.weekIndex === weekIndex && d.dayOfWeek === dayOfWeek)
      )
    );
  }, [heatmapDays]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-in">
      {/* Hero */}
      <div className="dash-hero">
        <div>
          <h2 className="dash-hero-title">Welcome back 👋</h2>
          <p className="text-muted" style={{ marginTop: '0.35rem', fontSize: '0.9375rem' }}>
            Here's what's happening in your study workspace
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setCurrentView('flashcards')}>
            💡 Start Review
          </button>
          <button className="btn btn-secondary" onClick={toggleTimer}>
            ⏱️ {timerRunning ? 'Pause' : 'Start'} Focus Timer
          </button>
          {tier === 'free' && (
            <button className="btn btn-primary" onClick={() => setCurrentView('pricing')}>
              💎 Upgrade to Pro
            </button>
          )}
        </div>
      </div>

      {/* Study Timer */}
      {(timerRunning || timerSeconds < WORK_SECONDS) && (
        <div className="card study-timer-card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div className="study-timer-ring">
            <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-3)" strokeWidth="6" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke={timerMode === 'work' ? 'var(--accent)' : 'var(--success)'}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 42}
                strokeDashoffset={2 * Math.PI * 42 * (1 - timerSeconds / (timerMode === 'work' ? WORK_SECONDS : BREAK_SECONDS))}
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div className="study-timer-time">{formatTime(timerSeconds)}</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{timerMode === 'work' ? '🎯 Focus Time' : '☕ Break Time'}</div>
            <div className="text-sm text-muted">{timerMode === 'work' ? 'Stay focused — you\'ve got this!' : 'Rest your mind, recharge for the next round'}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={resetTimer}>Reset</button>
            <button className="btn btn-primary btn-sm" onClick={toggleTimer}>{timerRunning ? 'Pause' : 'Resume'}</button>
          </div>
        </div>
      )}

      {/* Streak widget */}
      <StreakWidget streak={streak} dueFlashcards={dueFlashcards} setCurrentView={setCurrentView} />

      {/* Activity Heatmap */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">📈 Activity</span>
          <span className="text-xs text-muted">Last 12 weeks</span>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: '0.25rem' }}>
          <div className="heatmap-grid">
            {heatmapRows.map((weekDays, dow) => (
              <div key={dow} className="heatmap-row">
                {dow === 1 && <span className="heatmap-label">Mon</span>}
                {dow === 3 && <span className="heatmap-label">Wed</span>}
                {dow === 5 && <span className="heatmap-label">Fri</span>}
                {(dow === 0 || dow === 2 || dow === 4 || dow === 6) && <span className="heatmap-label-spacer" />}
                {weekDays.map((day, wi) => {
                  if (!day) return <div key={wi} className="heatmap-cell level-0" />;
                  const level = day.count === 0 ? 0 : day.count <= 2 ? 1 : day.count <= 5 ? 2 : day.count <= 10 ? 3 : 4;
                  return (
                    <div
                      key={day.date}
                      className={`heatmap-cell level-${level}`}
                      title={`${day.date}: ${day.count} review${day.count === 1 ? '' : 's'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-legend">
          <span className="text-xs text-muted">Less</span>
          {[0, 1, 2, 3, 4].map(l => (
            <div key={l} className={`heatmap-cell level-${l}`} />
          ))}
          <span className="text-xs text-muted">More</span>
        </div>
      </div>

      {/* Study Goals */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">🎯 Daily Goals</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowGoalEditor(!showGoalEditor)}>
            {showGoalEditor ? 'Done' : 'Edit'}
          </button>
        </div>
        <div className="goals-grid">
          {[
            { key: 'flashcards', label: 'Flashcards', current: todayReviews, goal: goals.dailyFlashcards, icon: '💡', unit: 'reviews' },
            { key: 'notes',      label: 'Notes',      current: todayNotes,      goal: goals.dailyNotes,      icon: '📝', unit: 'new' },
            { key: 'minutes',    label: 'Study Time', current: todaysStudyMinutes, goal: goals.dailyStudyMinutes, icon: '⏱️', unit: 'min' },
          ].map(g => {
            const progress = Math.min(1, g.current / g.goal);
            const circumference = 2 * Math.PI * 18;
            const offset = circumference * (1 - progress);
            return (
              <div key={g.key} className="goal-item">
                <div className="goal-ring">
                  <svg viewBox="0 0 40 40" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <circle cx="20" cy="20" r="18" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
                    <circle cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
                  </svg>
                  <div className="goal-ring-text">{Math.round(progress * 100)}%</div>
                </div>
                <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{g.icon} {g.label}</div>
                  <div className="text-xs text-muted">{g.current} / {g.goal} {g.unit}</div>
                </div>
                {showGoalEditor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => updateGoal(g.key as keyof StudyGoals, Math.max(1, g.goal - 5))}>−</button>
                    <span className="text-sm" style={{ minWidth: '2rem', textAlign: 'center' }}>{g.goal}</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => updateGoal(g.key as keyof StudyGoals, g.goal + 5)}>+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Achievements */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">🏅 Achievements</span>
          <span className="text-xs text-muted">{unlockedCount} / {achievements.length}</span>
        </div>
        <div className="achievements-grid">
          {achievements.slice(0, 8).map(a => (
            <div key={a.id} className={`achievement-item ${a.unlocked ? 'unlocked' : 'locked'}`}>
              <div className="achievement-icon">{a.unlocked ? a.icon : '🔒'}</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8125rem' }}>{a.title}</div>
                <div className="text-xs text-muted">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid — with trend arrows and click-to-filter */}
      <div className="grid-stats stagger">
        {trends.map(s => (
          <TrendStatCard key={s.label} {...s} setCurrentView={setCurrentView} />
        ))}
      </div>

      {/* Alert row */}
      {(!aiReady || overdueContacts > 0 || dueFlashcards > 0) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {!aiReady && (
            <button
              className="card"
              onClick={() => setCurrentView('settings')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', border: '1px dashed var(--accent)', background: 'var(--accent-soft)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--accent)' }}>Set up AI</p>
                <p className="text-xs text-muted">Gemini is free — enable AI summaries, flashcards &amp; Q&amp;A</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>→</span>
            </button>
          )}
          {aiReady && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', flex: '1 1 220px', background: 'var(--success-soft)', border: '1px solid rgb(52 211 153 / .3)' }}>
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--success)' }}>AI active</p>
                <p className="text-xs text-muted">{aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} connected</p>
              </div>
            </div>
          )}
          {overdueContacts > 0 && (
            <button
              className="card"
              onClick={() => setCurrentView('contacts')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', background: 'var(--danger-soft)', border: '1px solid rgb(251 113 133 / .3)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>👥</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--danger)' }}>{overdueContacts} overdue reminder{overdueContacts > 1 ? 's' : ''}</p>
                <p className="text-xs text-muted">People you need to follow up with</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--danger)' }}>→</span>
            </button>
          )}
          {dueFlashcards > 0 && (
            <button
              className="card"
              onClick={() => setCurrentView('flashcards')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', background: 'var(--warning-soft)', border: '1px solid rgb(251 191 36 / .3)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>💡</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--warning)' }}>{dueFlashcards} card{dueFlashcards > 1 ? 's' : ''} due for review</p>
                <p className="text-xs text-muted">Start your spaced repetition session</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--warning)' }}>→</span>
            </button>
          )}
        </div>
      )}

      {/* Pro banner */}
      {tier === 'free' && (
        <div className="pro-banner" style={{ marginBottom: '1.75rem' }}>
          <span className="pro-banner-icon">💎</span>
          <div className="pro-banner-text">
            <p>Unlock Pro Features</p>
            <p>You've used {totalItems}/50 items · {aiSummariesThisMonth}/20 AI summaries this month</p>
          </div>
          <ul style={{ listStyle: 'none', fontSize: '0.8125rem', color: 'var(--text-2)', display: 'flex', flexWrap: 'wrap', gap: '0.375rem 1rem' }}>
            <li>✅ Unlimited items</li>
            <li>✅ Unlimited AI</li>
            <li>✅ File uploads</li>
            <li>✅ Spaced repetition</li>
            <li>✅ Smart Q&amp;A</li>
          </ul>
          <button className="btn btn-primary" onClick={() => setCurrentView('pricing')}>See plans</button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {/* Recent notes */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📝 Recent Notes</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentView('notes')}>View all →</button>
          </div>
          {recentNotes.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <div className="empty-state-icon">📝</div>
              <h3>No notes yet</h3>
              <p>Start capturing your knowledge</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {recentNotes.map(n => (
              <div key={n.id} className="score-row" style={{ cursor: 'pointer' }} onClick={() => setCurrentView('notes')}>
                <span style={{ fontSize: '1.1rem' }}>{n.type === 'article' ? '📰' : n.type === 'idea' ? '💡' : n.type === 'project' ? '🗂️' : '📄'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem' }} className="truncate">{n.title}</p>
                  <p className="text-xs text-muted" style={{ marginTop: '0.125rem' }}>{new Date(n.updatedAt).toLocaleDateString()}</p>
                </div>
                <span className="badge badge-primary" style={{ marginLeft: 'auto', flexShrink: 0 }}>{n.type}</span>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Weekly AI Insights */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🧠 Weekly Insights</span>
            {aiReady && (
              <button className="btn btn-ghost btn-sm" onClick={onGenerateInsights} disabled={insightsLoading}>
                {insightsLoading ? '⏳ Generating…' : '↺ Generate'}
              </button>
            )}
          </div>
          {!aiReady ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p className="text-sm text-muted">Connect an AI provider in Settings to get personalised weekly study insights.</p>
              <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCurrentView('settings')}>Set up AI →</button>
            </div>
          ) : !weeklyInsights ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <div className="empty-state-icon">🧠</div>
              <h3>No insights yet</h3>
              <p>Click Generate to get your weekly study digest</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📊</span>
                <p className="text-sm">{weeklyInsights.summary}</p>
              </div>
              {weeklyInsights.topTopics.length > 0 && (
                <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🏷️</span>
                  <p className="text-sm font-bold" style={{ marginRight: '0.25rem' }}>Top topics:</p>
                  {weeklyInsights.topTopics.map(t => <span key={t} className="tag primary">{t}</span>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>💡</span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.2rem' }}>Focus this week</p>
                  <p className="text-sm text-muted">{weeklyInsights.suggestedFocus}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📚</span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.2rem' }}>Review reminder</p>
                  <p className="text-sm text-muted">{weeklyInsights.reviewReminder}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Tips — dynamic */}
        <div className="card">
          <div className="card-header"><span className="card-title">🚀 Quick Tips</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {quickTips.map(tip => (
              <div
                key={tip.text}
                style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', cursor: tip.action ? 'pointer' : 'default' }}
                onClick={tip.action}
              >
                <span style={{ fontSize: '1rem', marginTop: '0.1rem' }}>{tip.icon}</span>
                <p className="text-sm text-muted">{tip.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StreakWidget (unchanged) ───────────────────────────────────────────────
function StreakWidget({ streak, dueFlashcards, setCurrentView }: { streak: StreakData; dueFlashcards: number; setCurrentView: (v: string) => void }) {
  const days = last7Days(streak);
  const todayCount = days[6] ?? 0;
  const maxDay = Math.max(...days, 1);

  const dayLabel = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - offset));
    return 'SMTWTFS'[d.getDay()];
  };

  const tier = streak.currentStreak >= 30 ? 'gold' : streak.currentStreak >= 7 ? 'silver' : streak.currentStreak >= 1 ? 'bronze' : 'none';
  const tierColor = tier === 'gold' ? '#f59e0b' : tier === 'silver' ? '#8A7D65' : tier === 'bronze' ? '#ea580c' : 'var(--muted)';
  const tierEmoji = tier === 'gold' ? '🏆' : tier === 'silver' ? '⚡' : tier === 'bronze' ? '🔥' : '💤';

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
      <StreakRing
        value={streak.currentStreak}
        progress={Math.min(1, streak.currentStreak / 30)}
        emoji={tierEmoji}
        color={tierColor}
      />
      <div style={{ minWidth: 150 }}>
        <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          Day streak
        </div>
        <div className="text-sm" style={{ marginTop: '0.15rem' }}>
          {streak.currentStreak === 0
            ? 'Start one today 💤'
            : <>best <span style={{ fontWeight: 700, color: 'var(--text)' }}>{streak.longestStreak}</span></>}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="text-sm" style={{ marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700 }}>{todayCount}</span>
          <span className="text-muted"> review{todayCount === 1 ? '' : 's'} today</span>
          {dueFlashcards > 0 && (
            <>
              <span className="text-muted"> · </span>
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{dueFlashcards} due now</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.375rem', height: 40 }}>
          {days.map((count, i) => (
            <div key={i} title={`${count} review${count === 1 ? '' : 's'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <div style={{
                width: '100%',
                height: `${Math.max(4, (count / maxDay) * 36)}px`,
                background: i === 6 ? 'var(--accent)' : (count > 0 ? 'var(--accent-soft)' : 'var(--surface-2)'),
                borderRadius: 4,
                transition: 'height 200ms ease',
              }} />
              <div className="text-xs text-muted" style={{ fontSize: '0.625rem' }}>{dayLabel(i)}</div>
            </div>
          ))}
        </div>
      </div>

      {dueFlashcards > 0 && (
        <button className="btn btn-primary" onClick={() => setCurrentView('flashcards')}>
          Start review →
        </button>
      )}
    </div>
  );
}

// ── TrendStatCard ──────────────────────────────────────────────────────────
// Extracted to avoid calling useCountUp inside .map() (Rules of Hooks).
function TrendStatCard({ icon, label, value, color, view, trend, setCurrentView }: {
  icon: string; label: string; value: number; color: string;
  view: string; trend: { direction: 'up' | 'down' | 'neutral'; percent: number };
  setCurrentView: (v: string) => void;
}) {
  const animated = useCountUp(value);
  return (
    <div
      className="stat-card"
      onClick={() => view && setCurrentView(view)}
      role="button"
      tabIndex={0}
      title={`View ${label}`}
    >
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="stat-value">{animated}</div>
        <div className="stat-label">{label}</div>
        {trend.direction !== 'neutral' && (
          <div className={`trend-indicator trend-${trend.direction}`}>
            {trend.direction === 'up' ? '↑' : '↓'} {trend.percent}%
          </div>
        )}
      </div>
      <span className="text-xs text-muted" style={{ fontSize: '0.625rem' }}>vs last week</span>
    </div>
  );
}
