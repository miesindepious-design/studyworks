/**
 * progressionRules.ts — the rules of the game.
 *
 * This file is deliberately pure TypeScript with no imports: the server
 * (`server/src/routes/progression.ts`) and the browser (`src/hooks/
 * useProgression.ts`) both load it, so a quest must be worth the same XP on
 * either side of the wire. Keep it that way — no node built-ins, no Prisma,
 * no React.
 *
 * What lives here:
 *   - XP awards per kind of activity
 *   - the level curve and the title that goes with each level
 *   - the daily quest pool and how a day's three quests are picked
 *   - the achievement catalogue
 *   - the season calendar (multipliers and badges)
 *   - ELO maths for quiz ratings
 *   - power-up rules for quiz battles
 */

// ── XP awards ─────────────────────────────────────────────────────────────────

export type XpEventType =
  | 'flashcard_review'
  | 'flashcard_session'
  | 'note_created'
  | 'note_edited'
  | 'summary_generated'
  | 'flashcards_generated'
  | 'practice_answered'
  | 'tutor_session'
  | 'tutor_quiz'
  | 'quiz_played'
  | 'quiz_won'
  | 'duel_completed'
  | 'duel_won'
  | 'focus_session'
  | 'study_minute'
  | 'quest_completed'
  | 'achievement_unlocked'
  | 'exam_plan_created'
  | 'card_created'
  | 'cloze_created'
  | 'leech_fixed';

export interface XpEventDef {
  xp: number;
  label: string;
  /** Quest types this event advances. */
  quest?: QuestType;
  /** How much of the quest this event counts as. */
  step?: number;
}

export const XP_EVENTS: Record<XpEventType, XpEventDef> = {
  flashcard_review:   { xp: 2,  label: 'Card reviewed',        quest: 'review',      step: 1 },
  flashcard_session:  { xp: 10, label: 'Review session done',  quest: 'review',      step: 5 },
  note_created:       { xp: 6,  label: 'Note created',         quest: 'notes',       step: 1 },
  note_edited:        { xp: 1,  label: 'Note edited',          quest: 'notes',       step: 1 },
  summary_generated:  { xp: 5,  label: 'Summary generated',    quest: 'summary',     step: 1 },
  flashcards_generated:{ xp: 8,  label: 'Flashcards generated', quest: 'cards',       step: 1 },
  practice_answered:  { xp: 3,  label: 'Practice answered',    quest: 'practice',    step: 1 },
  tutor_session:      { xp: 10, label: 'Tutor session',        quest: 'tutor',       step: 1 },
  tutor_quiz:         { xp: 4,  label: 'Tutor question',       quest: 'tutor',       step: 1 },
  quiz_played:        { xp: 25, label: 'Quiz battle played',   quest: 'battle',      step: 1 },
  quiz_won:           { xp: 30, label: 'Quiz battle won',      quest: 'battle',      step: 1 },
  duel_completed:     { xp: 20, label: 'Duel completed',       quest: 'battle',      step: 1 },
  duel_won:           { xp: 25, label: 'Duel won',             quest: 'battle',      step: 1 },
  focus_session:      { xp: 12, label: 'Focus session',        quest: 'focus',       step: 1 },
  study_minute:       { xp: 1,  label: 'Minute studied',       quest: 'focus',       step: 1 },
  quest_completed:    { xp: 25, label: 'Daily quest complete', quest: 'quest',       step: 1 },
  achievement_unlocked:{ xp: 20, label: 'Achievement unlocked', quest: 'quest',       step: 1 },
  exam_plan_created:  { xp: 10, label: 'Exam plan created' },
  card_created:       { xp: 3,  label: 'Card created',         quest: 'cards',       step: 1 },
  cloze_created:      { xp: 4,  label: 'Cloze card created',   quest: 'cards',       step: 1 },
  leech_fixed:        { xp: 15, label: 'Tough card fixed',     quest: 'cards',       step: 1 },
};

// ── Levels ────────────────────────────────────────────────────────────────────

/** XP needed to go from level n to level n+1. */
export function xpToNextLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

/** Total XP required to reach a level from zero. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
}

/** The level a given XP total earns. */
export function levelForXp(xp: number): number {
  let level = 1;
  let spent = 0;
  while (xp - spent >= xpToNextLevel(level)) {
    spent += xpToNextLevel(level);
    level++;
  }
  return level;
}

