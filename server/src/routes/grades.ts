/**
 * /api/grades — the grade tracker's assignments.
 *
 * A student with three courses and a part-time job has one number they care
 * about: where they stand, and what they have to score on the rest to hit
 * their target. That only works if the weights are honest, so every
 * assignment carries the share of the course grade it is worth.
 *
 * The route is deliberately thin — it stores and returns the raw numbers.
 * The weighted maths lives in `src/utils/grades.ts` so the browser and the
 * tests agree on it without a round trip.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';

export const gradesRouter = new Hono();
gradesRouter.use('*', requireAuth);

const AssignmentBody = z.object({
  title:    z.string().min(1).max(160),
  course:   z.string().max(80).default('General'),
  category: z.string().max(40).default('Assignment'),
  // Percentage points of the course grade. Zero is allowed — an assignment
  // can be tracked for its due date before its weight is known.
  weight:   z.number().min(0).max(1000).default(0),
  score:    z.number().min(0).max(100000).nullable().optional(),
  maxScore: z.number().positive().max(100000).default(100),
  dueDate:  z.string().max(40).nullable().optional(),
  notes:    z.string().max(2000).nullable().optional(),
});

const PatchBody = z.object({
  title:    z.string().min(1).max(160).optional(),
  course:   z.string().max(80).optional(),
  category: z.string().max(40).optional(),
  weight:   z.number().min(0).max(1000).optional(),
  score:    z.number().min(0).max(100000).nullable().optional(),
  maxScore: z.number().positive().max(100000).optional(),
  dueDate:  z.string().max(40).nullable().optional(),
  notes:    z.string().max(2000).nullable().optional(),
});

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shape(a: {
  id: string; title: string; course: string; category: string;
  weight: number; score: number | null; maxScore: number;
  dueDate: Date | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id,
    title: a.title,
    course: a.course,
    category: a.category,
    weight: a.weight,
    score: a.score,
    maxScore: a.maxScore,
    dueDate: a.dueDate,
    notes: a.notes,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

gradesRouter.get('/', async c => {
  const user = c.get('user');
  const items = await prisma.assignment.findMany({
    where: { userId: user.id },
    orderBy: [{ course: 'asc' }, { dueDate: 'asc' }],
  });
  return c.json(items.map(shape));
});

gradesRouter.post('/', zValidator('json', AssignmentBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const created = await prisma.assignment.create({
    data: {
      userId: user.id,
      title: body.title,
      course: body.course,
      category: body.category,
      weight: body.weight,
      score: body.score ?? null,
      maxScore: body.maxScore,
      dueDate: parseDate(body.dueDate),
      notes: body.notes ?? null,
    },
  });
  return c.json(shape(created));
});

gradesRouter.patch('/:id', zValidator('json', PatchBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const id = c.req.param('id');

  const existing = await prisma.assignment.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Assignment not found' }, 404);

  const updated = await prisma.assignment.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.course !== undefined ? { course: body.course } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.weight !== undefined ? { weight: body.weight } : {}),
      ...(body.score !== undefined ? { score: body.score } : {}),
      ...(body.maxScore !== undefined ? { maxScore: body.maxScore } : {}),
      ...(body.dueDate !== undefined ? { dueDate: parseDate(body.dueDate) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });
  return c.json(shape(updated));
});

gradesRouter.delete('/:id', async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await prisma.assignment.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Assignment not found' }, 404);
  await prisma.assignment.delete({ where: { id } });
  return c.json({ ok: true });
});
