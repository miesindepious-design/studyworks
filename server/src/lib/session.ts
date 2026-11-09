/**
 * Middleware that requires a valid Better Auth session.
 * Attaches `c.get('user')` and `c.get('session')` to the context.
 *
 * Also starts the 7-day free Pro trial on the user's very first
 * authenticated request (all auth paths) and exposes the student profile
 * collected at signup for downstream routes (AI tutor, etc.).
 */
import type { Context, Next } from 'hono';
import { auth } from './auth.js';
import { prisma } from './prisma.js';
import { computeEffectiveTier, ensureTrial } from './tier.js';

export type HonoUser = {
  id: string;
  email: string;
  name: string | null;
  /** Raw billing tier from Stripe/webhooks — NOT trial-aware. */
  tier: 'FREE' | 'PRO';
  /** tier after applying the 7-day trial (PRO while trial is active). */
  effectiveTier: 'FREE' | 'PRO';
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  educationLevel?: string | null;
  schoolStage?: string | null;
  schoolClass?: string | null;
  universityYear?: string | null;
};

declare module 'hono' {
  interface ContextVariableMap {
    user:    HonoUser;
    session: { id: string; userId: string; expiresAt: Date };
  }
}

export async function requireAuth(c: Context, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user || !session?.session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Attach to context. tier is authoritative from Prisma (not the Better Auth
  // session cache, which can be stale after an upgrade).
  let dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      tier: true,
      educationLevel: true,
      schoolStage: true,
      schoolClass: true,
      universityYear: true,
      trialStartsAt: true,
      trialEndsAt: true,
    },
  });

  if (!dbUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && dbUser.email.toLowerCase() === adminEmail.toLowerCase()) {
    await prisma.user.update({ where: { id: dbUser.id }, data: { tier: 'PRO' } });
    dbUser = { ...dbUser, tier: 'PRO' as const };
  }

  // 7-day free trial: auto-start on first login for non-Pro users.
  const withTrial = await ensureTrial(dbUser.id, dbUser);

  c.set('user', {
    id:    session.user.id,
    email: session.user.email,
    name:  session.user.name ?? null,
    tier:  withTrial.tier,
    effectiveTier: computeEffectiveTier(withTrial),
    trialStartsAt: withTrial.trialStartsAt ?? null,
    trialEndsAt:   withTrial.trialEndsAt ?? null,
    educationLevel: dbUser.educationLevel ?? null,
    schoolStage:    dbUser.schoolStage ?? null,
    schoolClass:    dbUser.schoolClass ?? null,
    universityYear: dbUser.universityYear ?? null,
  });
  c.set('session', session.session as any);

  await next();
}
