/**
 * /api/collab — a shared folder that a study group edits together.
 *
 * A share link used to be the end of the story: the owner published, and
 * everybody else got a read-only page. That is fine for handing out revision
 * notes and useless for a group writing them together.
 *
 * So a link now carries a role. Joined through a "viewer" link it behaves
 * exactly as before. Joined through an "editor" link it is a study group:
 * everyone can write into the folder, and everyone can see who else is in it.
 *
 * The rules, in one place:
 *
 *   - The folder's owner can do anything, including deleting notes and
 *     managing the group. The owner is never a "member" — that would be a
 *     row saying somebody shares a folder with themselves.
 *   - An editor can create notes and change any note in the folder. An
 *     editor cannot delete: removing somebody else's work is the owner's
 *     call alone.
 *   - A viewer can read. Joining through a viewer link never demotes an
 *     editor, and an expired or revoked link ends the access it granted.
 *   - Notes in the folder belong to the owner. A note an editor adds appears
 *     in the owner's notes on their next sync, because it is in their folder.
 *
 * The notes are the same rows the owner's own editor and sync write to, which
 * is why a stale write is checked against `updatedAt` as well as a counter —
 * see the note on `Note.collabRevision` in the schema.
 *
 * Who may do what is decided in `lib/collabAccess.ts`, shared with the
 * socket so the two can never disagree.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import { collabManager } from '../lib/collabManager.js';
import { canEdit, closeLostAccess, resolveAccess, type CollabRole, type ResolvedAccess } from '../lib/collabAccess.js';

export const collabRouter = new Hono();
collabRouter.use('*', requireAuth);

const JoinBody = z.object({ token: z.string().min(1).max(200) });

const SaveBody = z.object({
  title:   z.string().max(400).optional(),
  content: z.string().max(400_000).optional(),
  tags:    z.array(z.string().max(80)).max(40).optional(),
  // The `updatedAt` the editor loaded the note with. If the note has moved
  // on since — by anyone, through any path — the save is refused.
  baseUpdatedAt: z.string().datetime(),
  // ...and the revision it loaded. `updatedAt` has millisecond resolution, so
  // two saves in the same millisecond could both match it; the revision
  // cannot repeat, because every save increments it.
  baseRevision: z.number().int().min(0),
  // The editor's own socket, so they are not told about their own save.
  connId: z.string().max(80).optional(),
});

const CreateBody = z.object({
  title:   z.string().max(400).default('Untitled'),
  content: z.string().max(400_000).default(''),
  tags:    z.array(z.string().max(80)).max(40).default([]),
  connId:  z.string().max(80).optional(),
});

const MemberRoleBody = z.object({ role: z.enum(['viewer', 'editor']) });

function noteShape(n: {
  id: string; title: string; content: string; tags: string[]; type: string;
  createdAt: Date; updatedAt: Date; collabRevision: number; lastEditedBy: string | null;
}) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    tags: n.tags,
    type: n.type,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    revision: n.collabRevision,
    lastEditedBy: n.lastEditedBy,
  };
}

/** The whole folder as the group sees it. */
async function folderPayload(access: ResolvedAccess, userId: string) {
  const notes = await prisma.note.findMany({
    where: { folderId: access.folderId, userId: access.ownerId },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  const memberships = await prisma.shareMember.findMany({
    where: { share: { folderId: access.folderId } },
    orderBy: { joinedAt: 'asc' },
  });

  const editorIds = new Set<string>();
  for (const n of notes) if (n.lastEditedBy) editorIds.add(n.lastEditedBy);
  editorIds.add(access.ownerId);
  for (const m of memberships) editorIds.add(m.userId);
  const people = await prisma.user.findMany({
    where: { id: { in: Array.from(editorIds) } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map(p => [p.id, p.name ?? 'Somebody']));

  return {
    folderId: access.folderId,
    folderName: access.folderName,
    ownerId: access.ownerId,
    myRole: access.role,
    userId,
    notes: notes.map(noteShape),
    members: [
      { memberId: null, userId: access.ownerId, name: names.get(access.ownerId) ?? 'The owner', role: 'owner' as CollabRole, lastSeenAt: null },
      ...memberships.map(m => ({
        memberId: m.id,
        userId: m.userId,
        name: names.get(m.userId) ?? 'Somebody',
        role: m.role as CollabRole,
        lastSeenAt: m.lastSeenAt,
      })),
    ],
  };
}

function byLine(user: { id: string; name: string | null }) {
  return { userId: user.id, name: user.name ?? 'Somebody' };
}

/** Tell the folder a note changed — everyone except the writer's own socket. */
function announce(folderId: string, frame: Record<string, unknown>, exceptConnId?: string) {
  collabManager.broadcast(folderId, frame, exceptConnId);
}

// ── Joining ───────────────────────────────────────────────────────────────────

collabRouter.post('/join', zValidator('json', JoinBody), async c => {
  const user = c.get('user');
  const { token } = c.req.valid('json');

  const share = await prisma.folderShare.findUnique({ where: { token } });
  if (!share || share.revoked) return c.json({ error: 'This share link is no longer valid.' }, 404);
  if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'This share link has expired.' }, 410);

  // The owner opening their own link is not a join; just open the folder.
  if (share.userId === user.id) {
    const access = await resolveAccess(share.folderId, user.id);
    if (!access) return c.json({ error: 'Folder not found' }, 404);
    return c.json(await folderPayload(access, user.id));
  }

  // Upsert rather than create: joining twice must not fail, and a re-join
  // through an editor link promotes a viewer. It never demotes.
  await prisma.shareMember.upsert({
    where: { shareId_userId: { shareId: share.id, userId: user.id } },
    create: { shareId: share.id, userId: user.id, role: share.role, lastSeenAt: new Date() },
    update: {
      lastSeenAt: new Date(),
      ...(share.role === 'editor' ? { role: 'editor' } : {}),
    },
  });

  const access = await resolveAccess(share.folderId, user.id);
  if (!access) return c.json({ error: 'Folder not found' }, 404);
  return c.json(await folderPayload(access, user.id));
});

// ── Reading ───────────────────────────────────────────────────────────────────

collabRouter.get('/:folderId', async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);

  if (access.role !== 'owner') {
    await prisma.shareMember.updateMany({
      where: { userId: user.id, share: { folderId: access.folderId } },
      data: { lastSeenAt: new Date() },
    });
  }
  return c.json(await folderPayload(access, user.id));
});