export interface LevelInfo {
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPct: number;
  totalXp: number;
}

const LEVEL_TITLES: Array<{ min: number; title: string }> = [
  { min: 1,  title: 'Freshman' },
  { min: 3,  title: 'Note Taker' },
  { min: 5,  title: 'Card Shark' },
  { min: 8,  title: 'Streak Keeper' },
  { min: 11, title: 'Scholar' },
  { min: 15, title: "Tutor's Favourite" },
  { min: 20, title: 'Exam Slayer' },
  { min: 25, title: 'Knowledge Ace' },
  { min: 30, title: 'Legend of the Library' },
];

export function levelTitle(level: number): string {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.min) title = t.title;
  return title;
}

export function levelInfo(xp: number): LevelInfo {
  const level = levelForXp(xp);
  const floor = cumulativeXpForLevel(level);
  const need = xpToNextLevel(level);
  const into = xp - floor;
  return {
    level,
    title: levelTitle(level),
    xpIntoLevel: into,
    xpForNextLevel: need,
    progressPct: need > 0 ? Math.min(1, into / need) : 1,
    totalXp: xp,
  };
}

// ── Daily quests ──────────────────────────────────────────────────────────────

export type QuestType =
  | 'review'
  | 'focus'
  | 'tutor'
  | 'notes'
  | 'battle'
  | 'practice'
  | 'summary'
  | 'cards'
  | 'quest';

export interface QuestTemplate {
  type: QuestType;
  title: string;
  description: string;
  icon: string;
  /** Base target before difficulty scaling. */
  baseTarget: number;
  xp: number;
}

export const QUEST_POOL: QuestTemplate[] = [
  { type: 'review',   title: 'Clear your reviews',   description: 'Review {n} flashcards that are due',        icon: '🃏', baseTarget: 15, xp: 40 },
  { type: 'focus',    title: 'Deep work',            description: 'Focus for {n} minutes without a break',       icon: '⏳', baseTarget: 25, xp: 45 },
  { type: 'tutor',    title: 'Ask the tutor',        description: 'Have {n} question(s) answered by the tutor',  icon: '🎓', baseTarget: 2,  xp: 35 },
  { type: 'notes',    title: 'Capture knowledge',    description: 'Write or update {n} note(s)',                icon: '📝', baseTarget: 2,  xp: 30 },
  { type: 'battle',   title: 'Battle a rival',       description: 'Win {n} quiz battle(s) or duel(s)',           icon: '⚔️', baseTarget: 1,  xp: 50 },
  { type: 'practice', title: 'Practice questions',   description: 'Answer {n} practice question(s)',            icon: '✍️', baseTarget: 5,  xp: 30 },
  { type: 'summary',  title: 'Summarise a note',     description: 'Generate {n} AI summary/summaries',          icon: '✨', baseTarget: 1,  xp: 30 },
  { type: 'cards',    title: 'Grow your deck',       description: 'Create {n} new flashcard(s)',                 icon: '💡', baseTarget: 5,  xp: 35 },
  { type: 'quest',    title: 'Complete a quest',     description: 'Finish {n} other daily quest(s)',             icon: '✅', baseTarget: 1,  xp: 30 },
];

export interface Quest extends QuestTemplate {
  id: string;
  target: number;
}

export const QUESTS_PER_DAY = 3;

/** A stable 32-bit hash — the same day always produces the same quests. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build today's quests. Deterministic: the same (date, userId) always yields
 * the same three quests, so a reload never shuffles a student's day.
 *
 * `level` scales the targets a little — the daily load grows with the player.
 */
export function buildDailyQuests(date: string, userId: string, level = 1): Quest[] {
  const seed = hashString(`${date}:${userId}`);
  const pool = [...QUEST_POOL];

  // Fisher-Yates with the seeded generator, so we pick three distinct quests.
  let state = seed;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const scale = 1 + Math.min(1.5, Math.floor((level - 1) / 10) * 0.15);

  return pool.slice(0, QUESTS_PER_DAY).map((t) => {
    const target = Math.max(1, Math.round(t.baseTarget * scale));
    return {
      ...t,
      id: `${date}:${t.type}`,
      target,
      description: t.description.replace('{n}', String(target)),
    };
  });
}

