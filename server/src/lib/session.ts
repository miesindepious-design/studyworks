/**
 * Middleware that requires a valid Better Auth session.
 * Attaches `c.get('user')` and `c.get('session')` to the context.
 */
import type { Context, Next } from 'hono';
import { auth } from './auth.js';
import { prisma } from './prisma.js';

export type HonoUser = {
  id: string;
  email: string;
  name: string | null;
  tier: 'FREE' | 'PRO';
  educationLevel?: string | null;
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
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { tier: true, educationLevel: true },
  });
  c.set('user', {
    id:    session.user.id,
    email: session.user.email,
    name:  session.user.name ?? null,
    tier:  (dbUser?.tier ?? 'FREE') as 'FREE' | 'PRO',
    educationLevel: dbUser?.educationLevel ?? null,
  });
  c.set('session', session.session as any);

  await next();
}
