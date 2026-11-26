/**
 * /api/digest — the weekly email digest.
 *
 *   GET   /api/digest/preferences → { enabled, day }
 *   PATCH /api/digest/preferences → turn it on or off, pick the day
 *   POST  /api/digest/send        → send my digest right now
 *   POST  /api/digest/run         → the weekly run (secret only)
 *
 * The digest is opt-in and off by default. A student who did not ask for an
 * email never receives one, and turning it off stops it immediately.
 *
 * The gathering and the sending live in `lib/digestRunner.ts` so the cron
 * job and this route do exactly the same thing.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Context, Next } from 'hono';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import {
  DIGEST_DAYS,
  isEmailConfigured,
  runWeeklyDigest,
  sendDigestFor,
} from '../lib/digestRunner.js';

export const digestRouter = new Hono();

export { DIGEST_DAYS };

// ── Preferences ────────────────────────────────────────────────────────────────

const PreferencesBody = z.object({
  enabled: z.boolean(),
  // 0 = Sunday … 6 = Saturday.
  day: z.number().int().min(0).max(6).optional(),
});

digestRouter.get('/preferences', requireAuth, async c => {
  const user = c.get('user');
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { digestEnabled: true, digestDay: true, digestLastSentAt: true },
  });
  return c.json({
    enabled: row?.digestEnabled ?? false,
    day: row?.digestDay ?? 1,
    lastSentAt: row?.digestLastSentAt ?? null,
  });
});

digestRouter.patch('/preferences', requireAuth, zValidator('json', PreferencesBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      digestEnabled: body.enabled,
      ...(body.day !== undefined ? { digestDay: body.day } : {}),
    },
  });
  return c.json({ ok: true, enabled: body.enabled, day: body.day });
});

// ── Sending ────────────────────────────────────────────────────────────────────

digestRouter.post('/send', requireAuth, async c => {
  const user = c.get('user');

  if (!isEmailConfigured()) {
    return c.json({ error: 'Email is not configured on this server.' }, 503);
  }

  try {
    const sent = await sendDigestFor(user.id, user.email);
    return c.json({ ok: sent });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── The weekly run ─────────────────────────────────────────────────────────────

/**
 * Guard for the endpoint that mails everybody at once.
 *
 * The secret IS the authorisation here: this is the one endpoint that mails
 * a lot of people at once, so it is triggered by a cron host that holds
 * `DIGEST_SECRET` rather than by a signed-in student. There is no default
 * value — an unset secret means the endpoint refuses everybody.
 */
async function requireDigestSecret(c: Context, next: Next) {
  const expected = process.env.DIGEST_SECRET;
  const given = c.req.header('x-digest-secret');
  if (!expected || given !== expected) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}

digestRouter.post('/run', requireDigestSecret, async c => {
  const result = await runWeeklyDigest(new Date());
  return c.json({ ok: true, ...result });
});