// ── Achievements ──────────────────────────────────────────────────────────────

export type AchievementCategory = 'streaks' | 'study' | 'social' | 'ai' | 'mastery';
export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type AchievementStatKey =
  | 'streakDays'
  | 'flashcardsReviewed'
  | 'notesCreated'
  | 'studyMinutes'
  | 'aiSummaries'
  | 'tutorSessions'
  | 'gamesPlayed'
  | 'friendsInvited'
  | 'cardsCreated'
  | 'duelsWon'
  | 'battleWins'
  | 'clozeCreated'
  | 'leechesFixed'
  | 'questsCompleted'
  | 'level';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  rarity: AchievementRarity;
  target: number;
  statKey: AchievementStatKey;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Streaks
  { id: 'streak_7',    title: '7-Day Streak',      description: 'Study for 7 days in a row',            category: 'streaks', icon: '🔥', rarity: 'common',    target: 7,   statKey: 'streakDays' },
  { id: 'streak_30',   title: '30-Day Streak',     description: 'Maintain a 30-day study streak',      category: 'streaks', icon: '⚡', rarity: 'rare',     target: 30,  statKey: 'streakDays' },
  { id: 'streak_100',  title: '100-Day Streak',    description: 'Achieve a legendary 100-day streak', category: 'streaks', icon: '🏆', rarity: 'legendary', target: 100, statKey: 'streakDays' },
  { id: 'streak_365',  title: 'Full Year',         description: 'Study every day for a whole year',    category: 'streaks', icon: '💎', rarity: 'legendary', target: 365, statKey: 'streakDays' },

  // Study
  { id: 'reviews_100',  title: 'Century Reviewer',  description: 'Review 100 flashcards',              category: 'study', icon: '📚', rarity: 'common',    target: 100,  statKey: 'flashcardsReviewed' },
  { id: 'reviews_1000', title: 'Thousand Reviewer', description: 'Review 1,000 flashcards',            category: 'study', icon: '🧠', rarity: 'epic',      target: 1000, statKey: 'flashcardsReviewed' },
  { id: 'notes_50',     title: 'Note Taker',        description: 'Create 50 notes',                    category: 'study', icon: '📝', rarity: 'uncommon',  target: 50,   statKey: 'notesCreated' },
  { id: 'notes_250',    title: 'Archivist',         description: 'Create 250 notes',                   category: 'study', icon: '🗄️', rarity: 'epic',      target: 250,  statKey: 'notesCreated' },
  { id: 'cards_20',     title: 'Flashcard Creator', description: 'Create 20 flashcards',               category: 'study', icon: '💡', rarity: 'common',    target: 20,   statKey: 'cardsCreated' },
  { id: 'cards_200',    title: 'Deck Builder',      description: 'Create 200 flashcards',               category: 'study', icon: '🗃️', rarity: 'rare',     target: 200,  statKey: 'cardsCreated' },
  { id: 'focus_600',    title: 'Ten Hour Scholar',  description: 'Log 600 minutes of focused study',   category: 'study', icon: '⏳', rarity: 'rare',     target: 600,  statKey: 'studyMinutes' },
  { id: 'quests_7',     title: 'Quest Streak',      description: 'Complete quests 7 days in a row',     category: 'study', icon: '✅', rarity: 'rare',     target: 7,    statKey: 'questsCompleted' },

  // Social
  { id: 'first_game',    title: 'First Steps',       description: 'Play your first quiz game',         category: 'social', icon: '🎮', rarity: 'common',   target: 1,  statKey: 'gamesPlayed' },
  { id: 'battle_wins_5', title: 'Duelist',           description: 'Win 5 quiz battles',                category: 'social', icon: '⚔️', rarity: 'uncommon', target: 5,  statKey: 'battleWins' },
  { id: 'duel_wins_3',   title: 'Rival',             description: 'Win 3 asynchronous duels',          category: 'social', icon: '🤺', rarity: 'uncommon', target: 3,  statKey: 'duelsWon' },
  { id: 'invite_friend', title: 'Social Butterfly',  description: 'Invite a friend to study together', category: 'social', icon: '🤝', rarity: 'uncommon', target: 1,  statKey: 'friendsInvited' },

  // AI
  { id: 'ai_summaries_10', title: 'AI Scholar',      description: 'Generate 10 AI summaries',         category: 'ai', icon: '🤖', rarity: 'rare',     target: 10, statKey: 'aiSummaries' },
  { id: 'tutor_5',        title: 'Tutor Apprentice', description: 'Complete 5 AI tutor sessions',     category: 'ai', icon: '🎓', rarity: 'uncommon', target: 5,  statKey: 'tutorSessions' },
  { id: 'tutor_50',       title: "Tutor's Pet",       description: 'Complete 50 AI tutor sessions',    category: 'ai', icon: '🧙', rarity: 'epic',     target: 50, statKey: 'tutorSessions' },

  // Mastery
  { id: 'cloze_10',      title: 'Fill the Gaps',      description: 'Create 10 cloze flashcards',      category: 'mastery', icon: '🧩', rarity: 'uncommon', target: 10,  statKey: 'clozeCreated' },
  { id: 'leech_5',       title: 'Tough Cookie',       description: 'Rescue 5 cards that kept failing', category: 'mastery', icon: '🍪', rarity: 'uncommon', target: 5,  statKey: 'leechesFixed' },
  { id: 'level_5',       title: 'Rising Star',       description: 'Reach level 5',                   category: 'mastery', icon: '⭐', rarity: 'common',   target: 5,  statKey: 'level' },
  { id: 'level_10',      title: 'Halfway Hero',      description: 'Reach level 10',                  category: 'mastery', icon: '🌟', rarity: 'rare',     target: 10,  statKey: 'level' },
  { id: 'level_25',      title: 'Master of the Deck',description: 'Reach level 25',                  category: 'mastery', icon: '👑', rarity: 'epic',     target: 25,  statKey: 'level' },
];

