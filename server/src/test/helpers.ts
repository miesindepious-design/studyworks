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

  const login = (user: { id: string; email: string; name: string | null; tier: 'FREE' | 'PRO' }) => {
    globalThis.__testUser = user;
    globalThis.__testSession = {
      id: 'session-1',
      userId: user.id,
      expiresAt: new Date(Date.now() + 86400_000),
    };
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
