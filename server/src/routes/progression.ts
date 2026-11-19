/**
 * /api/progression — the game's spine.
 *
 * Everything that makes StudyWorks feel like a game runs through here: XP,
 * levels, daily quests, achievements, seasons and the streak-freeze wallet.
 *
 * GET  /api/progression            → the player's full progression state
 * POST /api/progression/event      → award XP for an activity (review, focus, …)
 * POST /api/progression/stats      → sync the counters achievements are judged on
 * POST /api/progression/freeze/spend → use a streak freeze to cover a missed day
 * GET  /api/progression/leaderboard → top players (global or this week)
 *
 * The rules live in `lib/progressionRules.ts`, which the browser also loads,
 * so the client can predict a reward without a round trip.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';
import {
  ACHIEVEMENTS,
  SEASON_BADGES,
  XP_EVENTS,
  buildDailyQuests,
  currentSeason,
  isoDate,
  levelInfo,
  levelForXp,
  type AchievementStatKey,
  type XpEventType,
} from '../lib/progressionRules.js';

export const progressionRouter = new Hono();
progressionRouter.use('*', requireAuth);

const EventBody = z.object({
  type: z.string().min(1) as z.ZodType<XpEventType>,
  amount: z.number().int().optional(),
  meta: z.record(z.unknown()).optional(),
});

const StatsBody = z.object({
  stats: z.record(z.string(), z.number().int().min(0)).default({}),
});

/** How many days of XP history we keep for the weekly recap. */
const DAILY_XP_DAYS = 30;

type QuestProgress = { p: number; d: boolean };
type QuestState = Record<string, QuestProgress> & { __meta?: { freezeAwarded?: boolean } };

interface ProgressRow {
  xp: number;
  level: number;
  seasonXp: number;
  streakFreezes: number;
  focusTrees: number;
  unlockedAchievements: string[];
  questState: unknown;
  questDate: string | null;
  dailyXp: unknown;
}

/** All achievement definitions, including the seasonal badges. */
function allAchievements() {
  return [...ACHIEVEMENTS, ...SEASON_BADGES];
}

/** The player's stat counters (used to judge achievements). */
async function getStats(userId: string): Promise<Record<string, number>> {
  const row = await prisma.userProgress.findUnique({
    where: { userId },
    select: { dailyXp: true },
  });
  // Stats live alongside the progression row; we keep them in the dailyXp
  // blob under a reserved key so there is only one JSON column to reason about.
  const blob = (row?.dailyXp ?? {}) as Record<string, unknown>;
  const stats = (blob.__stats as Record<string, number> | undefined) ?? {};
  return stats;
}

function splitDailyXp(blob: unknown): { daily: Record<string, number>; stats: Record<string, number> } {
  const obj = (blob ?? {}) as Record<string, unknown>;
  const { __stats, ...daily } = obj;
  return {
    daily: daily as Record<string, number>,
    stats: ( __stats as Record<string, number> | undefined) ?? {},
  };
}

function pruneDaily(daily: Record<string, number>): Record<string, number> {
  const cutoff = isoDate(new Date(Date.now() - DAILY_XP_DAYS * 86400000));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(daily)) if (k >= cutoff) out[k] = v;
  return out;
}

async function loadProgress(userId: string): Promise<ProgressRow> {
  const row = await prisma.userProgress.findUnique({ where: { userId } });
  if (row) return row as unknown as ProgressRow;
  const created = await prisma.userProgress.create({ data: { userId } });
  return created as unknown as ProgressRow;
}

