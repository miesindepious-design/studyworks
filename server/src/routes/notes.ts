/**
 * /api/notes  — full CRUD + highlights, personal notes, attachments
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { enforceFreeItemLimit, requirePro } from '../lib/tier.js';
import { prisma } from '../lib/prisma.js';

export const notesRouter = new Hono();
notesRouter.use('/*', requireAuth);

// ── Schemas ───────────────────────────────────────────────────────────────────
const NoteBody = z.object({
  title:        z.string().min(1).max(500),
  content:      z.string(),
  type:         z.enum(['note', 'article', 'idea', 'project']).default('note'),
  tags:         z.array(z.string()).default([]),
  folderId:     z.string().optional().nullable(),
  summary:      z.string().optional().nullable(),
  nextReminder: z.string().datetime().optional().nullable(),
});

const HighlightBody = z.object({
  text:  z.string().min(1),
  color: z.string().min(1),
  note:  z.string().optional(),
});

const PersonalNoteBody = z.object({
  content: z.string().min(1),
});

const BulkDeleteBody = z.object({ ids: z.array(z.string()).min(1) });

// ── List notes ─────────────────────────────────────────────────────────────────
notesRouter.get('/', async c => {
  const user     = c.get('user');
  const { folder, type, search } = c.req.query();

  const notes = await prisma.note.findMany({
    where: {
      userId:   user.id,
      ...(folder ? { folderId: folder } : {}),
      ...(type   ? { type }             : {}),
      ...(search
        ? {
            OR: [
              { title:   { contains: search, mode: 'insensitive' } },
              { content: { contains: search, mode: 'insensitive' } },
              { tags:    { has: search } },
            ],
          }
        : {}),
    },
    include: {
      highlights:    true,
      personalNotes: true,
      attachments:   true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return c.json(notes);
});

// ── Get single note ────────────────────────────────────────────────────────────
notesRouter.get('/:id', async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({
    where: { id: c.req.param('id'), userId: user.id },
    include: { highlights: true, personalNotes: true, attachments: true },
  });
  if (!note) return c.json({ error: 'Not found' }, 404);
  return c.json(note);
});

// ── Create note ────────────────────────────────────────────────────────────────
notesRouter.post('/', zValidator('json', NoteBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Free tier limit (server-side enforcement)
  if (user.tier !== 'PRO') {
    const blocked = await enforceFreeItemLimit(c, user.id);
    if (blocked) return blocked;
  }

  const note = await prisma.note.create({
    data: {
      ...body,
      userId:      user.id,
      nextReminder: body.nextReminder ? new Date(body.nextReminder) : undefined,
    },
    include: { highlights: true, personalNotes: true, attachments: true },
  });

  return c.json(note, 201);
});

// ── Update note ────────────────────────────────────────────────────────────────
notesRouter.put('/:id', zValidator('json', NoteBody.partial()), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const existing = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const note = await prisma.note.update({
    where: { id: c.req.param('id') },
    data: {
      ...body,
      nextReminder: body.nextReminder !== undefined
        ? (body.nextReminder ? new Date(body.nextReminder) : null)
        : undefined,
    },
    include: { highlights: true, personalNotes: true, attachments: true },
  });

  return c.json(note);
});

// ── Delete note ────────────────────────────────────────────────────────────────
notesRouter.delete('/:id', async c => {
  const user = c.get('user');
  const existing = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await prisma.note.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Bulk delete ────────────────────────────────────────────────────────────────
notesRouter.delete('/', zValidator('json', BulkDeleteBody), async c => {
  const user = c.get('user');
  const { ids } = c.req.valid('json');
  await prisma.note.deleteMany({ where: { id: { in: ids }, userId: user.id } });
  return c.json({ success: true });
});

// ── Highlights ─────────────────────────────────────────────────────────────────
notesRouter.post('/:id/highlights', zValidator('json', HighlightBody), async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);

  const highlight = await prisma.highlight.create({
    data: { ...c.req.valid('json'), noteId: c.req.param('id') },
  });
  return c.json(highlight, 201);
});

notesRouter.delete('/:id/highlights/:hId', async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  await prisma.highlight.deleteMany({ where: { id: c.req.param('hId'), noteId: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Personal notes (annotations) ──────────────────────────────────────────────
notesRouter.get('/:id/personal-notes', async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  const pns = await prisma.personalNote.findMany({ where: { noteId: c.req.param('id') } });
  return c.json(pns);
});

notesRouter.post('/:id/personal-notes', zValidator('json', PersonalNoteBody), async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  const pn = await prisma.personalNote.create({
    data: { ...c.req.valid('json'), noteId: c.req.param('id') },
  });
  return c.json(pn, 201);
});

notesRouter.put('/:id/personal-notes/:pnId', zValidator('json', PersonalNoteBody), async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  const pn = await prisma.personalNote.update({
    where: { id: c.req.param('pnId') },
    data:  c.req.valid('json'),
  });
  return c.json(pn);
});

notesRouter.delete('/:id/personal-notes/:pnId', async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  await prisma.personalNote.deleteMany({ where: { id: c.req.param('pnId'), noteId: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Attachments (metadata only — storage handled client-side or via presign) ──
const AttachmentBody = z.object({
  name:       z.string().min(1),
  type:       z.enum(['pdf', 'image', 'audio']),
  storageKey: z.string().min(1),
  url:        z.string().url(),
  size:       z.number().int().positive(),
});

notesRouter.post('/:id/attachments', zValidator('json', AttachmentBody), async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  const att = await prisma.attachment.create({
    data: { ...c.req.valid('json'), noteId: c.req.param('id') },
  });
  return c.json(att, 201);
});

notesRouter.delete('/:id/attachments/:aId', async c => {
  const user = c.get('user');
  const note = await prisma.note.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!note) return c.json({ error: 'Not found' }, 404);
  await prisma.attachment.deleteMany({ where: { id: c.req.param('aId'), noteId: c.req.param('id') } });
  return c.json({ success: true });
});
