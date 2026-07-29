/**
 * Email-to-save.
 *
 * GET  /api/email-save/address  (auth) → the user's unique inbound address
 * POST /api/inbound-email       (webhook, no session auth) → create note
 *
 * Flow: each user gets save-<token>@<INBOUND_EMAIL_DOMAIN>. They email a
 * link or text to that address; the mail provider (Cloudflare Email Routing,
 * Mailgun, SendGrid inbound parse...) POSTs the parsed message to
 * /api/inbound-email. We find the user by token and create a note titled
 * with the subject.
 *
 * Webhook auth: shared secret in the X-Inbound-Secret header must match
 * INBOUND_EMAIL_SECRET. Without that env var the webhook is disabled (503).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

// ── Authenticated: get my inbound address ─────────────────────────────────────
export const emailSaveRouter = new Hono();
emailSaveRouter.use('*', requireAuth);

emailSaveRouter.get('/address', async c => {
  const user = c.get('user');
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!domain) {
    return c.json({ enabled: false, address: null, reason: 'INBOUND_EMAIL_DOMAIN not configured' });
  }

  let row = await prisma.inboundEmailToken.findUnique({ where: { userId: user.id } });
  if (!row) row = await prisma.inboundEmailToken.create({ data: { userId: user.id } });

  return c.json({ enabled: true, address: `save-${row.token}@${domain}` });
});

// ── Webhook: no session (mail provider calls this) ────────────────────────────
export const inboundEmailRouter = new Hono();

const InboundBody = z.object({
  to:      z.string(),            // "save-<token>@domain"
  from:    z.string().optional(),
  subject: z.string().default('Saved from email'),
  text:    z.string().default(''),
  html:    z.string().optional(),
});

inboundEmailRouter.post('/', zValidator('json', InboundBody), async c => {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return c.json({ error: 'Inbound email not configured' }, 503);
  if (c.req.header('x-inbound-secret') !== secret) return c.json({ error: 'Unauthorized' }, 401);

  const { to, from, subject, text, html } = c.req.valid('json');

  const token = to.match(/^save-([^@]+)@/)?.[1];
  if (!token) return c.json({ error: 'Unrecognized address' }, 404);

  const row = await prisma.inboundEmailToken.findUnique({ where: { token } });
  if (!row) return c.json({ error: 'Unknown token' }, 404);

  // Prefer HTML body (rich content), fall back to plain text wrapped in <p>.
  const content = html?.trim()
    ? html
    : `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>`;

  const note = await prisma.note.create({
    data: {
      userId:  row.userId,
      title:   subject.slice(0, 200),
      content: `${content}<p><em>Saved via email${from ? ` from ${from}` : ''}</em></p>`,
      type:    'note',
      tags:    ['email'],
    },
  });

  return c.json({ success: true, noteId: note.id }, 201);
});