/** One note, for when the socket says it changed. */
collabRouter.get('/:folderId/notes/:noteId', async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);

  const note = await prisma.note.findFirst({
    where: { id: c.req.param('noteId'), folderId: access.folderId, userId: access.ownerId },
  });
  if (!note) return c.json({ error: 'Note not found' }, 404);
  return c.json(noteShape(note));
});

/** A one-time ticket for the collaboration socket. */
collabRouter.post('/:folderId/ticket', async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  return c.json({ ticket: collabManager.issueTicket(access.folderId, user.id, user.name ?? 'Somebody') });
});

// ── Writing ───────────────────────────────────────────────────────────────────

/**
 * Save a note.
 *
 * Returns 409 with the note as it is now when it changed under the editor.
 * The client then shows both and lets the person decide — it never merges
 * rich text on its own, because a merge that guesses wrong is worse than a
 * question.
 */
collabRouter.patch('/:folderId/notes/:noteId', zValidator('json', SaveBody), async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  if (!canEdit(access.role)) return c.json({ error: 'This link is read-only. Ask the owner for an editor link.' }, 403);

  const body = c.req.valid('json');
  const base = new Date(body.baseUpdatedAt);
  if (Number.isNaN(base.getTime())) return c.json({ error: 'baseUpdatedAt is not a date' }, 400);

  // The comparison and the write are ONE statement, on purpose. Reading the
  // note and then updating it leaves a window where two people both pass the
  // check and the second silently overwrites the first. `updateMany` only
  // touches a row that is still exactly as the editor loaded it, so exactly
  // one of two simultaneous saves can succeed.
  const result = await prisma.note.updateMany({
    where: {
      id: c.req.param('noteId'),
      folderId: access.folderId,
      userId: access.ownerId,
      updatedAt: base,
      collabRevision: body.baseRevision,
    },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      collabRevision: { increment: 1 },
      lastEditedBy: user.id,
    },
  });

  if (result.count === 0) {
    // Either the note is gone, or it changed first. Say which.
    const current = await prisma.note.findFirst({
      where: { id: c.req.param('noteId'), folderId: access.folderId, userId: access.ownerId },
    });
    if (!current) return c.json({ error: 'Note not found' }, 404);
    return c.json({ error: 'Someone else saved this note first.', current: noteShape(current) }, 409);
  }

  const updated = await prisma.note.findFirstOrThrow({
    where: { id: c.req.param('noteId'), folderId: access.folderId, userId: access.ownerId },
  });

  announce(access.folderId, {
    type: 'note-updated',
    noteId: updated.id,
    by: byLine(user),
  }, body.connId);

  return c.json(noteShape(updated));
});

