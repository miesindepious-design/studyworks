/**
 * /api/admin — Admin-only endpoints.
 *
 * All routes require the authenticated user's email to match ADMIN_EMAIL.
 * Never exposed to regular users — a non-admin gets 403 immediately.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';
import type { Context, Next } from 'hono';

export const adminRouter = new Hono();

// ── Admin guard middleware ─────────────────────────────────────────────────────
async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user');
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    return c.json({ error: 'Admin access is not configured on this server.' }, 403);
  }
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Returns all users with their tier and subscription info.
// Supports optional ?search=email query param.
adminRouter.get('/users', requireAuth, requireAdmin, async c => {
  const search = c.req.query('search')?.trim();

  const users = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name:  { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: {
      id:                    true,
      email:                 true,
      name:                  true,
      tier:                  true,
      emailVerified:         true,
      createdAt:             true,
      stripeSubscriptionId:  true,
      stripeCurrentPeriodEnd: true,
      stripePriceId:         true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return c.json({ users });
});

// ── PATCH /api/admin/users/:id/tier ───────────────────────────────────────────
// Upgrade or downgrade a single user's tier.
adminRouter.patch(
  '/users/:id/tier',
  requireAuth,
  requireAdmin,
  zValidator('json', z.object({ tier: z.enum(['FREE', 'PRO']) })),
  async c => {
    const { id } = c.req.param();
    const { tier } = c.req.valid('json');

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    const updated = await prisma.user.update({
      where: { id },
      data:  { tier },
      select: { id: true, email: true, name: true, tier: true },
    });

    console.log(`[Admin] Tier updated: ${existing.email} → ${tier}`);
    return c.json({ user: updated });
  }
);

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
// Quick counts for the dashboard header.
adminRouter.get('/stats', requireAuth, requireAdmin, async c => {
  const [total, pro, free] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { tier: 'PRO' } }),
    prisma.user.count({ where: { tier: 'FREE' } }),
  ]);

  return c.json({ total, pro, free });
});
