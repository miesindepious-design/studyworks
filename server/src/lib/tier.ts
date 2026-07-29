/**
 * Middleware that requires the authenticated user to be on the Pro tier.
 * Use AFTER `requireAuth`. Returns 403 with a clear error message if not.
 *
 * Also enforces free-tier limits (e.g. 50 items max) when used with
 * the helpers below. The frontend already gates these, but server-side
 * enforcement is required so a paying user actually gets exclusivity.
 */
import type { Context, Next } from 'hono';
import { prisma } from './prisma.js';

export async function requirePro(c: Context, next: Next) {
  const user = c.get('user');
  if (user.tier !== 'PRO') {
    return c.json({ error: 'This feature requires a Pro subscription', upgradeUrl: '/pricing' }, 403);
  }
  await next();
}

/**
 * Enforce the free-tier item limit (50 total notes + contacts + flashcards).
 * Call this at the start of POST routes that create items.
 */
export async function enforceFreeItemLimit(c: Context, userId: string) {
  const [notes, contacts, flashcards] = await Promise.all([
    prisma.note.count({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
    prisma.flashcard.count({ where: { userId } }),
  ]);
  const total = notes + contacts + flashcards;
  if (total >= 50) {
    return c.json({
      error: `Free plan limit: 50 items. You have ${total}. Upgrade to Pro for unlimited.`,
      upgradeUrl: '/pricing',
      currentCount: total,
      limit: 50,
    }, 403);
  }
  return null; // allowed
}
