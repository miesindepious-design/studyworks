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
  type:        z.enum(['standard', 'fill-in', 'cloze']).optional().nullable(),
  topic:       z.string().max(120).optional().nullable(),
  leechCount:  z.number().int().min(0).max(99).optional().nullable(),
  source:      z.string().max(40).optional().nullable(),
  reviewHistory: z.array(z.object({
    date:    z.string().max(20),
    quality: z.number().int().min(0).max(3),
  })).optional().nullable(),
  nextReview:  z.string().datetime().optional().nullable(),
  interval:    z.number().int().nonnegative().optional().nullable(),
  repetitions: z.number().int().nonnegative().optional().nullable(),
  ef:          z.number().min(1.3).max(3.5).optional().nullable(),
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
      question:    body.question,
      answer:      body.answer,
      tags:        body.tags ?? [],
      folderId:    body.folderId ?? undefined,
      difficulty:  body.difficulty ?? undefined,
      type:        body.type ?? 'standard',
      topic:       body.topic ?? undefined,
      leechCount:  body.leechCount ?? undefined,
      source:      body.source ?? undefined,
      reviewHistory: body.reviewHistory ?? undefined,
      nextReview:  body.nextReview ? new Date(body.nextReview) : undefined,
      interval:    body.interval ?? undefined,
      repetitions: body.repetitions ?? undefined,
      ef:          body.ef ?? undefined,
      userId:      user.id,
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
      ...(body.question !== undefined ? { question: body.question } : {}),
      ...(body.answer !== undefined ? { answer: body.answer } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId ?? null } : {}),
      ...(body.difficulty !== undefined ? { difficulty: body.difficulty ?? null } : {}),
      ...(body.type !== undefined ? { type: body.type ?? 'standard' } : {}),
      ...(body.topic !== undefined ? { topic: body.topic ?? null } : {}),
      ...(body.leechCount !== undefined ? { leechCount: body.leechCount ?? 0 } : {}),
      ...(body.source !== undefined ? { source: body.source ?? null } : {}),
      ...(body.reviewHistory !== undefined ? { reviewHistory: body.reviewHistory ?? undefined } : {}),
      ...(body.nextReview !== undefined
        ? { nextReview: body.nextReview ? new Date(body.nextReview) : null }
        : {}),
      ...(body.interval !== undefined ? { interval: body.interval ?? null } : {}),
      ...(body.repetitions !== undefined ? { repetitions: body.repetitions ?? null } : {}),
      ...(body.ef !== undefined ? { ef: body.ef ?? null } : {}),
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
