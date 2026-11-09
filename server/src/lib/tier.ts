/**
 * Middleware that requires the authenticated user to be on the Pro tier.
 * Use AFTER `requireAuth`. Returns 403 with a clear error message if not.
 *
 * Effective tier = PRO subscription OR an active 7-day free trial.
 * The trial is started automatically by `requireAuth` on the user's first
 * authenticated request (covers email sign-up AND Google OAuth).
 *
 * Also enforces free-tier limits (e.g. 50 items max) via `enforceFreeItemLimit`.
 * The frontend already gates these, but server-side enforcement is required
 * so a non-paying user actually gets exclusivity.
 */
import type { Context, Next } from 'hono';
import { prisma } from './prisma.js';

export const TRIAL_DAYS = 7;

export interface TierFields {
  tier: 'FREE' | 'PRO';
  trialStartsAt?: Date | null;
  trialEndsAt?: Date | null;
}

/** True when the user is inside their 7-day trial window. */
export function isTrialActive(user: Pick<TierFields, 'trialEndsAt'>): boolean {
  return !!user.trialEndsAt && user.trialEndsAt.getTime() > Date.now();
}

/** PRO subscription or active trial → Pro features. */
export function computeEffectiveTier(user: TierFields): 'FREE' | 'PRO' {
  if (user.tier === 'PRO') return 'PRO';
  return isTrialActive(user) ? 'PRO' : 'FREE';
}

/** Whole days left in the trial (0 when expired/absent). */
export function trialDaysLeft(trialEndsAt?: Date | null): number {
  if (!trialEndsAt) return 0;
  const ms = trialEndsAt.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Start the 7-day trial on first login if it has never been started and the
 * user isn't already Pro. Called from requireAuth so it covers every auth
 * path (email sign-up, Google OAuth, existing users pre-trial-feature).
 */
export async function ensureTrial(userId: string, user: TierFields): Promise<TierFields> {
  if (user.tier === 'PRO') return user;
  if (user.trialStartsAt) return user; // trial already started (may have expired)

  const now = new Date();
  const ends = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { trialStartsAt: now, trialEndsAt: ends },
  });
  return { ...user, trialStartsAt: now, trialEndsAt: ends };
}

export async function requirePro(c: Context, next: Next) {
  const user = c.get('user');
  if (computeEffectiveTier(user) !== 'PRO') {
    return c.json({
      error: user.trialEndsAt
        ? 'Your free trial has ended. This feature requires a Pro subscription.'
        : 'This feature requires a Pro subscription',
      upgradeUrl: '/pricing',
    }, 403);
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
