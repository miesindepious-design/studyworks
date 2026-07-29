/**
 * /api/search  — full-text search across all entities + saved searches CRUD
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const searchRouter = new Hono();
searchRouter.use('/*', requireAuth);

const SavedSearchBody = z.object({
  name:  z.string().min(1).max(200),
  query: z.string().min(1),
});

// ── Full-text search across notes, contacts, flashcards ───────────────────────
searchRouter.get('/', async c => {
  const user  = c.get('user');
  const { q } = c.req.query();

  if (!q || q.trim().length === 0) {
    return c.json({ notes: [], contacts: [], flashcards: [] });
  }

  const term = q.trim();

  const [notes, contacts, flashcards] = await Promise.all([
    prisma.note.findMany({
      where: {
        userId: user.id,
        OR: [
          { title:   { contains: term, mode: 'insensitive' } },
          { content: { contains: term, mode: 'insensitive' } },
          { tags:    { has: term } },
          { summary: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: {
        id:        true,
        title:     true,
        type:      true,
        tags:      true,
        summary:   true,
        updatedAt: true,
        folderId:  true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.contact.findMany({
      where: {
        userId: user.id,
        OR: [
          { name:  { contains: term, mode: 'insensitive' } },
          { role:  { contains: term, mode: 'insensitive' } },
          { notes: { contains: term, mode: 'insensitive' } },
          { tags:  { has: term } },
        ],
      },
      select: { id: true, name: true, role: true, tags: true },
      take: 20,
    }),
    prisma.flashcard.findMany({
      where: {
        userId: user.id,
        OR: [
          { question: { contains: term, mode: 'insensitive' } },
          { answer:   { contains: term, mode: 'insensitive' } },
          { tags:     { has: term } },
        ],
      },
      select: { id: true, question: true, tags: true, difficulty: true },
      take: 20,
    }),
  ]);

  return c.json({ notes, contacts, flashcards });
});

// ── Saved searches ─────────────────────────────────────────────────────────────
searchRouter.get('/saved', async c => {
  const user = c.get('user');
  const saved = await prisma.savedSearch.findMany({
    where:   { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  return c.json(saved);
});

searchRouter.post('/saved', zValidator('json', SavedSearchBody), async c => {
  const user = c.get('user');
  const saved = await prisma.savedSearch.create({
    data: { ...c.req.valid('json'), userId: user.id },
  });
  return c.json(saved, 201);
});

searchRouter.delete('/saved/:id', async c => {
  const user = c.get('user');
  const existing = await prisma.savedSearch.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await prisma.savedSearch.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});
