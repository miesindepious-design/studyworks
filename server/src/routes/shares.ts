/**
 * /api/shares — folder share links (Pro feature).
 *
 * POST   /api/shares            { folderId, expiresInDays? } → create link
 * GET    /api/shares            → list my share links
 * DELETE /api/shares/:id        → revoke
 *
 * PUBLIC (no auth):
 * GET    /api/shares/public/:token → folder name + read-only notes
 *
 * Share links are unguessable cuid tokens. Only note title/content/tags are
 * exposed — no contacts, flashcards, or personal data.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { prisma } from '../lib/prisma.js';

export const sharesRouter = new Hono();

// ── Public endpoint FIRST (no auth) ───────────────────────────────────────────
sharesRouter.get('/public/:token', async c => {
  const token = c.req.param('token');
  const share = await prisma.folderShare.findUnique({ where: { token } });

  if (!share || share.revoked) return c.json({ error: 'Share not found' }, 404);
  if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share expired' }, 410);

  const folder = await prisma.folder.findUnique({ where: { id: share.folderId } });
  if (!folder) return c.json({ error: 'Folder no longer exists' }, 404);

  const notes = await prisma.note.findMany({
    where:   { folderId: share.folderId, userId: share.userId },
    select:  { id: true, title: true, content: true, tags: true, type: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take:    200,
  });

  return c.json({ folderName: folder.name, noteCount: notes.length, notes });
});

// ── Authenticated management endpoints ────────────────────────────────────────
sharesRouter.use('*', requireAuth);

const CreateBody = z.object({
  folderId:      z.string().min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

sharesRouter.post('/', requirePro, zValidator('json', CreateBody), async c => {
  const user = c.get('user');
  const { folderId, expiresInDays } = c.req.valid('json');

  // Must own the folder
  const folder = await prisma.folder.findFirst({ where: { id: folderId, userId: user.id } });
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const share = await prisma.folderShare.create({
    data: {
      folderId,
      userId: user.id,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    },
  });

  return c.json(share, 201);
});

sharesRouter.get('/', async c => {
  const user = c.get('user');
  const shares = await prisma.folderShare.findMany({
    where:   { userId: user.id, revoked: false },
    orderBy: { createdAt: 'desc' },
  });
  return c.json(shares);
});

sharesRouter.delete('/:id', async c => {
  const user = c.get('user');
  const result = await prisma.folderShare.updateMany({
    where: { id: c.req.param('id'), userId: user.id },
    data:  { revoked: true },
  });
  if (result.count === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});