/** Build the response body the client renders from. */
async function buildState(userId: string) {
  const row = await loadProgress(userId);
  const today = isoDate();
  const info = levelInfo(row.xp);
  const season = currentSeason();
  const quests = buildDailyQuests(today, userId, row.level);

  // Quest progress resets when the day rolls over.
  const questState: QuestState =
    row.questDate === today ? ((row.questState as QuestState) ?? {}) : {};

  const { daily, stats } = splitDailyXp(row.dailyXp);

  const questViews = quests.map(q => {
    const entry = questState[q.id];
    const progress = Math.min(entry?.p ?? 0, q.target);
    const done = Boolean(entry?.d);
    return {
      id: q.id,
      type: q.type,
      title: q.title,
      description: q.description,
      icon: q.icon,
      xp: q.xp,
      target: q.target,
      progress,
      done,
      completed: done,
      readyToClaim: done,
    };
  });

  const unlocked = new Set(row.unlockedAchievements ?? []);
  const catalogue = allAchievements().map(a => {
    const current = stats[a.statKey] ?? 0;
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      category: a.category,
      icon: a.icon,
      rarity: a.rarity,
      target: a.target,
      statKey: a.statKey,
      progress: Math.min(current, a.target),
      unlocked: unlocked.has(a.id),
      complete: current >= a.target,
    };
  });

  return {
    xp: row.xp,
    level: info.level,
    levelTitle: info.title,
    xpIntoLevel: info.xpIntoLevel,
    xpForNextLevel: info.xpForNextLevel,
    progressPct: info.progressPct,
    seasonXp: row.seasonXp,
    season: season ? { id: season.id, name: season.name, description: season.description, icon: season.icon, xpMultiplier: season.xpMultiplier, endsAt: season.end } : null,
    streakFreezes: row.streakFreezes,
    focusTrees: row.focusTrees,
    unlockedAchievements: [...unlocked],
    achievements: catalogue,
    quests: questViews,
    dailyXp: pruneDaily(daily),
    stats,
    serverDate: today,
  };
}

// GET the whole progression state
progressionRouter.get('/', async c => {
  const user = c.get('user');
  return c.json(await buildState(user.id));
});

// POST award XP for an activity
progressionRouter.post('/event', zValidator('json', EventBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const def = XP_EVENTS[body.type];
  if (!def) return c.json({ error: `Unknown event type: ${body.type}` }, 400);

  const row = await loadProgress(user.id);
  const today = isoDate();
  const season = currentSeason();
  const multiplier = season?.xpMultiplier ?? 1;

  const baseXp = body.amount ?? def.xp;
  const gained = Math.max(0, Math.round(baseXp * multiplier));

  // Quest progress. A day rollover wipes yesterday's counters.
  const quests = buildDailyQuests(today, user.id, row.level);
  const questState: QuestState =
    row.questDate === today ? ((row.questState as QuestState) ?? {}) : {};
  const { daily, stats } = splitDailyXp(row.dailyXp);

  const newlyCompleted: string[] = [];
  let questXp = 0;

  if (def.quest) {
    const quest = quests.find(q => q.type === def.quest);
    if (quest) {
      const entry = questState[quest.id] ?? { p: 0, d: false };
      if (!entry.d) {
        const next = entry.p + (def.step ?? 1);
        if (next >= quest.target) {
          entry.p = quest.target;
          entry.d = true;
          newlyCompleted.push(quest.id);
          questXp += quest.xp;
        } else {
          entry.p = next;
        }
        questState[quest.id] = entry;
      }
    }
  }

  // A quest of type "quest" advances when any other quest completes.
  if (body.type === 'quest_completed') {
    const quest = quests.find(q => q.type === 'quest');
    if (quest) {
      const entry = questState[quest.id] ?? { p: 0, d: false };
      if (!entry.d) {
        const next = entry.p + (def.step ?? 1);
        if (next >= quest.target) {
          entry.p = quest.target;
          entry.d = true;
          newlyCompleted.push(quest.id);
          questXp += quest.xp;
        } else {
          entry.p = next;
        }
        questState[quest.id] = entry;
      }
    }
  }

  const totalXp = gained + questXp;

  // Completing every quest of the day earns a streak freeze — but only once
  // per day, so the award is tracked with a marker in the quest state.
  const meta = (questState.__meta as { freezeAwarded?: boolean } | undefined) ?? {};
  const allDone = quests.every(q => questState[q.id]?.d);
  const earnedFreeze = allDone && !meta.freezeAwarded;
  if (earnedFreeze) meta.freezeAwarded = true;
  questState.__meta = meta;

  const xp = row.xp + totalXp;
  const level = levelForXp(xp);
  daily[today] = (daily[today] ?? 0) + totalXp;

  // Level-based achievements are judged immediately.
  stats.level = level;

  const updated = await prisma.userProgress.update({
    where: { userId: user.id },
    data: {
      xp,
      level,
      seasonXp: row.seasonXp + totalXp,
      streakFreezes: Math.min(5, row.streakFreezes + (earnedFreeze ? 1 : 0)),
      focusTrees: row.focusTrees + (body.type === 'focus_session' ? 1 : 0),
      questState: questState as object,
      questDate: today,
      dailyXp: { ...pruneDaily(daily), __stats: stats } as object,
    },
  });

  // Level-up detection for the celebration.
  const leveledUp = level > row.level;

  return c.json({
    ...(await buildState(user.id)),
    xpGained: totalXp,
    baseXp: gained,
    questXp,
    leveledUp,
    level,
    previousLevel: row.level,
    focusTrees: updated.focusTrees,
    newlyCompletedQuests: newlyCompleted,
    multiplier,
  });
});