collabRouter.post('/:folderId/notes', zValidator('json', CreateBody), async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  if (!canEdit(access.role)) return c.json({ error: 'This link is read-only. Ask the owner for an editor link.' }, 403);

  const body = c.req.valid('json');
  const created = await prisma.note.create({
    data: {
      userId: access.ownerId,
      folderId: access.folderId,
      title: body.title,
      content: body.content,
      tags: body.tags,
      lastEditedBy: user.id,
    },
  });

  announce(access.folderId, { type: 'note-created', noteId: created.id, by: byLine(user) }, body.connId);
  return c.json(noteShape(created), 201);
});

/** Deleting is the owner's alone — it is the only change nobody can undo. */
collabRouter.delete('/:folderId/notes/:noteId', async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  if (access.role !== 'owner') return c.json({ error: 'Only the owner can delete notes in this folder.' }, 403);

  const note = await prisma.note.findFirst({
    where: { id: c.req.param('noteId'), folderId: access.folderId, userId: access.ownerId },
  });
  if (!note) return c.json({ error: 'Note not found' }, 404);

  await prisma.note.delete({ where: { id: note.id } });
  announce(access.folderId, { type: 'note-deleted', noteId: note.id, by: byLine(user) });
  return c.json({ ok: true });
});

// ── The group ─────────────────────────────────────────────────────────────────

collabRouter.patch('/:folderId/members/:memberId', zValidator('json', MemberRoleBody), async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  if (access.role !== 'owner') return c.json({ error: 'Only the owner can change the group.' }, 403);

  const memberId = c.req.param('memberId');
  // The owner has no membership row, so the only way to land here is a
  // hand-typed id that happens to be the owner's.
  if (memberId === access.ownerId) return c.json({ error: 'The owner is always an editor.' }, 400);

  const result = await prisma.shareMember.updateMany({
    where: { id: memberId, share: { folderId: access.folderId } },
    data: { role: c.req.valid('json').role },
  });
  if (result.count === 0) return c.json({ error: 'Member not found' }, 404);
  announce(access.folderId, { type: 'group-changed', by: byLine(user) });
  return c.json({ ok: true });
});

collabRouter.delete('/:folderId/members/:memberId', async c => {
  const user = c.get('user');
  const access = await resolveAccess(c.req.param('folderId'), user.id);
  if (!access) return c.json({ error: 'You do not have access to this folder.' }, 404);
  if (access.role !== 'owner') return c.json({ error: 'Only the owner can change the group.' }, 403);

  const memberId = c.req.param('memberId');
  if (memberId === access.ownerId) return c.json({ error: 'The owner cannot be removed.' }, 400);

  const target = await prisma.shareMember.findFirst({
    where: { id: memberId, share: { folderId: access.folderId } },
    select: { userId: true },
  });
  if (!target) return c.json({ error: 'Member not found' }, 404);

  await prisma.shareMember.deleteMany({ where: { id: memberId } });

  // Out of the group means out of the room. They may still have access
  // through another link, in which case `closeLostAccess` leaves them be.
  await closeLostAccess(access.folderId, [target.userId], (f, u, reason) => collabManager.closeUser(f, u, reason));

  announce(access.folderId, { type: 'group-changed', by: byLine(user) });
  return c.json({ ok: true });
});
