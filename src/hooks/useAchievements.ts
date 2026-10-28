import { useState, useEffect, useCallback } from 'react';

export type AchievementId =
  | 'streak_7'
  | 'streak_30'
  | 'streak_100'
  | 'reviews_100'
  | 'notes_50'
  | 'cards_20'
  | 'first_game'
  | 'invite_friend'
  | 'ai_summaries_10'
  | 'tutor_5';

export interface Achievement {
  id: AchievementId;
  title: string;
  description: string;
  category: 'streaks' | 'study' | 'social' | 'ai';
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic';
  target: number;
  statKey: 'flashcardsReviewed' | 'notesCreated' | 'studyMinutes' | 'aiSummaries' | 'tutorSessions' | 'gamesPlayed' | 'friendsInvited' | 'streakDays';
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'streak_7',
    title: '7-Day Streak',
    description: 'Study for 7 days in a row',
    category: 'streaks',
    icon: '🔥',
    rarity: 'common',
    target: 7,
    statKey: 'streakDays',
  },
  {
    id: 'streak_30',
    title: '30-Day Streak',
    description: 'Maintain a 30-day study streak',
    category: 'streaks',
    icon: '⚡',
    rarity: 'rare',
    target: 30,
    statKey: 'streakDays',
  },
  {
    id: 'streak_100',
    title: '100-Day Streak',
    description: 'Achieve a legendary 100-day streak',
    category: 'streaks',
    icon: '🏆',
    rarity: 'epic',
    target: 100,
    statKey: 'streakDays',
  },
  {
    id: 'reviews_100',
    title: 'Century Reviewer',
    description: 'Review 100 flashcards',
    category: 'study',
    icon: '📚',
    rarity: 'common',
    target: 100,
    statKey: 'flashcardsReviewed',
  },
  {
    id: 'notes_50',
    title: 'Note Taker',
    description: 'Create 50 notes',
    category: 'study',
    icon: '📝',
    rarity: 'uncommon',
    target: 50,
    statKey: 'notesCreated',
  },
  {
    id: 'cards_20',
    title: 'Flashcard Creator',
    description: 'Create 20 flashcards',
    category: 'study',
    icon: '💡',
    rarity: 'common',
    target: 20,
    statKey: 'flashcardsReviewed',
  },
  {
    id: 'first_game',
    title: 'First Steps',
    description: 'Play your first quiz game',
    category: 'social',
    icon: '🎮',
    rarity: 'common',
    target: 1,
    statKey: 'gamesPlayed',
  },
  {
    id: 'invite_friend',
    title: 'Social Butterfly',
    description: 'Invite a friend to study together',
    category: 'social',
    icon: '🤝',
    rarity: 'uncommon',
    target: 1,
    statKey: 'friendsInvited',
  },
  {
    id: 'ai_summaries_10',
    title: 'AI Scholar',
    description: 'Generate 10 AI summaries',
    category: 'ai',
    icon: '🤖',
    rarity: 'rare',
    target: 10,
    statKey: 'aiSummaries',
  },
  {
    id: 'tutor_5',
    title: 'Tutor Apprentice',
    description: 'Complete 5 AI tutor sessions',
    category: 'ai',
    icon: '🎓',
    rarity: 'uncommon',
    target: 5,
    statKey: 'tutorSessions',
  },
];

const RARITY_COLORS: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  common: { border: 'rgb(148 163 184 / .4)', bg: 'rgb(148 163 184 / .08)', text: '#94a3b8', glow: 'rgb(148 163 184 / .15)' },
  uncommon: { border: 'rgb(52 211 153 / .4)', bg: 'rgb(52 211 153 / .08)', text: '#34d399', glow: 'rgb(52 211 153 / .15)' },
  rare: { border: 'rgb(56 189 248 / .4)', bg: 'rgb(56 189 248 / .08)', text: '#38bdf8', glow: 'rgb(56 189 248 / .15)' },
  epic: { border: 'rgb(168 85 247 / .4)', bg: 'rgb(168 85 247 / .08)', text: '#a855f7', glow: 'rgb(168 85 247 / .15)' },
};

export function getRarityStyle(rarity: string) {
  return RARITY_COLORS[rarity] || RARITY_COLORS.common;
}

export function useAchievements() {
  const [stats, setStats] = useState({
    flashcardsReviewed: 0,
    notesCreated: 0,
    studyMinutes: 0,
    aiSummaries: 0,
    tutorSessions: 0,
    gamesPlayed: 0,
    friendsInvited: 0,
    streakDays: 0,
  });

  const [unlocked, setUnlocked] = useState<AchievementId[]>([]);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Achievement | null>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sw-achievement-stats');
      if (saved) setStats(JSON.parse(saved));
      const savedUnlocked = localStorage.getItem('sw-unlocked-achievements');
      if (savedUnlocked) setUnlocked(JSON.parse(savedUnlocked));
    } catch {
      // ignore
    }
  }, []);

  const persist = useCallback((s: typeof stats, u: AchievementId[]) => {
    localStorage.setItem('sw-achievement-stats', JSON.stringify(s));
    localStorage.setItem('sw-unlocked-achievements', JSON.stringify(u));
  }, []);

  const updateStats = useCallback((patch: Partial<typeof stats>) => {
    setStats(prev => {
      const next = { ...prev, ...patch };
      persist(next, unlocked);
      return next;
    });
  }, [persist, unlocked]);

  // Check achievements whenever stats or unlocked list changes
  useEffect(() => {
    const toUnlock: Achievement[] = [];
    ACHIEVEMENTS.forEach(a => {
      if (!unlocked.includes(a.id)) {
        const current = stats[a.statKey] || 0;
        if (current >= a.target) {
          toUnlock.push(a);
        }
      }
    });

    if (toUnlock.length > 0) {
      setUnlocked(prev => {
        const next = [...prev, ...toUnlock.map(a => a.id)];
        persist(stats, next);
        return next;
      });
      setNewlyUnlocked(toUnlock[toUnlock.length - 1]);
    }
  }, [stats, unlocked, persist]);

  const dismissCelebration = useCallback(() => setNewlyUnlocked(null), []);

  const progress = useCallback((achievement: Achievement) => {
    const current = stats[achievement.statKey] || 0;
    return Math.min(1, current / achievement.target);
  }, [stats]);

  const isUnlocked = useCallback((id: AchievementId) => unlocked.includes(id), [unlocked]);

  return {
    stats,
    unlocked,
    updateStats,
    progress,
    isUnlocked,
    newlyUnlocked,
    dismissCelebration,
    allAchievements: ACHIEVEMENTS,
  };
}
