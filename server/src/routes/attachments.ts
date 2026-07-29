/**
 * /api/attachments — presign + register + delete file attachments.
 *
 * Flow:
 *   1. Client calls POST /api/attachments/presign with { filename,
 *      contentType, size }. Server returns a presigned PUT URL, the
 *      object key, and a public URL.
 *   2. Client PUTs the file body directly to uploadUrl.
 *   3. Client calls POST /api/notes/:noteId/attachments with { storageKey,
 *      url, name, type, size } to register the attachment on the note.
 *   4. To delete: DELETE /api/attachments/:id. Server removes both the
 *      DB row and the R2 object.
 *
 * If R2 isn't configured (`isEnabled()` returns false), the server returns
 * a 503 from /presign and the client falls back to the legacy base64-in-IDB
 * path. This keeps the dev experience working without R2.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { isEnabled, presignPut, deleteObject } from '../lib/storage.js';
import { prisma } from '../lib/prisma.js';

export const attachmentsRouter = new Hono();
attachmentsRouter.use('/*', requireAuth);

// ── 1. Presign ────────────────────────────────────────────────────────────────
attachmentsRouter.post('/presign', requirePro, zValidator('json', z.object({
  filename:    z.string().min(1).max(256),
  contentType: z.string().min(1).max(120),
  size:        z.number().int().positive().max(100 * 1024 * 1024), // 100 MB hard cap
})), async c => {
  if (!isEnabled()) {
    return c.json({
      error: 'Cloud storage is not configured. Falling back to local storage.',
      storageEnabled: false,
    }, 503);
  }
  const user = c.get('user');
  const { filename, contentType, size } = c.req.valid('json');
  try {
    const result = await presignPut({ userId: user.id, filename, contentType, size });
    return c.json({ ...result, storageEnabled: true });
  } catch (err: any) {
    return c.json({ error: err.message, storageEnabled: false }, err.statusCode ?? 500);
  }
});

// ── 2. Register on a note ─────────────────────────────────────────────────────
attachmentsRouter.post('/notes/:noteId/attachments', requireAuth, zValidator('json', z.object({
  storageKey: z.string().min(1),
  url:        z.string().url(),
  name:       z.string().min(1).max(256),
  type:       z.enum(['pdf', 'image', 'audio']),
  size:       z.number().int().positive(),
})), async c => {
  const user = c.get('user');
  const { noteId } = c.req.param();
  const body = c.req.valid('json');

  // Ensure the note exists and belongs to the user.
  const note = await prisma.note.findFirst({ where: { id: noteId, userId: user.id } });
  if (!note) return c.json({ error: 'Note not found' }, 404);

  const att = await prisma.attachment.create({
    data: {
      noteId,
      name:       body.name,
      type:       body.type,
      storageKey: body.storageKey,
      url:        body.url,
      size:       body.size,
    },
  });
  return c.json({ attachment: att });
});

// ── 3. Delete ─────────────────────────────────────────────────────────────────
attachmentsRouter.delete('/:id', requireAuth, async c => {
  const user = c.get('user');
  const id   = c.req.param('id');

  // Find + verify ownership via the note's userId.
  const att = await prisma.attachment.findUnique({
    where:   { id },
    include: { note: { select: { userId: true } } },
  });
  if (!att || att.note.userId !== user.id) {
    return c.json({ error: 'Attachment not found' }, 404);
  }
  // Remove the R2 object first; if it fails the DB row stays, which is
  // recoverable (an orphan is fine; a missing object is broken).
  await deleteObject(att.storageKey);
  await prisma.attachment.delete({ where: { id } });
  return c.json({ success: true });
});
