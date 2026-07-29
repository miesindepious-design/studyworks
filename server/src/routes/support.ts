/**
 * /api/support — support inbox.
 *
 * POST /api/support         { subject, body } → create ticket
 * GET  /api/support         → my tickets (newest first)
 *
 * Tickets are stored in the DB. If RESEND_API_KEY + SUPPORT_EMAIL are set,
 * a notification email is also sent to the support address (best effort —
 * ticket creation never fails because email failed).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';
import { Resend } from 'resend';

export const supportRouter = new Hono();
supportRouter.use('*', requireAuth);

const CreateBody = z.object({
  subject: z.string().min(1).max(200),
  body:    z.string().min(1).max(10_000),
});

supportRouter.post('/', zValidator('json', CreateBody), async c => {
  const user = c.get('user');
  const { subject, body } = c.req.valid('json');

  const ticket = await prisma.supportTicket.create({
    data: { userId: user.id, subject, body },
  });

  // Best-effort email notification to support staff.
  if (process.env.RESEND_API_KEY && process.env.SUPPORT_EMAIL) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
        to:      process.env.SUPPORT_EMAIL,
        subject: `[Support #${ticket.id.slice(-6)}] ${subject}`,
        text:    `From: ${user.email}\nTicket: ${ticket.id}\n\n${body}`,
      });
    } catch { /* ignore — ticket is already saved */ }
  }

  return c.json(ticket, 201);
});

supportRouter.get('/', async c => {
  const user = c.get('user');
  const tickets = await prisma.supportTicket.findMany({
    where:   { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  return c.json(tickets);
});
