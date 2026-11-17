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
import { deleteObject } from '../lib/storage.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';
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

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────
// One user plus a count of everything that goes with them. The delete
// dialog shows this so the admin sees the blast radius before confirming.
adminRouter.get('/users/:id', requireAuth, requireAdmin, async c => {
  const { id } = c.req.param();

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id:                   true,
      email:                true,
      name:                 true,
      tier:                 true,
      emailVerified:        true,
      createdAt:            true,
      stripeSubscriptionId: true,
      stripeCurrentPeriodEnd: true,
      stripePriceId:        true,
    },
  });
  if (!user) return c.json({ error: 'User not found' }, 404);

  const [
    notes, folders, contacts, flashcards, practiceQuestions,
    savedSearches, attachments, gameRooms, supportTickets,
  ] = await Promise.all([
    prisma.note.count({ where: { userId: id } }),
    prisma.folder.count({ where: { userId: id } }),
    prisma.contact.count({ where: { userId: id } }),
    prisma.flashcard.count({ where: { userId: id } }),
    prisma.practiceQuestion.count({ where: { userId: id } }),
    prisma.savedSearch.count({ where: { userId: id } }),
    prisma.attachment.count({ where: { note: { userId: id } } }),
    prisma.gameRoom.count({ where: { hostId: id } }),
    prisma.supportTicket.count({ where: { userId: id } }),
  ]);

  return c.json({
    user,
    counts: {
      notes, folders, contacts, flashcards, practiceQuestions,
      savedSearches, attachments, gameRooms, supportTickets,
    },
  });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
// Permanently remove an account and everything it owns.
//
// This cannot be undone, so it is guarded:
//   - the admin cannot delete their own account (that locks you out);
//   - the request must carry the exact email of the account being removed,
//     so a mistyped id or a stray request cannot wipe the wrong person;
//   - an active Stripe subscription is cancelled first, otherwise the
//     customer keeps being billed for an account that no longer exists;
//   - uploaded files are removed from R2, which the database cascade
//     cannot do — otherwise the objects stay in the bucket forever.
adminRouter.delete(
  '/users/:id',
  requireAuth,
  requireAdmin,
  zValidator('json', z.object({ confirmEmail: z.string().min(1) })),
  async c => {
    const { id } = c.req.param();
    const { confirmEmail } = c.req.valid('json');
    const admin = c.get('user');

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
      },
    });
    if (!target) return c.json({ error: 'User not found' }, 404);

    if (target.id === admin.id) {
      return c.json({ error: 'You cannot delete your own admin account.' }, 400);
    }
    if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
      return c.json({ error: 'Confirmation email does not match the account being deleted.' }, 400);
    }

    const warnings: string[] = [];

    // 1. Stop the subscription before the customer record disappears.
    if (target.stripeSubscriptionId) {
      if (!isStripeConfigured()) {
        warnings.push('Stripe is not configured on this server, so the subscription could not be cancelled. Cancel it manually in Stripe.');
      } else {
        try {
          await getStripe().subscriptions.cancel(target.stripeSubscriptionId);
        } catch (err) {
          warnings.push(`Could not cancel the Stripe subscription (${(err as Error).message}). Cancel it manually in Stripe.`);
        }
      }
    }

    // 2. Remove uploaded files from object storage.
    const attachments = await prisma.attachment.findMany({
      where: { note: { userId: id } },
      select: { storageKey: true },
    });
    const removals = await Promise.allSettled(
      attachments.map(a => deleteObject(a.storageKey)),
    );
    const filesRemoved = removals.filter(r => r.status === 'fulfilled').length;
    const filesFailed = removals.filter(r => r.status === 'rejected').length;
    if (filesFailed > 0) {
      warnings.push(`${filesFailed} uploaded file(s) could not be removed from storage and may need clearing up manually.`);
    }

    // 3. Delete the account. Every user-owned row cascades in the database.
    await prisma.user.delete({ where: { id } });

    console.log(
      `[Admin] Account deleted: ${target.email} (${id}) by ${admin.email} — `
      + `${filesRemoved} file(s) removed, ${attachments.length - filesRemoved} left in storage`,
    );

    return c.json({
      deleted: { id: target.id, email: target.email },
      filesRemoved,
      warnings,
    });
  },
);
