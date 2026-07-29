/**
 * Tests for the in-memory rate limiter. These don't need a Hono app — the
 * limiter is a pure function of (key, now, limit, window).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, rateLimitMiddleware } from '../lib/rateLimit.js';

describe('rateLimit (pure function)', () => {
  beforeEach(() => {
    // Each test gets a clean state by varying the key.
  });

  it('allows the first call', () => {
    const r = rateLimit('user-a', 3, 60_000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('blocks after `limit` calls', () => {
    rateLimit('user-b', 3, 60_000);
    rateLimit('user-b', 3, 60_000);
    rateLimit('user-b', 3, 60_000);
    const r = rateLimit('user-b', 3, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('does not block a different key', () => {
    for (let i = 0; i < 5; i++) rateLimit('user-c', 3, 60_000);
    const r = rateLimit('user-d', 3, 60_000);
    expect(r.allowed).toBe(true);
  });

  it('resets after the window elapses (simulated via fast window)', () => {
    const r1 = rateLimit('user-e', 1, 5);
    expect(r1.allowed).toBe(true);
    const r2 = rateLimit('user-e', 1, 5);
    expect(r2.allowed).toBe(false);
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const r3 = rateLimit('user-e', 1, 5);
        expect(r3.allowed).toBe(true);
        resolve();
      }, 10);
    });
  });
});

describe('rateLimitMiddleware', () => {
  it('returns 429 with retry-after when over the limit', async () => {
    const mw = rateLimitMiddleware(1, 60_000);
    // Build a minimal Hono-like context
    const setHeaders: Record<string, string> = {};
    let nextWasCalled = false;
    const c: any = {
      get: () => ({ id: 'user-f' }),
      header: (k: string, v: string) => { setHeaders[k] = v; },
      json: (body: any, status: number) => ({ body, status }),
    };
    const next = async () => { nextWasCalled = true; return undefined; };

    // First call passes through to next
    await mw(c, next);
    expect(nextWasCalled).toBe(true);
    // Second call must be rejected — middleware returns early, doesn't call next
    nextWasCalled = false;
    const r2 = await mw(c, next);
    expect(nextWasCalled).toBe(false);
    expect(r2.status).toBe(429);
    expect(r2.body.error).toMatch(/Rate limit/);
    expect(setHeaders['X-RateLimit-Limit']).toBe('1');
  });
});
