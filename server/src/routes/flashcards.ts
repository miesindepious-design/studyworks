/**
 * /api/flashcards  — CRUD + SM-2 review update
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const flashcardsRouter = new Hono();
flashcardsRouter.use('/*', requireAuth);

const FlashcardBody = z.object({
  question:    z.string().min(1),
  answer:      z.string().min(1),
  tags:        z.array(z.string()).default([]),
  folderId:    z.string().optional().nullable(),
  difficulty:  z.enum(['easy', 'medium', 'hard']).optional().nullable(),
  nextReview:  z.string().datetime().optional().nullable(),
  interval:    z.number().int().nonnegative().optional().nullable(),
  repetitions: z.number().int().nonnegative().optional().nullable(),
});

const BulkBody = z.object({
  flashcards: z.array(FlashcardBody.extend({ id: z.string().optional() })).min(1),
});

const BulkDeleteBody = z.object({ ids: z.array(z.string()).min(1) });

// ── List ───────────────────────────────────────────────────────────────────────
flashcardsRouter.get('/', async c => {
  const user      = c.get('user');
  const { folder, difficulty, dueOnly } = c.req.query();

  const cards = await prisma.flashcard.findMany({
    where: {
      userId: user.id,
      ...(folder     ? { folderId: folder }                               : {}),
      ...(difficulty ? { difficulty }                                     : {}),
      ...(dueOnly === 'true'
        ? { OR: [{ nextReview: null }, { nextReview: { lte: new Date() } }] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  return c.json(cards);
});

// ── Get ────────────────────────────────────────────────────────────────────────
flashcardsRouter.get('/:id', async c => {
  const user = c.get('user');
  const card = await prisma.flashcard.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!card) return c.json({ error: 'Not found' }, 404);
  return c.json(card);
});

// ── Create ─────────────────────────────────────────────────────────────────────
flashcardsRouter.post('/', zValidator('json', FlashcardBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const card = await prisma.flashcard.create({
    data: {
      ...body,
      userId:     user.id,
      nextReview: body.nextReview ? new Date(body.nextReview) : undefined,
    },
  });
  return c.json(card, 201);
});

// ── Bulk create (from AI generation) ─────────────────────────────────────────
flashcardsRouter.post('/bulk', zValidator('json', BulkBody), async c => {
  const user  = c.get('user');
  const { flashcards } = c.req.valid('json');

  const created = await prisma.$transaction(
    flashcards.map(fc =>
      prisma.flashcard.create({
        data: {
          question:    fc.question,
          answer:      fc.answer,
          tags:        fc.tags ?? [],
          folderId:    fc.folderId ?? undefined,
          difficulty:  fc.difficulty ?? undefined,
          nextReview:  fc.nextReview ? new Date(fc.nextReview) : undefined,
          interval:    fc.interval   ?? undefined,
          repetitions: fc.repetitions ?? undefined,
          userId:      user.id,
        },
      })
    )
  );

  return c.json(created, 201);
});

// ── Update (includes SM-2 review fields) ─────────────────────────────────────
flashcardsRouter.put('/:id', zValidator('json', FlashcardBody.partial()), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const existing = await prisma.flashcard.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const card = await prisma.flashcard.update({
    where: { id: c.req.param('id') },
    data: {
      ...body,
      nextReview: body.nextReview !== undefined
        ? (body.nextReview ? new Date(body.nextReview) : null)
        : undefined,
    },
  });
  return c.json(card);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
flashcardsRouter.delete('/:id', async c => {
  const user = c.get('user');
  const existing = await prisma.flashcard.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await prisma.flashcard.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Bulk delete ────────────────────────────────────────────────────────────────
flashcardsRouter.delete('/', zValidator('json', BulkDeleteBody), async c => {
  const user = c.get('user');
  const { ids } = c.req.valid('json');
  await prisma.flashcard.deleteMany({ where: { id: { in: ids }, userId: user.id } });
  return c.json({ success: true });
});
