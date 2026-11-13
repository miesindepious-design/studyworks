/**
 * Dashboard — the student's daily workspace.
 *
 * The page opens with an editorial masthead and a focus room (a live Pomodoro
 * dial), then a weekly rhythm card, subject cards and today's plan. Below
 * that sits everything the dashboard has always carried: daily goals, the
 * streak card, activity heatmap, achievements, stat tiles, action strips, the
 * Pro band, recent notes, weekly insights and quick tips.
 *
 * Every number on the page comes from real workspace data — props, the
 * streak store or local storage — so the layout can be redesigned without
 * inventing anything the student did not actually do.
 */
import { Note, Contact, Flashcard, Folder, PracticeQuestion } from '../types';
import type { WeeklyInsights } from '../hooks/useAI';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { getStreakData, last7Days, EMPTY_STREAK } from '../db/streaks';
import type { StreakData } from '../db/schema';
import { useCountUp } from '../hooks/useCountUp';
 import { useStudyGoals } from '../hooks/useStudyGoals';
import Ring from './Ring';
import Reveal from './Reveal';
import HeroDock from './HeroDock';
import FocusDial from './FocusDial';
import {
  IconFlame, IconTarget, IconNotes, IconCards, IconTimer,
  IconCrown, IconArrowRight, IconSparkles, IconLock, IconCheck,
  IconPlay, IconPause, IconDots, IconPlus, IconArrowUpRight,
} from './icons';

type Tier = 'free' | 'pro';

