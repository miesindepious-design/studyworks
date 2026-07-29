/**
 * /api/contacts  — CRUD for contacts/people
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const contactsRouter = new Hono();
contactsRouter.use('/*', requireAuth);

const ContactBody = z.object({
  name:         z.string().min(1).max(200),
  role:         z.string().min(1).max(200),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
  tags:         z.array(z.string()).default([]),
  folderId:     z.string().optional().nullable(),
  nextReminder: z.string().datetime().optional().nullable(),
  lastContacted: z.string().datetime().optional().nullable(),
});

const BulkDeleteBody = z.object({ ids: z.array(z.string()).min(1) });

// ── List ───────────────────────────────────────────────────────────────────────
contactsRouter.get('/', async c => {
  const user     = c.get('user');
  const { folder, search } = c.req.query();

  const contacts = await prisma.contact.findMany({
    where: {
      userId: user.id,
      ...(folder ? { folderId: folder } : {}),
      ...(search
        ? {
            OR: [
              { name:  { contains: search, mode: 'insensitive' } },
              { role:  { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { tags:  { has: search } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
  });

  return c.json(contacts);
});

// ── Get ────────────────────────────────────────────────────────────────────────
contactsRouter.get('/:id', async c => {
  const user    = c.get('user');
  const contact = await prisma.contact.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!contact) return c.json({ error: 'Not found' }, 404);
  return c.json(contact);
});

// ── Create ─────────────────────────────────────────────────────────────────────
contactsRouter.post('/', zValidator('json', ContactBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const contact = await prisma.contact.create({
    data: {
      ...body,
      userId:       user.id,
      nextReminder: body.nextReminder  ? new Date(body.nextReminder)  : undefined,
      lastContacted: body.lastContacted ? new Date(body.lastContacted) : undefined,
    },
  });
  return c.json(contact, 201);
});

// ── Update ─────────────────────────────────────────────────────────────────────
contactsRouter.put('/:id', zValidator('json', ContactBody.partial()), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const existing = await prisma.contact.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const contact = await prisma.contact.update({
    where: { id: c.req.param('id') },
    data: {
      ...body,
      nextReminder: body.nextReminder !== undefined
        ? (body.nextReminder ? new Date(body.nextReminder) : null)
        : undefined,
      lastContacted: body.lastContacted !== undefined
        ? (body.lastContacted ? new Date(body.lastContacted) : null)
        : undefined,
    },
  });
  return c.json(contact);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
contactsRouter.delete('/:id', async c => {
  const user = c.get('user');
  const existing = await prisma.contact.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await prisma.contact.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Bulk delete ────────────────────────────────────────────────────────────────
contactsRouter.delete('/', zValidator('json', BulkDeleteBody), async c => {
  const user = c.get('user');
  const { ids } = c.req.valid('json');
  await prisma.contact.deleteMany({ where: { id: { in: ids }, userId: user.id } });
  return c.json({ success: true });
});
