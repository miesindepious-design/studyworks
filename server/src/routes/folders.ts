/**
 * /api/folders  — CRUD for folders (regular + smart)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

export const foldersRouter = new Hono();
foldersRouter.use('/*', requireAuth);

const FolderBody = z.object({
  name:        z.string().min(1).max(200),
  isSmart:     z.boolean().default(false),
  smartFilter: z.string().optional().nullable(),
});

// ── List ───────────────────────────────────────────────────────────────────────
foldersRouter.get('/', async c => {
  const user = c.get('user');
  const folders = await prisma.folder.findMany({
    where:   { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  return c.json(folders);
});

// ── Get ────────────────────────────────────────────────────────────────────────
foldersRouter.get('/:id', async c => {
  const user   = c.get('user');
  const folder = await prisma.folder.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!folder) return c.json({ error: 'Not found' }, 404);
  return c.json(folder);
});

// ── Create ─────────────────────────────────────────────────────────────────────
foldersRouter.post('/', zValidator('json', FolderBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Enforce Pro-only smart folders — tier check
  if (body.isSmart && c.get('user').tier !== 'PRO') {
    return c.json({ error: 'Smart folders require Pro' }, 403);
  }

  const folder = await prisma.folder.create({
    data: { ...body, userId: user.id },
  });
  return c.json(folder, 201);
});

// ── Update ─────────────────────────────────────────────────────────────────────
foldersRouter.put('/:id', zValidator('json', FolderBody.partial()), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const existing = await prisma.folder.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const folder = await prisma.folder.update({
    where: { id: c.req.param('id') },
    data:  body,
  });
  return c.json(folder);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
// Items inside are not deleted — folderId is set to NULL (onDelete: SetNull in schema)
foldersRouter.delete('/:id', async c => {
  const user = c.get('user');

  const existing = await prisma.folder.findFirst({ where: { id: c.req.param('id'), userId: user.id } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Prevent deleting the default system folder if any (id = 'default')
  if (c.req.param('id') === 'default') {
    return c.json({ error: 'Cannot delete the default folder' }, 400);
  }

  await prisma.folder.delete({ where: { id: c.req.param('id') } });
  return c.json({ success: true });
});

// ── Get folder contents (notes + contacts + flashcards) ─────────────────────
foldersRouter.get('/:id/contents', async c => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const folder = await prisma.folder.findFirst({ where: { id: folderId, userId: user.id } });
  if (!folder) return c.json({ error: 'Not found' }, 404);

  const [notes, contacts, flashcards] = await Promise.all([
    prisma.note.findMany({
      where:   { userId: user.id, folderId },
      orderBy: { updatedAt: 'desc' },
      select:  { id: true, title: true, type: true, tags: true, updatedAt: true },
    }),
    prisma.contact.findMany({
      where:   { userId: user.id, folderId },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, role: true },
    }),
    prisma.flashcard.findMany({
      where:   { userId: user.id, folderId },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, question: true, difficulty: true },
    }),
  ]);

  return c.json({ folder, notes, contacts, flashcards });
});
