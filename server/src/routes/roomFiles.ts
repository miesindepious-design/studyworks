/**
 * Shared study files — the group's material, dropped into the lobby.
 *
 *   GET    /api/lobby/:code/files          → the files shared in this lobby
 *   POST   /api/lobby/:code/files          → add a file (metadata + extracted text)
 *   POST   /api/lobby/:code/files/presign  → presigned PUT for the raw bytes (R2)
 *   DELETE /api/lobby/:code/files/:fileId  → remove a file
 *
 * The lobby code is the invitation: whoever holds it is in the group, and
 * that is the same trust level the lobby itself runs on (see routes/lobby.ts).
 * So reading and writing a shared file needs a signed-in user and the code —
 * nothing more. Deletion is tighter: only the person who added the file or
 * the lobby host can take it back down.
 *
 * The extracted text is stored alongside the metadata because it is the
 * material the AI actually reads: the tutor grounds a lesson on it, and the
 * quiz-battle and duel generators build their questions from it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import { rateLimit } from '../lib/rateLimit.js';
import { isLobbyExpired, normalizeLobbyCode } from '../lib/lobby.js';
import { isEnabled, presignPut } from '../lib/storage.js';

export const roomFilesRouter = new Hono();
roomFilesRouter.use('/*', requireAuth);

// Cap on the text we keep per file. Enough for a chapter of extracted text,
// small enough that the AI prompt stays sane.
const MAX_TEXT_CHARS = 200_000;
// How many files one lobby may hold.
const MAX_FILES_PER_LOBBY = 40;

const ADD_LIMIT = 30;
const ADD_WINDOW_MS = 10 * 60_000;

interface LobbyRow {
  id: string;
  code: string;
  hostId: string;
  kind: string;
  status: string;
  expiresAt: Date | null;
}

/** Resolve the lobby behind a code, or explain why it cannot be used. */
async function findLobby(rawCode: string): Promise<{ lobby: LobbyRow } | { error: string; status: 400 | 404 | 410 }> {
  const code = normalizeLobbyCode(rawCode);
  if (!code) return { error: 'Lobby codes are six digits.', status: 400 };
  const lobby = await prisma.lobby.findUnique({ where: { code } });
  if (!lobby) return { error: 'No lobby found with that code.', status: 404 };
  if (isLobbyExpired(lobby)) return { error: 'This lobby has expired.', status: 410 };
  return { lobby };
}

/** The public shape of a shared file. */
function toFileInfo(f: {
  id: string;
  name: string;
  type: string;
  size: number;
  storageKey: string | null;
  url: string | null;
  text: string | null;
  createdAt: Date;
  uploaderId: string;
  uploader?: { name: string | null } | null;
}) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    size: f.size,
    url: f.url,
    storageKey: f.storageKey,
    // The text itself is not sent back — only whether it is there. The AI
    // reads it server-side when it grounds a lesson or builds a quiz.
    hasText: Boolean(f.text && f.text.trim().length > 0),
    textLength: f.text?.length ?? 0,
    uploadedBy: { id: f.uploaderId, name: f.uploader?.name ?? null },
    createdAt: f.createdAt.toISOString(),
  };
}

// ── List the shared files ─────────────────────────────────────────────────────
roomFilesRouter.get('/:code/files', async c => {
  const found = await findLobby(c.req.param('code') ?? '');
  if ('error' in found) return c.json({ error: found.error }, found.status);

  const files = await prisma.roomFile.findMany({
    where: { lobbyId: found.lobby.id },
    orderBy: { createdAt: 'asc' },
    include: { uploader: { select: { name: true } } },
  });

  return c.json({ files: files.map(toFileInfo) });
});

// ── One file, with its text ──────────────────────────────────────────────────
// The list endpoint deliberately leaves the text out — it is long, and the
// client does not need it to draw a row. This one is for the moments that do
// need it: opening the file in the AI tutor, or previewing what was shared.
roomFilesRouter.get('/:code/files/:fileId', async c => {
  const found = await findLobby(c.req.param('code') ?? '');
  if ('error' in found) return c.json({ error: found.error }, found.status);

  const file = await prisma.roomFile.findFirst({
    where: { id: c.req.param('fileId') ?? '', lobbyId: found.lobby.id },
    include: { uploader: { select: { name: true } } },
  });
  if (!file) return c.json({ error: 'That file is no longer in this lobby.' }, 404);

  return c.json({
    ...toFileInfo(file),
    text: file.text ?? '',
  });
});

