/**
 * /api/exams — exam plans.
 *
 * "My biology paper is in 12 days" is the single most motivating fact a
 * student can put on a dashboard. A plan stores the date and the subjects;
 * the client back-calculates how much has to be reviewed each day from the
 * spaced-repetition queue and shows the countdown.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';

export const examsRouter = new Hono();
examsRouter.use('*', requireAuth);

const PlanBody = z.object({
  title:      z.string().min(1).max(120),
  examDate:   z.string().min(4).max(40),
  subjects:   z.array(z.string().max(80)).max(20).default([]),
  dailyTarget: z.number().int().min(1).max(500).optional(),
  notes:      z.string().max(2000).optional(),
});

const PatchBody = z.object({
  title:       z.string().min(1).max(120).optional(),
  examDate:    z.string().min(4).max(40).optional(),
  subjects:    z.array(z.string().max(80)).max(20).optional(),
  dailyTarget: z.number().int().min(1).max(500).optional(),
  notes:       z.string().max(2000).optional(),
  completed:   z.boolean().optional(),
});

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

examsRouter.get('/', async c => {
  const user = c.get('user');
  const plans = await prisma.examPlan.findMany({
    where: { userId: user.id },
    orderBy: { examDate: 'asc' },
  });
  return c.json(plans.map(p => ({
    id: p.id,
    title: p.title,
    examDate: p.examDate,
    subjects: p.subjects,
    dailyTarget: p.dailyTarget,
    notes: p.notes,
    completed: p.completed,
    createdAt: p.createdAt,
  })));
});

examsRouter.post('/', zValidator('json', PlanBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const date = parseDate(body.examDate);
  if (!date) return c.json({ error: 'That exam date could not be read' }, 400);

  const plan = await prisma.examPlan.create({
    data: {
      userId: user.id,
      title: body.title,
      examDate: date,
      subjects: body.subjects,
      dailyTarget: body.dailyTarget ?? 20,
      notes: body.notes,
    },
  });
  return c.json(plan);
});

examsRouter.patch('/:id', zValidator('json', PatchBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const id = c.req.param('id');

  const existing = await prisma.examPlan.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Plan not found' }, 404);

  const date = body.examDate ? parseDate(body.examDate) : null;
  if (body.examDate && !date) return c.json({ error: 'That exam date could not be read' }, 400);

  const plan = await prisma.examPlan.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(date ? { examDate: date } : {}),
      ...(body.subjects !== undefined ? { subjects: body.subjects } : {}),
      ...(body.dailyTarget !== undefined ? { dailyTarget: body.dailyTarget } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.completed !== undefined ? { completed: body.completed } : {}),
    },
  });
  return c.json(plan);
});

examsRouter.delete('/:id', async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await prisma.examPlan.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Plan not found' }, 404);
  await prisma.examPlan.delete({ where: { id } });
  return c.json({ ok: true });
});