// POST sync the counters achievements are judged on (absolute totals, max-wins)
progressionRouter.post('/stats', zValidator('json', StatsBody), async c => {
  const user = c.get('user');
  const { stats: incoming } = c.req.valid('json');

  const row = await loadProgress(user.id);
  const { daily, stats } = splitDailyXp(row.dailyXp);

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    stats[key] = Math.max(stats[key] ?? 0, Math.round(value));
  }
  stats.level = Math.max(stats.level ?? 0, row.level);

  const unlocked = new Set(row.unlockedAchievements ?? []);
  const newlyUnlocked: string[] = [];
  for (const a of allAchievements()) {
    if (unlocked.has(a.id)) continue;
    if ((stats[a.statKey] ?? 0) >= a.target) {
      unlocked.add(a.id);
      newlyUnlocked.push(a.id);
    }
  }

  const updated = await prisma.userProgress.update({
    where: { userId: user.id },
    data: {
      unlockedAchievements: [...unlocked],
      dailyXp: { ...pruneDaily(daily), __stats: stats } as object,
    },
  });

  return c.json({
    ...(await buildState(user.id)),
    newlyUnlocked,
    unlockedAchievements: updated.unlockedAchievements,
  });
});

// POST spend a streak freeze to cover a missed day
progressionRouter.post('/freeze/spend', async c => {
  const user = c.get('user');
  const row = await loadProgress(user.id);
  if (row.streakFreezes <= 0) {
    return c.json({ granted: false, streakFreezes: 0 });
  }
  const updated = await prisma.userProgress.update({
    where: { userId: user.id },
    data: { streakFreezes: row.streakFreezes - 1 },
  });
  return c.json({ granted: true, streakFreezes: updated.streakFreezes });
});

// GET the leaderboard
progressionRouter.get('/leaderboard', async c => {
  const user = c.get('user');
  const scope = c.req.query('scope') === 'week' ? 'week' : 'global';

  const top = await prisma.userProgress.findMany({
    orderBy: { xp: 'desc' },
    take: 50,
    include: { user: { select: { id: true, name: true, image: true } } },
  });

  const rows = top.map((p) => {
    const info = levelInfo(p.xp);
    let weekXp = p.seasonXp;
    if (scope === 'week') {
      const { daily } = splitDailyXp(p.dailyXp);
      const cutoff = isoDate(new Date(Date.now() - 7 * 86400000));
      weekXp = Object.entries(daily)
        .filter(([k]) => k >= cutoff)
        .reduce((a, [, v]) => a + (v ?? 0), 0);
    }
    return {
      userId: p.user.id,
      name: p.user.name ?? 'Student',
      image: p.user.image,
      xp: scope === 'week' ? weekXp : p.xp,
      totalXp: p.xp,
      level: info.level,
      levelTitle: info.title,
      isMe: p.user.id === user.id,
    };
  });

  rows.sort((a, b) => b.xp - a.xp);

  const me = rows.find(r => r.isMe);
  const myRow = me ?? (await prisma.userProgress.findUnique({
    where: { userId: user.id },
    include: { user: { select: { id: true, name: true, image: true } } },
  }).then(p => {
    if (!p) return null;
    const info = levelInfo(p.xp);
    return {
      userId: p.user.id,
      name: p.user.name ?? 'Student',
      image: p.user.image,
      xp: scope === 'week' ? 0 : p.xp,
      totalXp: p.xp,
      level: info.level,
      levelTitle: info.title,
      isMe: true,
    };
  }));

  return c.json({ scope, rows: rows.slice(0, 50), me: myRow });
});
