/**
 * Test helper — spin up a fresh Hono app instance with mocked Prisma + auth,
 * and return a `request()` function that mimics `fetch()` for assertions.
 *
 * Usage:
 *   const { app, request, login } = await buildTestApp();
 *   login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'PRO' });
 *   const res = await request('/api/notes', { method: 'GET' });
 *   expect(res.status).toBe(200);
 */
import { vi } from 'vitest';
import { Hono } from 'hono';
import { prismaMock } from './setup.js';

// We import lazily so mocks from setup.ts are applied first
export async function buildTestApp() {
  const { app } = await import('../app.js');
  // Build a fresh app instance so tests don't share state
  const testApp = new Hono();
  testApp.route('/', app);
  testApp.onError((err, c) => {
    console.error('[test] app error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  const request = async (path: string, init: RequestInit = {}) => {
    return testApp.request(`http://localhost${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  };

  const login = (user: {
    id: string;
    email: string;
    name: string | null;
    tier: 'FREE' | 'PRO';
    // Trial fields — default to an already-expired trial so existing tests
    // exercise genuinely-free users. Pass `trialDaysLeft` to simulate an
    // active trial (e.g. login({ ..., trialDaysLeft: 5 })).
    trialDaysLeft?: number;
  }) => {
    globalThis.__testUser = user;
    globalThis.__testSession = {
      id: 'session-1',
      userId: user.id,
      expiresAt: new Date(Date.now() + 86400_000),
    };
    // `requireAuth` resolves the tier authoritatively from the database, not
    // from the session payload, so the mock Prisma user row has to agree with
    // the tier passed to `login()`. Without this the route sees tier FREE
    // regardless of what the test asked for, and every Pro-gated assertion
    // fails with a 403 instead of reaching the route handler.
    const trialLeft = user.trialDaysLeft;
    const trialStartsAt = trialLeft === undefined
      ? new Date(Date.now() - 8 * 86400_000)  // expired 7-day trial
      : new Date(Date.now() - (7 - trialLeft) * 86400_000);
    const trialEndsAt = trialLeft === undefined
      ? new Date(Date.now() - 1 * 86400_000)  // ended yesterday
      : new Date(Date.now() + trialLeft * 86400_000);
    prismaMock.user.findUnique.mockResolvedValue({
      id: user.id,
      email: user.email,
      name: user.name,
      tier: user.tier,
      educationLevel: null,
      schoolStage: null,
      schoolClass: null,
      universityYear: null,
      department: null,
      trialStartsAt,
      trialEndsAt,
    } as any);
  };

  const logout = () => {
    globalThis.__testUser = null;
    globalThis.__testSession = null;
  };

  return { app: testApp, request, login, logout };
}

// Re-export common test helpers for convenience
export { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
export { prismaMock } from './setup.js';
