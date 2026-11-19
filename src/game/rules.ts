/**
 * rules.ts — the game's rules, on the client.
 *
 * The canonical definitions live in `server/src/lib/progressionRules.ts` so the
 * server and the browser can never disagree about what a quest is worth. This
 * module simply re-exports them for the client, plus the small helpers the UI
 * needs on top.
 */
export {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  BASE_RATING,
  ELO_K,
  LEECH_THRESHOLD,
  POWER_UPS,
  QUEST_POOL,
  QUESTS_PER_DAY,
  RARITY_COLORS,
  SEASONS,
  SEASON_BADGES,
  XP_EVENTS,
  buildDailyQuests,
  currentSeason,
  cumulativeXpForLevel,
  daysBetween,
  eloRound,
  eloUpdate,
  expectedScore,
  hashString,
  isLeech,
  isoDate,
  levelForXp,
  levelInfo,
  levelTitle,
  powerUpCharges,
  xpToNextLevel,
} from '../../server/src/lib/progressionRules';

export type {
  AchievementCategory,
  AchievementDef,
  AchievementRarity,
  AchievementStatKey,
  PowerUp,
  PowerUpDef,
  Quest,
  QuestTemplate,
  QuestType,
  Season,
  XpEventType,
} from '../../server/src/lib/progressionRules';