export const RARITY_COLORS: Record<AchievementRarity, { border: string; bg: string; text: string; glow: string }> = {
  common:    { border: 'rgb(148 163 184 / .4)', bg: 'rgb(148 163 184 / .08)', text: '#94a3b8', glow: 'rgb(148 163 184 / .15)' },
  uncommon:  { border: 'rgb(52 211 153 / .4)',  bg: 'rgb(52 211 153 / .08)',  text: '#34d399', glow: 'rgb(52 211 153 / .15)' },
  rare:      { border: 'rgb(56 189 248 / .4)',  bg: 'rgb(56 189 248 / .08)',  text: '#38bdf8', glow: 'rgb(56 189 248 / .15)' },
  epic:      { border: 'rgb(168 85 247 / .4)',  bg: 'rgb(168 85 247 / .08)',  text: '#a855f7', glow: 'rgb(168 85 247 / .15)' },
  legendary: { border: 'rgb(251 191 36 / .5)',  bg: 'rgb(251 191 36 / .1)',   text: '#fbbf24', glow: 'rgb(251 191 36 / .2)' },
};

/** Every achievement id, for quick membership checks. */
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

// ── Seasons ───────────────────────────────────────────────────────────────────

export interface Season {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Inclusive start/end dates as YYYY-MM-DD. */
  start: string;
  end: string;
  /** XP multiplier applied to every award while the season runs. */
  xpMultiplier: number;
  /** Extra achievements only unlockable during the season. */
  badgeIds: string[];
}

export const SEASONS: Season[] = [
  {
    id: 'exam-season-2026',
    name: 'Exam Season Sprint',
    description: 'Every card reviewed counts double until the exams are done.',
    icon: '🎓',
    start: '2026-11-01',
    end: '2027-01-31',
    xpMultiplier: 2,
    badgeIds: ['exam_season_1000'],
  },
  {
    id: 'new-year-reset-2027',
    name: 'New Year Reset',
    description: 'January is for clearing the backlog. Reviews count triple.',
    icon: '🎊',
    start: '2027-01-01',
    end: '2027-02-28',
    xpMultiplier: 3,
    badgeIds: [],
  },
  {
    id: 'spring-cleanup-2027',
    name: 'Spring Cleanup',
    description: 'Fix what is broken: rescue tough cards and rebuild old decks.',
    icon: '🌱',
    start: '2027-03-01',
    end: '2027-05-31',
    xpMultiplier: 1.5,
    badgeIds: ['spring_rescue_25'],
  },
];