// ── Presign the raw bytes (object storage) ───────────────────────────────────
// The browser uploads straight to R2 so the server never proxies the file.
// When R2 is not configured the client simply skips this and posts the
// metadata alone — the file still works, it just is not stored.
roomFilesRouter.post('/:code/files/presign', zValidator('json', z.object({
  name: z.string().min(1).max(160),
  size: z.number().int().min(0).max(50 * 1024 * 1024),
  contentType: z.string().max(120).optional(),
})), async c => {
  const user = c.get('user');
  const found = await findLobby(c.req.param('code') ?? '');
  if ('error' in found) return c.json({ error: found.error }, found.status);
  if (found.lobby.status === 'closed') {
    return c.json({ error: 'This lobby has been closed by the host.' }, 410);
  }

  const body = await c.req.valid('json');
  if (!isEnabled()) {
    return c.json({ storageEnabled: false, uploadUrl: null, storageKey: null, publicUrl: null });
  }

  try {
    const presigned = await presignPut({
      userId: user.id,
      filename: body.name,
      contentType: body.contentType ?? 'application/octet-stream',
      size: body.size,
      prefix: `room-files/${found.lobby.id}`,
    });
    return c.json({ storageEnabled: true, ...presigned });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not prepare the upload.' }, err?.statusCode ?? 500);
  }
});

// ── Add a file to the lobby ──────────────────────────────────────────────────
roomFilesRouter.post('/:code/files', zValidator('json', z.object({
  name: z.string().min(1).max(160),
  type: z.enum(['pdf', 'docx', 'pptx', 'image', 'html', 'text', 'other']).default('other'),
  size: z.number().int().min(0).max(50 * 1024 * 1024).default(0),
  // The text the client extracted from the file — the AI grounding material.
  text: z.string().max(MAX_TEXT_CHARS).optional(),
  storageKey: z.string().max(300).optional(),
  url: z.string().max(1000).optional(),
})), async c => {
  const user = c.get('user');
  const found = await findLobby(c.req.param('code') ?? '');
  if ('error' in found) return c.json({ error: found.error }, found.status);
  if (found.lobby.status === 'closed') {
    return c.json({ error: 'This lobby has been closed by the host.' }, 410);
  }

  const limit = rateLimit(`room-file-add:${user.id}`, ADD_LIMIT, ADD_WINDOW_MS);
  if (!limit.allowed) {
    return c.json({ error: 'Too many files added in a row. Wait a few minutes.', retryAfter: limit.resetAtMs }, 429);
  }

  const body = await c.req.valid('json');

  const count = await prisma.roomFile.count({ where: { lobbyId: found.lobby.id } });
  if (count >= MAX_FILES_PER_LOBBY) {
    return c.json({ error: `This lobby already holds ${MAX_FILES_PER_LOBBY} files — remove one first.` }, 409);
  }

  const file = await prisma.roomFile.create({
    data: {
      lobbyId: found.lobby.id,
      uploaderId: user.id,
      name: body.name,
      type: body.type,
      size: body.size,
      text: body.text?.trim() ? body.text : null,
      storageKey: body.storageKey ?? null,
      url: body.url ?? null,
    },
    include: { uploader: { select: { name: true } } },
  });

  return c.json(toFileInfo(file), 201);
});

// ── Remove a file ────────────────────────────────────────────────────────────
// The person who added it, or the host of the lobby, may take it back down.
roomFilesRouter.delete('/:code/files/:fileId', async c => {
  const user = c.get('user');
  const found = await findLobby(c.req.param('code') ?? '');
  if ('error' in found) return c.json({ error: found.error }, found.status);

  const file = await prisma.roomFile.findFirst({
    where: { id: c.req.param('fileId') ?? '', lobbyId: found.lobby.id },
  });
  if (!file) return c.json({ error: 'That file is no longer in this lobby.' }, 404);

  const isHost = found.lobby.hostId === user.id;
  if (file.uploaderId !== user.id && !isHost) {
    return c.json({ error: 'Only the person who added this file (or the host) can remove it.' }, 403);
  }

  await prisma.roomFile.delete({ where: { id: file.id } });
  return c.json({ ok: true });
});