interface DashboardProps {
  userName?: string;
  trialDaysLeft?: number;
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

const STUDY_LOG_KEY = 'studyworks-study-log';
const SESSIONS_KEY = 'studyworks-sessions';
const ACHIEVEMENTS_KEY = 'studyworks-achievements';
const PLAN_KEY = 'studyworks-plan-done';

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

// Indexed by Date.getDay() (0 = Sunday).
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ── Subject model ────────────────────────────────────────────────────────────
interface SubjectCard {
  id: string;
  code: string;
  name: string;
  notes: number;
  cards: number;
  mastery: number;
  folderId?: string;
}

/** "Cognitive psychology" → "CP"; "Linear algebra" → "LA". */
function subjectCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'SUB';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

/** "09:30" for a reminder, "Now" for everything else. */
function formatClock(value?: Date | string): string {
  if (!value) return 'Now';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Now';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard({
  userName, trialDaysLeft = 0, notes, contacts, flashcards, tier, totalItems,
  aiSummariesThisMonth, folders, practiceQuestions, setCurrentView, aiReady,
  aiProvider, onGenerateInsights, weeklyInsights, insightsLoading,
}: DashboardProps) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  const displayName = (userName || '').trim();

  const recentNotes = useMemo(
    () => [...notes]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 4),
    [notes]
  );
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
  // Shared with the Settings page, so a target changed in either place is
  // reflected in both.
  const { goals, updateGoal } = useStudyGoals();
  const [showGoalEditor, setShowGoalEditor] = useState(false);

  // ── Achievements ──────────────────────────────────────────────────────────
  const [achievements, setAchievements] = useState<Achievement[]>(() =>
    evaluateAchievements(notes, contacts, flashcards, streak, aiSummariesThisMonth, folders, practiceQuestions)
  );
  const [achievementsCollapsed, setAchievementsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('studyworks-achievements-collapsed') === '1'; } catch { return false; }
  });
  const toggleAchievementsCollapsed = useCallback(() => {
    setAchievementsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('studyworks-achievements-collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

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
  const [completedSessions, setCompletedSessions] = useState(() => {
    try { return parseInt(localStorage.getItem(SESSIONS_KEY) || '0', 10); } catch { return 0; }
  });
  const [todaysStudyMinutes, setTodaysStudyMinutes] = useState(getTodayMinutes);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          if (timerMode === 'work') {
            const nextMinutes = todaysStudyMinutes + 25;
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
  }, [timerRunning, timerMode, todayKey, todaysStudyMinutes]);

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

  // ── Activity heatmap (last 14 weeks) ──────────────────────────────────────
  const WEEKS = 14;
  const heatmapWeeks = useMemo(() => {
    const weeks: { key: string; label: string; days: { date: string; count: number; dow: number }[] }[] = [];
    const now = new Date();
    // Start from the Monday of the current week, then walk backwards.
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

    for (let w = WEEKS - 1; w >= 0; w--) {
      const weekStart = new Date(monday);
      weekStart.setDate(monday.getDate() - w * 7);
      const days = Array.from({ length: 7 }, (_, dow) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + dow);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { date: key, count: streak.dailyCounts[key] || 0, dow };
      });
      const first = new Date(weekStart);
      weeks.push({
        key: first.toISOString().slice(0, 10),
        label: first.toLocaleDateString(undefined, { month: 'short' }),
        days,
      });
    }
    return weeks;
  }, [streak.dailyCounts]);

  // Month labels appear only when the month changes between weeks.
  const heatmapMonths = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    heatmapWeeks.forEach(w => {
      const last = out[out.length - 1];
      if (last && last.label === w.label) last.span += 1;
      else out.push({ label: w.label, span: 1 });
    });
    return out;
  }, [heatmapWeeks]);

  // ── Goal progress ─────────────────────────────────────────────────────────
  const todayReviews = streak.dailyCounts[todayKey] || 0;
  const todayNotes = notes.filter(n => n.createdAt && new Date(n.createdAt).toISOString().slice(0, 10) === todayKey).length;

  const goalRows = useMemo(() => ([
    { key: 'dailyStudyMinutes' as const, label: `Study ${goals.dailyStudyMinutes}m`,  current: todaysStudyMinutes, goal: goals.dailyStudyMinutes },
    { key: 'dailyFlashcards'   as const, label: `Revise ${goals.dailyFlashcards} cards`, current: todayReviews, goal: goals.dailyFlashcards },
    { key: 'dailyNotes'        as const, label: `Review ${goals.dailyNotes} notes`,  current: todayNotes, goal: goals.dailyNotes },
  ]), [goals, todaysStudyMinutes, todayReviews, todayNotes]);

  const weeklyGoalPct = useMemo(() => {
    const done = goalRows.reduce((sum, g) => sum + Math.min(1, g.current / g.goal), 0);
    return Math.round((done / goalRows.length) * 100);
  }, [goalRows]);

  // ── Stat tiles ────────────────────────────────────────────────────────────
  // Streak delta compares study days in the last 7 days against the 7 before,
  // which is what a learner actually feels week over week.
  const streakDelta = useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    let thisWeek = 0, lastWeek = 0;
    Object.entries(streak.dailyCounts).forEach(([key, count]) => {
      if (!count) return;
      const ts = new Date(`${key}T00:00:00`).getTime();
      if (ts >= now - day * 7) thisWeek += 1;
      else if (ts >= now - day * 14) lastWeek += 1;
    });
    return getTrend(thisWeek, lastWeek);
  }, [streak.dailyCounts]);

  const statRows = useMemo(() => [
    { icon: <IconFlame size={16} />, label: 'day streak', value: streak.currentStreak, view: 'flashcards', delta: streakDelta },
    { icon: <IconNotes size={16} />, label: 'notes', value: notes.length, view: 'notes',
      delta: getTrend(countUpdatedThisWeek(notes as { updatedAt: Date }[]), countUpdatedLastWeek(notes as { updatedAt: Date }[])) },
    { icon: <IconCards size={16} />, label: 'cards', value: flashcards.length, view: 'flashcards',
      delta: getTrend(countUpdatedThisWeek(flashcards as { updatedAt: Date }[]), countUpdatedLastWeek(flashcards as { updatedAt: Date }[])) },
    { icon: <IconTimer size={16} />, label: 'focused', value: `${todaysStudyMinutes}m`, view: 'timer',
      delta: { direction: 'neutral' as const, percent: 0 } },
  ], [streak, streakDelta, notes, flashcards, todaysStudyMinutes]);

  // ── Weekly insights chart ──────────────────────────────────────────────────
  const weekDays = useMemo(() => last7Days(streak), [streak]);
  const weekPeak = Math.max(...weekDays, 1);
  // Index of the busiest day — the chart highlights the real peak, not simply
  // the last column, which would light up whichever day happened to be today.
  const weekPeakIndex = useMemo(() => {
    let best = 0;
    weekDays.forEach((c, i) => { if (c > weekDays[best]) best = i; });
    return weekDays[best] > 0 ? best : -1;
  }, [weekDays]);

  // Monday-first labels for the last 7 days (oldest → newest).
  const weekLabels = useMemo(() => {
    const out: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(WEEKDAY_INITIALS[d.getDay()]);
    }
    return out;
  }, []);

  // ── Weekly rhythm totals ──────────────────────────────────────────────────
  // Reviews completed this week versus the week before, from the streak store.
  const weekTotals = useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    let thisWeek = 0, lastWeek = 0;
    Object.entries(streak.dailyCounts).forEach(([key, count]) => {
      if (!count) return;
      const ts = new Date(`${key}T00:00:00`).getTime();
      if (ts >= now - day * 7) thisWeek += count;
      else if (ts >= now - day * 14) lastWeek += count;
    });
    return { thisWeek, lastWeek, change: getTrend(thisWeek, lastWeek) };
  }, [streak.dailyCounts]);

  const bestDayLabel = useMemo(() => {
    if (weekPeakIndex < 0) return 'No reviews yet';
    const full = new Date();
    full.setDate(full.getDate() - (6 - weekPeakIndex));
    return full.toLocaleDateString(undefined, { weekday: 'short' });
  }, [weekPeakIndex]);

  // ── Subject cards ─────────────────────────────────────────────────────────
  // Subjects are the student's own folders. With no folders yet we fall back
  // to note types so the section is never empty for no reason.
  const subjectCards = useMemo<SubjectCard[]>(() => {
    const out: SubjectCard[] = [];

    for (const folder of folders) {
      const fNotes = notes.filter(n => n.folderId === folder.id);
      const fCards = flashcards.filter(c => c.folderId === folder.id);
      if (fNotes.length === 0 && fCards.length === 0) continue;

      const reviewed = fCards.filter(c => (c.repetitions ?? 0) > 0).length;
      const revisited = fNotes.filter(n => n.lastRevisited).length;
      const mastery = fCards.length
        ? Math.round((reviewed / fCards.length) * 100)
        : fNotes.length
          ? Math.round((revisited / fNotes.length) * 100)
          : 0;

      out.push({
        id: folder.id,
        folderId: folder.id,
        code: subjectCode(folder.name),
        name: folder.name,
        notes: fNotes.length,
        cards: fCards.length,
        mastery,
      });
    }

    if (out.length === 0) {
      const types: { key: Note['type']; label: string; code: string }[] = [
        { key: 'note',    label: 'Notes',    code: 'NOT' },
        { key: 'article', label: 'Articles', code: 'ART' },
        { key: 'idea',    label: 'Ideas',    code: 'IDE' },
        { key: 'project', label: 'Projects', code: 'PRJ' },
      ];
      for (const t of types) {
        const count = notes.filter(n => n.type === t.key).length;
        if (!count) continue;
        out.push({ id: t.key, code: t.code, name: t.label, notes: count, cards: 0, mastery: 0 });
      }
    }

    return out
      .sort((a, b) => (b.notes + b.cards) - (a.notes + a.cards))
      .slice(0, 3);
  }, [folders, notes, flashcards]);

  // ── Focus subject ─────────────────────────────────────────────────────────
  const [focusSubjectId, setFocusSubjectId] = useState<string>('');
  const focusedSubject = subjectCards.find(s => s.id === focusSubjectId) ?? subjectCards[0];

  const subjectDueCards = useMemo(() => {
    if (!focusedSubject?.folderId) return dueFlashcards;
    return flashcards.filter(c =>
      c.folderId === focusedSubject.folderId &&
      (!c.nextReview || new Date(c.nextReview) <= new Date())
    ).length;
  }, [focusedSubject, flashcards, dueFlashcards]);

  // ── Today's plan ──────────────────────────────────────────────────────────
  // Real, actionable items pulled from the workspace — nothing is invented.
  const planItems = useMemo(() => {
    const items: { id: string; title: string; sub: string; time: string; view: string }[] = [];

    if (dueFlashcards > 0) {
      items.push({
        id: 'cards',
        title: `Review ${dueFlashcards} flashcard${dueFlashcards === 1 ? '' : 's'}`,
        sub: 'Spaced repetition is due now',
        time: 'Now',
        view: 'flashcards',
      });
    }

    const overdueContact = contacts.find(c => c.nextReminder && new Date(c.nextReminder) < new Date());
    if (overdueContact) {
      items.push({
        id: 'reminders',
        title: `Follow up with ${overdueContact.name}`,
        sub: overdueContact.role || 'Reminder overdue',
        time: formatClock(overdueContact.nextReminder),
        view: 'contacts',
      });
    } else if (overdueContacts > 0) {
      items.push({
        id: 'reminders',
        title: `Clear ${overdueContacts} overdue reminder${overdueContacts === 1 ? '' : 's'}`,
        sub: 'People you meant to follow up with',
        time: 'Now',
        view: 'contacts',
      });
    }

    if (notes.length > 0) {
      items.push({
        id: 'notes',
        title: `Revisit ${Math.min(notes.length, 3)} note${notes.length === 1 ? '' : 's'}`,
        sub: 'Spaced repetition keeps material warm',
        time: 'Later',
        view: 'notes',
      });
    }

    if (aiReady) {
      items.push({
        id: 'ai',
        title: 'Ask the AI tutor',
        sub: `${aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} is ready when you are`,
        time: 'Now',
        view: 'tutor',
      });
    }

    if (items.length < 2) {
      items.push({
        id: 'focus',
        title: 'Start a focus session',
        sub: '25 minutes of one thing at a time',
        time: 'Now',
        view: 'timer',
      });
      items.push({
        id: 'room',
        title: 'Open the study room',
        sub: 'Learn alongside other students',
        time: 'Later',
        view: 'studyRoom',
      });
    }

    return items.slice(0, 4);
  }, [dueFlashcards, contacts, overdueContacts, notes.length, aiReady, aiProvider]);

  const [planDone, setPlanDone] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`${PLAN_KEY}-${todayKey}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const togglePlanDone = useCallback((id: string) => {
    setPlanDone(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem(`${PLAN_KEY}-${todayKey}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [todayKey]);

  const planDoneCount = planItems.filter(i => planDone.includes(i.id)).length;

  // ── Quick tips ────────────────────────────────────────────────────────────
  const quickTips = useMemo(() => {
    const tips: { icon: string; title: string; body: string; action?: () => void }[] = [];
    if (notes.length === 0) tips.push({ icon: '📝', title: 'Make it a small start', body: 'Create your first note — a single line is enough to begin.', action: () => setCurrentView('notes') });
    if (contacts.length === 0) tips.push({ icon: '👥', title: 'Recall, then review', body: 'Active recall beats re-reading every time.', action: () => setCurrentView('contacts') });
    if (flashcards.length === 0) tips.push({ icon: '💡', title: 'Turn notes into cards', body: 'Cards surface knowledge right before you forget it.', action: () => setCurrentView('flashcards') });
    if (!aiReady) tips.push({ icon: '🤖', title: 'Set up AI once', body: 'Summaries, Q&A and smart insights in a single click.', action: () => setCurrentView('settings') });
    if (streak.currentStreak === 0 && streak.totalReviews > 0) tips.push({ icon: '🔥', title: 'Restart the streak', body: 'One focused session today brings it back.', action: () => setCurrentView('flashcards') });
    if (streak.currentStreak >= 7 && streak.currentStreak < 30) tips.push({ icon: '🏆', title: 'Keep the run alive', body: 'You are close to the 30-day badge — don’t break the chain.', action: () => setCurrentView('flashcards') });
    if (tier === 'free') tips.push({ icon: '💎', title: 'Unlock more room', body: 'Pro removes the item cap and unlocks AI.', action: () => setCurrentView('pricing') });
    if (tips.length === 0) {
      tips.push({ icon: '🧠', title: 'Spaced review wins', body: 'Come back tomorrow — the gap is what builds memory.' });
      tips.push({ icon: '⏰', title: 'Set revisit reminders', body: 'Small nudges keep material warm.' });
      tips.push({ icon: '📊', title: 'Check your insights', body: 'Your weekly digest shows where to aim next.' });
    }
    return tips.slice(0, 3);
  }, [notes.length, contacts.length, flashcards.length, aiReady, streak.currentStreak, streak.totalReviews, tier, setCurrentView]);

  const now = new Date();
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const reviewMinutes = Math.max(1, Math.round((dueFlashcards || subjectDueCards) * 0.5));

  return (
    <div className="sw-stack animate-in">

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      {/* Sits in the normal flow on arrival, then flies up and sideways and
          parks itself in the top-right corner as a compact chip — the same
          behaviour as the Settings hero. */}
      <HeroDock
        side="right"
        bannerClassName="sw-masthead"
        chipIcon={(displayName.trim()[0] || 'A').toUpperCase()}
        chipLabel={greeting}
        chipMeta={displayName || undefined}
        chipBadge={trialDaysLeft > 0 ? {
          text: `${trialDaysLeft}d`,
          title: `Free Pro trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`,
        } : null}
        chipTitle="Back to top"
      >
        <div className="sw-masthead-text">
          <p className="sw-masthead-date">{todayLabel.toUpperCase()}</p>
          <h1 className="sw-masthead-title">
            Less noise.<span className="sw-masthead-em"> More knowledge.</span>
          </h1>
          <p className="sw-masthead-sub">
            {displayName ? `${greeting}, ${displayName}. ` : ''}
            Your space to think clearly, learn deeply, and keep moving.
          </p>
        </div>
        <div className="sw-masthead-meta">
          {trialDaysLeft > 0 && (
            <span className="sw-chip accent">Trial · {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}</span>
          )}
          <span className="sw-chip">{tier === 'pro' ? 'Pro plan' : 'Free plan'}</span>
          <span className="sw-chip">{totalItems} items</span>
          <span className="sw-streak-pill">
            <IconFlame size={15} />
            {streak.currentStreak}-day study streak
          </span>
        </div>
      </HeroDock>

      {/* ── Focus room + weekly rhythm ─────────────────────────────────── */}
      <section className="sw-grid sw-grid-main-side">

        {/* The focus room — a live Pomodoro dial */}
        <div className="sw-focus-room">
          <div className="sw-focus-copy">
            <p className="sw-focus-label">The focus room</p>
            <h2 className="sw-focus-title">One thing at a time.</h2>
            <p className="sw-focus-desc">
              A clear mind starts with a single session. Put everything else on pause.
            </p>

            <div className="sw-focus-controls">
              {subjectCards.length > 0 && (
                <select
                  className="sw-focus-select"
                  value={focusedSubject?.id ?? ''}
                  onChange={e => setFocusSubjectId(e.target.value)}
                  aria-label="Focus subject"
                >
                  {subjectCards.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              <button type="button" className="sw-focus-btn" onClick={toggleTimer}>
                {timerRunning ? <IconPause size={15} /> : <IconPlay size={15} />}
                {timerRunning ? 'Pause' : 'Start focusing'}
              </button>
              <button type="button" className="sw-focus-btn ghost" onClick={resetTimer}>
                Reset
              </button>
            </div>

            <p className="sw-focus-meta">
              25 min / 5 min break · {completedSessions} session{completedSessions === 1 ? '' : 's'} today
              {focusedSubject ? ` · ${focusedSubject.name}` : ''}
            </p>
          </div>

          <FocusDial
            seconds={timerSeconds}
            total={timerMode === 'work' ? WORK_SECONDS : BREAK_SECONDS}
            color={timerMode === 'work' ? 'var(--sw-accent)' : 'var(--sw-success)'}
          >
            <span className="sw-dial-tag">
              {timerMode === 'work' ? 'Focus / 01' : 'Break / 02'}
            </span>
            <span className="sw-dial-readout">{formatTime(timerSeconds)}</span>
            <span className="sw-dial-caption">
              {timerMode === 'work' ? 'Time to go deep' : 'Breathe in'}
            </span>
          </FocusDial>

          <p className="sw-focus-foot">Breathe in. Settle in.</p>
        </div>

        {/* Weekly rhythm */}
        <div className="sw-rhythm">
          <div className="sw-rhythm-head">
            <span className="sw-rhythm-title">Your weekly rhythm</span>
            <span className="sw-rhythm-more" aria-hidden="true"><IconDots size={18} /></span>
          </div>

          <div className="sw-rhythm-value-row">
            <span className="sw-rhythm-value">{weekTotals.thisWeek}</span>
            <span className="sw-rhythm-unit">reviews</span>
            <span
              className={`sw-rhythm-badge${
                weekTotals.change.direction === 'down' ? ' down'
                : weekTotals.change.direction === 'neutral' ? ' flat' : ''
              }`}
              title="Compared with the previous 7 days"
            >
              {weekTotals.change.direction === 'down' ? '↓ ' : weekTotals.change.direction === 'up' ? '↑ ' : ''}
              {weekTotals.change.percent}%
            </span>
          </div>
          <p className="sw-rhythm-sub">
            {weekTotals.thisWeek > 0
              ? 'Cards reviewed in the last 7 days'
              : 'Review a card to start your week'}
          </p>

          <div className="sw-rhythm-chart">
            <span className="sw-rhythm-grid" style={{ top: 0 }} />
            <span className="sw-rhythm-grid" style={{ top: '38%' }} />
            <span className="sw-rhythm-grid" style={{ top: '76%' }} />
            {weekDays.map((count, i) => {
              const height = Math.max(4, (count / weekPeak) * 100);
              return (
                <div
                  className={`sw-rhythm-col${i === weekPeakIndex ? ' peak' : ''}${count === 0 ? ' empty' : ''}`}
                  key={i}
                  title={`${count} review${count === 1 ? '' : 's'}`}
                >
                  <div className="sw-rhythm-bar" style={{ height: `${height}%` }} />
                  <div className="sw-rhythm-day">{weekLabels[i]}</div>
                </div>
              );
            })}
          </div>

          <div className="sw-rhythm-foot">
            <span className="sw-rhythm-note">Your time is adding up.</span>
            <span className="sw-rhythm-best">Best · {bestDayLabel}</span>
          </div>
        </div>
      </section>

      {/* ── Subjects + today's plan ────────────────────────────────────── */}
      <section className="sw-grid sw-grid-main-side">

        {/* Subjects */}
        <div>
          <div className="sw-section-head">
            <h2 className="sw-section-title">Your subjects</h2>
            <button type="button" className="sw-section-link" onClick={() => setCurrentView('notes')}>
              View all subjects <IconArrowRight size={13} />
            </button>
          </div>

          {subjectCards.length === 0 ? (
            <div className="sw-subject-empty">
              <div className="sw-empty">
                <div className="sw-empty-icon"><IconNotes size={20} /></div>
                <div className="sw-empty-title">No subjects yet</div>
                <div className="sw-empty-sub">Create a folder and it becomes a subject here</div>
                <button
                  type="button"
                  className="sw-btn secondary sm"
                  style={{ marginTop: 12 }}
                  onClick={() => setCurrentView('notes')}
                >
                  Open notes
                </button>
              </div>
            </div>
          ) : (
            <div className="sw-subject-grid">
              {subjectCards.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`sw-subject-card tint-${['a', 'b', 'c'][i % 3]}`}
                  onClick={() => setCurrentView('notes')}
                >
                  <div className="sw-subject-top">
                    <span className="sw-subject-code">{s.code}</span>
                    <span className="sw-subject-open" aria-hidden="true"><IconArrowUpRight size={15} /></span>
                  </div>
                  <span className="sw-subject-name">{s.name}</span>
                  <span className="sw-subject-meta">
                    {s.notes} note{s.notes === 1 ? '' : 's'} · {s.cards} flashcard{s.cards === 1 ? '' : 's'}
                  </span>
                  <span className="sw-subject-rule" />
                  <div className="sw-subject-mastery">
                    <span className="sw-subject-mastery-label">Mastery</span>
                    <span className="sw-subject-mastery-value">{s.mastery}%</span>
                  </div>
                  <div className="sw-subject-track">
                    <div className="sw-subject-fill" style={{ width: `${s.mastery}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Today's plan */}
        <div className="sw-plan">
          <div className="sw-plan-head">
            <span className="sw-plan-title">Today&rsquo;s plan</span>
            <span className="sw-plan-count">{planDoneCount} / {planItems.length}</span>
          </div>
          <p className="sw-plan-sub">A little structure goes a long way.</p>

          <div className="sw-plan-list">
            {planItems.map(item => {
              const done = planDone.includes(item.id);
              return (
                <div key={item.id} className={`sw-plan-item${done ? ' done' : ''}`}>
                  <button
                    type="button"
                    className="sw-plan-check"
                    onClick={() => togglePlanDone(item.id)}
                    aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
                    aria-pressed={done}
                  >
                    <IconCheck size={11} strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    className="sw-plan-body"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    onClick={() => setCurrentView(item.view)}
                  >
                    <span className="sw-plan-item-title">{item.title}</span>
                    <span className="sw-plan-item-sub">{item.sub}</span>
                  </button>
                  <span className="sw-plan-time">{item.time}</span>
                </div>
              );
            })}
          </div>

          <div className="sw-plan-foot">
            <button type="button" className="sw-plan-add" onClick={() => setCurrentView('notes')}>
              <IconPlus size={13} /> Add a task
            </button>
          </div>
        </div>
      </section>

      {/* ── Keep it fresh ──────────────────────────────────────────────── */}
      <section className="sw-recall">
        <div className="sw-recall-cards" aria-hidden="true">
          <div className="sw-recall-card back" />
          <div className="sw-recall-card front">Recall</div>
        </div>
        <div className="sw-recall-copy">
          <p className="sw-recall-label">Keep it fresh</p>
          <h2 className="sw-recall-title">A little recall. A lasting memory.</h2>
          <p className="sw-recall-sub">
            {subjectDueCards > 0
              ? `${subjectDueCards} flashcard${subjectDueCards === 1 ? '' : 's'} are ready for a quick review.`
              : 'Nothing is due right now — a good moment to look over your notes.'}
          </p>
        </div>
        <div className="sw-recall-actions">
          <span className="sw-recall-time">~ {reviewMinutes} min</span>
          <button type="button" className="sw-recall-btn" onClick={() => setCurrentView('flashcards')}>
            Quick review <IconArrowRight size={14} />
          </button>
        </div>
      </section>

      <hr className="sw-editorial-rule" />

      {/* ── Daily goals + streak ───────────────────────────────────────── */}
      <section className="sw-grid sw-grid-main-side">

        {/* Daily Goals */}
        <Reveal fill delay={0}>
          <div className="sw-panel">
            <div className="sw-panel-head">
              <div>
                <div className="sw-panel-title">Daily Goals</div>
                <div className="sw-panel-sub">{todayLabel}</div>
              </div>
              <div className="sw-panel-actions">
                <span className="sw-chip accent">{weeklyGoalPct}%</span>
                <button
                  type="button"
                  className="sw-btn ghost sm"
                  onClick={() => setShowGoalEditor(v => !v)}
                >
                  {showGoalEditor ? 'Done' : 'Edit'}
                </button>
              </div>
            </div>
            <div className="sw-row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="sw-hero-ring">
                <Ring value={weeklyGoalPct} size={116} thickness={8} label={`${weeklyGoalPct}%`} caption="weekly goal" />
              </div>
              <div className="sw-stack" style={{ gap: 13, flex: 1, minWidth: 190 }}>
                {goalRows.map(g => {
                  const pct = Math.min(100, Math.round((g.current / g.goal) * 100));
                  return (
                    <div className="sw-goal" key={g.key}>
                      <div className="sw-goal-top">
                        <span className="sw-goal-name">{g.label}</span>
                        <span className="sw-goal-pct">{pct}%</span>
                      </div>
                      <div className="sw-meter">
                        <div
                          className={`sw-meter-fill${pct >= 100 ? ' success' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {showGoalEditor && (
                        <div className="sw-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="sw-btn secondary sm"
                            onClick={() => updateGoal(g.key, Math.max(1, g.goal - 5))}
                          >−</button>
                          <span className="sw-goal-pct">{g.goal}</span>
                          <button
                            type="button"
                            className="sw-btn secondary sm"
                            onClick={() => updateGoal(g.key, g.goal + 5)}
                          >+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Reveal>

        {/* Keep it going */}
        <Reveal fill delay={70}>
          <div className="sw-panel">
            <div className="sw-panel-head">
              <div className="sw-panel-title">Keep it going</div>
              <IconFlame size={16} style={{ color: 'var(--sw-accent)' }} />
            </div>
            <div className="sw-row" style={{ gap: 16 }}>
              <Ring
                value={Math.min(100, (streak.currentStreak / 30) * 100)}
                size={86}
                thickness={6}
              >
                <div>
                  <div className="sw-ring-value" style={{ fontSize: '1.375rem' }}>{streak.currentStreak}</div>
                  <div className="sw-ring-caption">days</div>
                </div>
              </Ring>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="sw-tip-title">Current streak</p>
                <p className="sw-tip-body">A little, every day.</p>
              </div>
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 14 }}>
              <div className="sw-days">
                {weekDays.map((count, i) => (
                  <div
                    key={i}
                    className={`sw-day${count > 0 ? ' done' : ''}${i === 6 ? ' today' : ''}`}
                    title={`${count} review${count === 1 ? '' : 's'}`}
                  >
                    {weekLabels[i]}
                  </div>
                ))}
              </div>
              <p className="sw-panel-sub" style={{ marginTop: 10 }}>
                Best: {streak.longestStreak} days
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Activity + Achievements ────────────────────────────────────── */}
      <section className="sw-grid sw-grid-main-side">

        {/* Activity */}
        <Reveal fill delay={0}>
          <div className="sw-panel">
            <div className="sw-panel-head">
              <div>
                <div className="sw-panel-title">Activity</div>
                <div className="sw-panel-sub">Last 14 weeks</div>
              </div>
            </div>
            <div className="sw-row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <div className="sw-heat">
                  <div style={{ display: 'flex', gap: 3 }}>
                    {/* Day-of-week gutter */}
                    <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gap: 3, paddingTop: 16 }}>
                      {['M', 'W', 'F'].map((d, i) => (
                        <span
                          key={d}
                          style={{
                            fontSize: '0.5625rem',
                            color: 'var(--sw-text-faint)',
                            height: 11,
                            lineHeight: '11px',
                            gridRow: i * 2 + 1,
                          }}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {/* Month labels */}
                      <div className="sw-heat-months" style={{ gap: 3, height: 12 }}>
                        {heatmapMonths.map((m, i) => (
                          <span key={`${m.label}-${i}`} style={{ width: m.span * 14 - 3, lineHeight: '12px' }}>
                            {m.span > 1 || i === 0 ? m.label : ''}
                          </span>
                        ))}
                      </div>
                      <div className="sw-heat-body">
                        {heatmapWeeks.map(week => (
                          <div key={week.key} style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gap: 3 }}>
                            {week.days.map(day => {
                              const level = day.count === 0 ? 0 : day.count <= 2 ? 1 : day.count <= 5 ? 2 : day.count <= 10 ? 3 : 4;
                              return (
                                <div
                                  key={day.date}
                                  className={`sw-heat-cell l${level}`}
                                  title={`${day.date}: ${day.count} review${day.count === 1 ? '' : 's'}`}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="sw-heat-legend">
                  <span>Less</span>
                  {[0, 1, 2, 3, 4].map(l => <div key={l} className={`sw-heat-cell l${l}`} />)}
                  <span>More</span>
                </div>
              </div>

              <div style={{ minWidth: 132, paddingLeft: 18, borderLeft: '1px solid var(--sw-line-soft)' }}>
                <div style={{ fontFamily: 'var(--sw-font-display)', fontSize: '1.875rem', fontWeight: 600, letterSpacing: '-0.04em', color: 'var(--sw-text)', lineHeight: 1 }}>
                  {formatFocus(todaysStudyMinutes)}
                </div>
                <p className="sw-panel-sub" style={{ marginTop: 4 }}>focused today</p>
                {streak.totalReviews > 0 && (
                  <p className="sw-delta" style={{ marginTop: 10 }}>
                    {streak.totalReviews} reviews
                  </p>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        {/* Achievements */}
        <Reveal fill delay={70}>
          <div className="sw-panel">
            <div className="sw-panel-head">
              <div>
                <div className="sw-panel-title">Achievements</div>
                <div className="sw-panel-sub">{unlockedCount} of {achievements.length} unlocked</div>
              </div>
              <button
                type="button"
                className="sw-btn ghost sm"
                onClick={toggleAchievementsCollapsed}
              >
                {achievementsCollapsed ? 'Show all' : 'View all'}
              </button>
            </div>
            <div
              className="sw-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 14 }}
            >
              {(achievementsCollapsed ? achievements.slice(0, 4) : achievements.slice(0, 6)).map(a => (
                <div key={a.id} className={`sw-ach${a.unlocked ? '' : ' locked'}`}>
                  <div className="sw-ach-icon">
                    {a.unlocked ? a.icon : <IconLock size={15} />}
                  </div>
                  <div className="sw-ach-name">{a.unlocked ? a.title : 'Locked'}</div>
                  {!a.unlocked && <div className="sw-ach-note">{a.description}</div>}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Stat tiles ─────────────────────────────────────────────────── */}
      <section className="sw-grid sw-grid-4">
        {statRows.map((s, i) => (
          <Reveal key={s.label} fill delay={i * 60}>
            <StatTile
              icon={s.icon}
              label={s.label}
              value={s.value}
              delta={s.delta}
              onClick={() => setCurrentView(s.view)}
            />
          </Reveal>
        ))}
      </section>

      {/* ── Action strips ──────────────────────────────────────────────── */}
      <Reveal>
        <section className="sw-grid sw-grid-2">
          {dueFlashcards > 0 && (
            <button type="button" className="sw-alert" onClick={() => setCurrentView('flashcards')}>
              <span className="sw-alert-icon"><IconTarget size={16} /></span>
              <span className="sw-alert-body">
                <span className="sw-alert-title">{dueFlashcards} card{dueFlashcards > 1 ? 's are' : ' is'} due for review</span>
                <span className="sw-alert-sub">Keep your spaced repetition streak alive</span>
              </span>
              <span className="sw-alert-action">Review <IconArrowRight size={12} /></span>
            </button>
          )}
          {overdueContacts > 0 ? (
            <button type="button" className="sw-alert" onClick={() => setCurrentView('contacts')}>
              <span className="sw-alert-icon" style={{ background: 'var(--sw-danger-soft)', color: 'var(--sw-danger)' }}>
                <IconNotes size={16} />
              </span>
              <span className="sw-alert-body">
                <span className="sw-alert-title">{overdueContacts} reminder{overdueContacts > 1 ? 's are' : ' is'} overdue</span>
                <span className="sw-alert-sub">People you said you would follow up with</span>
              </span>
              <span className="sw-alert-action">Open <IconArrowRight size={12} /></span>
            </button>
          ) : aiReady ? (
            <button type="button" className="sw-alert info" onClick={() => setCurrentView('tutor')}>
              <span className="sw-alert-icon"><IconSparkles size={16} /></span>
              <span className="sw-alert-body">
                <span className="sw-alert-title">Your AI tutor has new suggestions</span>
                <span className="sw-alert-sub">{aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} is ready when you are</span>
              </span>
              <span className="sw-alert-action">Explore <IconArrowRight size={12} /></span>
            </button>
          ) : (
            <button type="button" className="sw-alert info" onClick={() => setCurrentView('settings')}>
              <span className="sw-alert-icon"><IconSparkles size={16} /></span>
              <span className="sw-alert-body">
                <span className="sw-alert-title">Connect an AI provider</span>
                <span className="sw-alert-sub">Summaries, Q&amp;A and smart insights in one click</span>
              </span>
              <span className="sw-alert-action">Set up <IconArrowRight size={12} /></span>
            </button>
          )}
          </section>
        </Reveal>

        {/* ── Pro band ───────────────────────────────────────────────────── */}
        {tier === 'free' ? (
          <Reveal>
            <section className="sw-promo">
              <span className="sw-promo-icon"><IconCrown size={18} /></span>
              <div className="sw-promo-body">
                <p className="sw-promo-title">Get 3 months of Pro free for students</p>
                <p className="sw-promo-sub">
                  More room for your notes. More ways to learn. Verify your student status.
                </p>
              </div>
              <div className="sw-promo-actions">
                <button type="button" className="sw-promo-link" onClick={() => setCurrentView('pricing')}>
                  Learn more
                </button>
                <button type="button" className="sw-btn primary" onClick={() => setCurrentView('pricing')}>
                  Upgrade
                </button>
              </div>
            </section>
          </Reveal>
        ) : (
          <Reveal>
            <section className="sw-promo">
              <span className="sw-promo-icon"><IconCrown size={18} /></span>
              <div className="sw-promo-body">
                <p className="sw-promo-title">
                  {trialDaysLeft > 0
                    ? `You have ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left on your Pro trial`
                    : 'Pro plan active'}
                </p>
                <p className="sw-promo-sub">
                  {trialDaysLeft > 0
                    ? 'Keep every feature unlocked while your trial runs.'
                    : 'Unlimited items, AI insights and spaced repetition.'}
                </p>
              </div>
              <div className="sw-promo-actions">
                <button type="button" className="sw-promo-link" onClick={() => setCurrentView('pricing')}>
                  Manage plan
                </button>
              </div>
            </section>
          </Reveal>
        )}

        {/* ── Bottom row ─────────────────────────────────────────────────── */}
        <section className="sw-grid sw-grid-3">

          {/* Recent Notes */}
          <Reveal fill delay={0}>
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div className="sw-panel-title">Recent Notes</div>
                <button type="button" className="sw-btn ghost sm" onClick={() => setCurrentView('notes')}>
                  View all
                </button>
              </div>
              {recentNotes.length === 0 ? (
                <div className="sw-empty">
                  <div className="sw-empty-icon"><IconNotes size={20} /></div>
                  <div className="sw-empty-title">No notes yet</div>
                  <div className="sw-empty-sub">Start capturing your knowledge</div>
                </div>
              ) : (
                <div className="sw-list">
                  {recentNotes.map(n => (
                    <div
                      key={n.id}
                      className="sw-list-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCurrentView('notes')}
                    >
                      <span
                        className="sw-list-dot"
                        style={{ background: NOTE_DOT_COLORS[n.type] || 'var(--sw-accent)' }}
                      />
                      <div className="sw-list-text">
                        <div className="sw-list-title">{n.title}</div>
                        <div className="sw-list-meta">{relativeTime(n.updatedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Reveal>

          {/* Weekly Insights */}
          <Reveal fill delay={70}>
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div className="sw-panel-title">Weekly Insights</div>
                {aiReady && (
                  <button
                    type="button"
                    className="sw-btn ghost sm"
                    onClick={onGenerateInsights}
                    disabled={insightsLoading}
                  >
                    {insightsLoading ? 'Generating…' : 'Generate'}
                  </button>
                )}
              </div>
              {!aiReady ? (
                <div className="sw-empty">
                  <div className="sw-empty-icon"><IconSparkles size={20} /></div>
                  <div className="sw-empty-title">Connect AI for insights</div>
                  <div className="sw-empty-sub">A weekly digest of what to study next</div>
                  <button
                    type="button"
                    className="sw-btn secondary sm"
                    style={{ marginTop: 12 }}
                    onClick={() => setCurrentView('settings')}
                  >
                    Set up AI
                  </button>
                </div>
              ) : (
                <>
                  <div className="sw-row" style={{ gap: 10, alignItems: 'baseline' }}>
                    <span
                      style={{
                        fontFamily: 'var(--sw-font-display)',
                        fontSize: '1.5rem',
                        fontWeight: 600,
                        letterSpacing: '-0.035em',
                        color: 'var(--sw-text)',
                      }}
                    >
                      {formatFocus(todaysStudyMinutes)}
                    </span>
                    {streak.totalReviews > 0 && (
                      <span className="sw-delta">
                        <IconCheck size={11} strokeWidth={2.6} />
                        {streak.totalReviews} reviews
                      </span>
                    )}
                  </div>
                  <div className="sw-chart" style={{ marginTop: 14 }}>
                    {weekDays.map((count, i) => {
                      const height = Math.max(6, (count / weekPeak) * 100);
                      return (
                        <div className={`sw-chart-col${i === weekPeakIndex ? ' peak' : ''}`} key={i}>
                          <div className="sw-chart-bar" style={{ height: `${height}%` }} />
                          <div className="sw-chart-day">{weekLabels[i]}</div>
                        </div>
                      );
                    })}
                  </div>
                  {weeklyInsights && (
                    <p className="sw-tip-body" style={{ marginTop: 12 }}>{weeklyInsights.summary}</p>
                  )}
                </>
              )}
            </div>
          </Reveal>

          {/* Quick Tips */}
          <Reveal fill delay={140}>
            <div className="sw-panel">
              <div className="sw-panel-head">
                <div className="sw-panel-title">Quick Tips</div>
              </div>
              <div>
                {quickTips.map((tip, i) => (
                  <div
                    key={tip.title}
                    className="sw-tip"
                    onClick={tip.action}
                    style={{ cursor: tip.action ? 'pointer' : 'default' }}
                  >
                    <span className="sw-tip-num">{i + 1}</span>
                    <div>
                      <div className="sw-tip-title">{tip.title}</div>
                      <div className="sw-tip-body">{tip.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
      </section>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOTE_DOT_COLORS: Record<string, string> = {
  note:    'var(--sw-accent)',
  article: 'var(--sw-info)',
  idea:    'var(--sw-success)',
  project: 'var(--sw-warning)',
};

/** "1h 24m" / "45m" — a compact focus-duration label. */
function formatFocus(minutes: number): string {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "12 min ago" / "Yesterday" — a compact relative timestamp. */
function relativeTime(value: Date | string): string {
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString();
}

// ── StatTile ─────────────────────────────────────────────────────────────────
// Extracted to avoid calling useCountUp inside .map() (Rules of Hooks).
function StatTile({
  icon, label, value, delta, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  delta: { direction: 'up' | 'down' | 'neutral'; percent: number };
  onClick: () => void;
}) {
  const numeric = typeof value === 'number' ? value : 0;
  const animated = useCountUp(numeric);
  const shown = typeof value === 'number' ? animated : value;

  return (
    <div
      className="sw-stat"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ cursor: 'pointer' }}
    >
      <div className="sw-stat-top">
        <span className="sw-stat-value">{shown}</span>
        <span className="sw-stat-icon">{icon}</span>
      </div>
      <div className="sw-row" style={{ gap: 8, marginTop: 2 }}>
        <span className="sw-stat-label">{label}</span>
        {delta.direction !== 'neutral' && (
          <span className={`sw-delta${delta.direction === 'down' ? ' down' : ''}`}>
            {delta.direction === 'up' ? '+' : '−'}{delta.percent}%
          </span>
        )}
      </div>
    </div>
  );
}
