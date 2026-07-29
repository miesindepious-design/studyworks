/**
 * /api/practice  — CRUD for practice questions
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const practiceRouter = new Hono();
practiceRouter.use('/*', requireAuth);

const PracticeBody = z.object({
  question: z.string().min(1),
  answer:   z.string().min(1),
  type:     z.enum(['multiple-choice', 'true-false', 'open']),
  options:  z.array(z.string()).default([]),
  noteId:   z.string().optional().nullable(),
});

const BulkCreateBody = z.object({
  questions: z.array(PracticeBody).min(1),
});

const BulkDeleteBody = z.object({ ids: z.array(z.string()).min(1) });

// ── List ───────────────────────────────────────────────────────────────────────
practiceRouter.get('/', async c => {
  const user   = c.get('user');
  const { noteId, type } = c.req.query();

  const questions = await prisma.practiceQuestion.findMany({
    where: {
      userId: user.id,
      ...(noteId ? { noteId } : {}),
      ...(type   ? { type   } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return c.json(questions);
});

// ── Get ────────────────────────────────────────────────────────────────────────
practiceRouter.get('/:id', async c => {
  const user = c.get('user');
  const q    = await prisma.practiceQuestion.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!q) return c.json({ error: 'Not found' }, 404);
  return c.json(q);
});

// ── Create single ──────────────────────────────────────────────────────────────
practiceRouter.post('/', zValidator('json', PracticeBody), async c => {
  const user = c.get('user');
  const q    = await prisma.practiceQuestion.create({
    data: { ...c.req.valid('json'), userId: user.id },
  });
  return c.json(q, 201);
});

// ── Bulk create (from AI generation) ─────────────────────────────────────────
practiceRouter.post('/bulk', zValidator('json', BulkCreateBody), async c => {
  const user = c.get('user');
  const { questions } = c.req.valid('json');

  const created = await prisma.$transaction(
    questions.map(q =>
      prisma.practiceQuestion.create({
        data: { ...q, userId: user.id },
      })
    )
  );
  return c.json(created, 201);
});

// ── Update ─────────────────────────────────────────────────────────────────────
practiceRouter.put('/:id', zValidator('json', PracticeBody.partial()), async c => {
  const user = c.get('user');
  const existing = await prisma.practiceQuestion.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const q = await prisma.practiceQuestion.update({
    where: { id: c.req.param('id') },
    data:  c.req.valid('json'),
  });
  return c.json(q);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
practiceRouter.delete('/:id', async c => {
  const user = c.get('user');
  const existing = await prisma.practiceQuestion.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await prisma.practiceQuestion.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Bulk delete ────────────────────────────────────────────────────────────────
practiceRouter.delete('/', zValidator('json', BulkDeleteBody), async c => {
  const user = c.get('user');
  const { ids } = c.req.valid('json');
  await prisma.practiceQuestion.deleteMany({ where: { id: { in: ids }, userId: user.id } });
  return c.json({ success: true });
});
