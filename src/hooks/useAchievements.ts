/**
 * useAchievements — the achievements view of the progression store.
 *
 * This used to keep its own counters in localStorage, which meant the
 * achievements could never actually unlock: nothing ever called
 * `updateStats`, and the numbers died with the browser. The counters now live
 * in the progression store (server-backed, synced across devices), and this
 * hook is a thin view over it.
 *
 * The public shape is unchanged so `components/Achievements.tsx` keeps
 * working, but `updateStats` now feeds the real store instead of a dead map.
 */
import { useContext } from 'react';
import { ProgressionContext, PROGRESSION_FALLBACK } from '../game/ProgressionContext';
import { RARITY_COLORS, type AchievementRarity, type AchievementStatKey } from '../game/rules';
import type { AchievementView } from '../api/progression';

export type { AchievementView };

/** Kept for the old `Achievement` shape used elsewhere in the codebase. */
export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'streak' | 'study' | 'social' | 'ai' | 'mastery';
  rarity: AchievementRarity;
  requirement: { type: string; target: number };
  unlockedAt?: Date;
  progress: number;
}

export function getRarityStyle(rarity: string) {
  return RARITY_COLORS[rarity as AchievementRarity] || RARITY_COLORS.common;
}

export function useAchievements() {
  const ctx = useContext(ProgressionContext) ?? PROGRESSION_FALLBACK;

  const stats = ctx.stats;

  return {
    stats,
    unlocked: ctx.unlockedAchievements,
    /**
     * Push counters to the store. Values are absolute totals — the store
     * keeps the larger of the two so a stale client can never lower them.
     */
    updateStats: (patch: Partial<Record<AchievementStatKey, number>>) => ctx.syncStats(patch),
    /** 0..1 progress towards an achievement's target. */
    progress: (achievement: AchievementView) =>
      achievement.target > 0 ? Math.min(1, achievement.progress / achievement.target) : 0,
    isUnlocked: (id: string) => ctx.unlockedAchievements.includes(id),
    newlyUnlocked: ctx.newAchievement,
    dismissCelebration: ctx.dismissAchievement,
    allAchievements: ctx.achievements,
  };
}
