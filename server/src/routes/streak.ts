/**
 * /api/streak — cross-device streak sync.
 *
 * GET  /api/streak      → the user's server-side streak record (or defaults)
 * POST /api/streak/merge → merge a client streak snapshot into the server's,
 *                          returning the merged result. Merge rules:
 *   - dailyCounts: per-day MAX of client vs server (idempotent — re-merging
 *     the same snapshot never double-counts)
 *   - totalReviews: recomputed as the sum of merged dailyCounts (approximation
 *     capped at 90 days of history, which is all we keep anyway)
 *   - currentStreak / longestStreak: recomputed from merged dailyCounts so
 *     reviews done on two devices on consecutive days chain correctly.
 *
 * The client calls merge after each sync push (and on app load when online).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const streakRouter = new Hono();
streakRouter.use('*', requireAuth);

const DAY_MS = 86_400_000;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Recompute streaks from a dailyCounts map (keys YYYY-MM-DD). */
function computeStreaks(dailyCounts: Record<string, number>): { current: number; longest: number; lastDate: string | null } {
  const days = Object.keys(dailyCounts).filter(k => (dailyCounts[k] ?? 0) > 0).sort();
  if (days.length === 0) return { current: 0, longest: 0, lastDate: null };

  // longest: scan consecutive-day runs
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const cur  = new Date(days[i]).getTime();
    if (Math.round((cur - prev) / DAY_MS) === 1) { run++; longest = Math.max(longest, run); }
    else run = 1;
  }
  longest = Math.max(longest, run);

  // current: count back from today (or yesterday — today may not be reviewed yet)
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS));
  const daySet = new Set(days);
  let anchor: string | null = daySet.has(today) ? today : daySet.has(yesterday) ? yesterday : null;
  let current = 0;
  if (anchor) {
    let t = new Date(anchor).getTime();
    while (daySet.has(dayKey(new Date(t)))) { current++; t -= DAY_MS; }
  }

  return { current, longest, lastDate: days[days.length - 1] };
}

const MergeBody = z.object({
  dailyCounts: z.record(z.string(), z.number().int().min(0)).default({}),
});

// GET current server streak
streakRouter.get('/', async c => {
  const user = c.get('user');
  const row = await prisma.streak.findUnique({ where: { userId: user.id } });
  return c.json(row ?? {
    userId: user.id, lastReviewDate: null, currentStreak: 0,
    longestStreak: 0, totalReviews: 0, dailyCounts: {},
  });
});

// POST merge client snapshot
streakRouter.post('/merge', zValidator('json', MergeBody), async c => {
  const user = c.get('user');
  const { dailyCounts: clientCounts } = c.req.valid('json');

  const existing = await prisma.streak.findUnique({ where: { userId: user.id } });
  const serverCounts = (existing?.dailyCounts as Record<string, number> | null) ?? {};

  // Per-day max, pruned to last 90 days.
  const cutoff = dayKey(new Date(Date.now() - 90 * DAY_MS));
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(serverCounts)) if (k >= cutoff) merged[k] = v;
  for (const [k, v] of Object.entries(clientCounts)) {
    if (k < cutoff) continue;
    merged[k] = Math.max(merged[k] ?? 0, v);
  }

  const { current, longest, lastDate } = computeStreaks(merged);
  const totalReviews = Object.values(merged).reduce((a, b) => a + b, 0);

  const row = await prisma.streak.upsert({
    where:  { userId: user.id },
    create: {
      userId: user.id,
      lastReviewDate: lastDate,
      currentStreak:  current,
      longestStreak:  Math.max(longest, existing?.longestStreak ?? 0),
      totalReviews,
      dailyCounts: merged,
    },
    update: {
      lastReviewDate: lastDate,
      currentStreak:  current,
      longestStreak:  Math.max(longest, existing?.longestStreak ?? 0),
      totalReviews,
      dailyCounts: merged,
    },
  });

  return c.json(row);
});
