/**
 * /api/shares — folder share links (Pro feature).
 *
 * POST   /api/shares            { folderId, expiresInDays?, role? } → create link
 * GET    /api/shares            → list my share links
 * DELETE /api/shares/:id        → revoke
 *
 * PUBLIC (no auth):
 * GET    /api/shares/public/:token → folder name + read-only notes
 *
 * Share links are unguessable cuid tokens. Only note title/content/tags are
 * exposed — no contacts, flashcards, or personal data.
 *
 * A link has a role. "viewer" (the default) is the original behaviour: a
 * read-only page anybody with the link can read. "editor" makes it a study
 * group — the public page stays read-only, but somebody who signs in and
 * joins through the link can write into the folder. See routes/collab.ts.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { prisma } from '../lib/prisma.js';
import { collabManager } from '../lib/collabManager.js';
import { closeLostAccess } from '../lib/collabAccess.js';

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

  // `role` tells the public page whether to offer "sign in to edit". The
  // page itself never lets anybody write, whatever the role.
  return c.json({ folderName: folder.name, noteCount: notes.length, notes, role: share.role });
});

// ── Authenticated management endpoints ────────────────────────────────────────
sharesRouter.use('*', requireAuth);

const CreateBody = z.object({
  folderId:      z.string().min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  role:          z.enum(['viewer', 'editor']).default('viewer'),
});

sharesRouter.post('/', requirePro, zValidator('json', CreateBody), async c => {
  const user = c.get('user');
  const { folderId, expiresInDays, role } = c.req.valid('json');

  // Must own the folder
  const folder = await prisma.folder.findFirst({ where: { id: folderId, userId: user.id } });
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  const share = await prisma.folderShare.create({
    data: {
      folderId,
      userId: user.id,
      role,
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
  const share = await prisma.folderShare.findFirst({
    where: { id: c.req.param('id'), userId: user.id, revoked: false },
    select: { id: true, folderId: true, members: { select: { userId: true } } },
  });
  if (!share) return c.json({ error: 'Not found' }, 404);

  await prisma.folderShare.update({ where: { id: share.id }, data: { revoked: true } });

  // Revoking the link ends the access it granted. Anyone whose only way in
  // was this link loses their live connection too, not just their next
  // request.
  await closeLostAccess(
    share.folderId,
    share.members.map(m => m.userId),
    (f, u, reason) => collabManager.closeUser(f, u, reason),
  );

  return c.json({ success: true });
});