export function currentSeason(now = new Date()): Season | null {
  const today = isoDate(now);
  for (const s of SEASONS) {
    if (today >= s.start && today <= s.end) return s;
  }
  return null;
}

/** Season-only badges, kept with the main catalogue so one list renders them. */
export const SEASON_BADGES: AchievementDef[] = [
  { id: 'exam_season_1000', title: 'Exam Machine',   description: 'Review 1,000 cards during Exam Season', category: 'mastery', icon: '🎓', rarity: 'epic',     target: 1000, statKey: 'flashcardsReviewed' },
  { id: 'spring_rescue_25', title: 'Spring Cleaner', description: 'Rescue 25 tough cards in Spring Cleanup', category: 'mastery', icon: '🌱', rarity: 'rare',   target: 25,  statKey: 'leechesFixed' },
];

// ── Dates ─────────────────────────────────────────────────────────────────────

export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

// ── ELO ───────────────────────────────────────────────────────────────────────

export const BASE_RATING = 1200;
export const ELO_K = 32;

/** Standard ELO expected score for `rating` against `opponentRating`. */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

/**
 * New rating after one match. `score` is 1 for a win, 0.5 for a draw, 0 for
 * a loss. Returns both the new rating and the delta.
 */
export function eloUpdate(rating: number, opponentRating: number, score: 0 | 0.5 | 1): { rating: number; delta: number } {
  const expected = expectedScore(rating, opponentRating);
  const delta = Math.round(ELO_K * (score - expected));
  return { rating: Math.max(100, rating + delta), delta };
}

export interface EloPlayer {
  id: string;
  rating: number;
  /** Points scored in the match. Higher wins. */
  score: number;
}

/**
 * Rating update for a match with any number of players.
 *
 * Each player is compared head-to-head with every other player: the expected
 * score is the average of the pairwise expectations, and the actual score is
 * the average of the pairwise results (1 win, 0.5 draw, 0 loss). The rating
 * change is then the standard ELO delta against that average.
 */
export function eloRound(players: EloPlayer[]): Record<string, { rating: number; delta: number }> {
  const out: Record<string, { rating: number; delta: number }> = {};
  if (players.length === 0) return out;
  if (players.length === 1) {
    out[players[0].id] = { rating: players[0].rating, delta: 0 };
    return out;
  }

  for (const p of players) {
    let expectedSum = 0;
    let actualSum = 0;
    for (const o of players) {
      if (o.id === p.id) continue;
      expectedSum += expectedScore(p.rating, o.rating);
      if (p.score > o.score) actualSum += 1;
      else if (p.score === o.score) actualSum += 0.5;
    }
    const opponents = players.length - 1;
    const expected = expectedSum / opponents;
    const actual = actualSum / opponents;
    const delta = Math.round(ELO_K * (actual - expected));
    out[p.id] = { rating: Math.max(100, p.rating + delta), delta };
  }
  return out;
}

// ── Power-ups ─────────────────────────────────────────────────────────────────

export type PowerUp = '50/50' | 'extra-time' | 'double-points';

export interface PowerUpDef {
  id: PowerUp;
  label: string;
  description: string;
  icon: string;
  /** How many uses a player gets per match. */
  charges: number;
}

export const POWER_UPS: PowerUpDef[] = [
  { id: '50/50',       label: '50/50',       description: 'Remove two wrong answers',        icon: '½',  charges: 2 },
  { id: 'extra-time',  label: 'Extra Time',  description: 'Add 10 seconds to the clock',     icon: '⏱️', charges: 1 },
  { id: 'double-points', label: 'Double',    description: 'Double XP on the next answer',    icon: '✖️', charges: 2 },
];

export function powerUpCharges(id: PowerUp): number {
  return POWER_UPS.find((p) => p.id === id)?.charges ?? 0;
}

// ── Leech rules ───────────────────────────────────────────────────────────────

/** How many "Again" ratings turn a card into a leech. */
export const LEECH_THRESHOLD = 3;

/** A card whose ease factor has collapsed is a leech even if it failed less often. */
export function isLeech(card: { leechCount?: number; ef?: number }): boolean {
  if ((card.leechCount ?? 0) >= LEECH_THRESHOLD) return true;
  return card.ef !== undefined && card.ef !== null && card.ef < 1.7;
}
