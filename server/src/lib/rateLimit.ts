/**
 * rateLimit.ts — tiny in-memory rate limiter for the AI proxy.
 *
 * No external deps (no Redis, no @hono/rate-limiter). Just a per-user
 * counter that resets every minute. Suitable for the scale of a single
 * backend; if we move to a multi-instance deployment, swap this for
 * `@hono/rate-limiter` with a shared store.
 *
 * Used to prevent a Pro user from hammering the AI provider API. The
 * pricing page advertises "unlimited AI" so the limit has to be generous
 * but not zero. Default: 60 calls / minute / user.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const DEFAULT_LIMIT  = 60;    // calls per window
const DEFAULT_WINDOW = 60_000; // 1 minute in ms

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  resetAtMs:  number;
}

export function rateLimit(
  key:        string,
  limit:      number = DEFAULT_LIMIT,
  windowMs:   number = DEFAULT_WINDOW
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAtMs: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAtMs: bucket.resetAt };
  }

  bucket.count++;
  return { allowed: true, remaining: limit - bucket.count, resetAtMs: bucket.resetAt };
}

/** Hono middleware factory. */
export function rateLimitMiddleware(limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW) {
  return async (c: any, next: any) => {
    const user = c.get('user');
    if (!user) return next(); // requireAuth will handle; this is defense-in-depth.
    const result = rateLimit(user.id, limit, windowMs);
    c.header('X-RateLimit-Limit',     String(limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset',     String(Math.floor(result.resetAtMs / 1000)));
    if (!result.allowed) {
      return c.json({ error: 'Rate limit exceeded. Slow down.', retryAfter: result.resetAtMs }, 429);
    }
    await next();
  };
}
