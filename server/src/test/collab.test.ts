/**
 * Tests for /api/collab — a shared folder a study group edits together.
 *
 * What is proven here:
 *
 *   1. joining: an editor link makes you an editor, a viewer link never
 *      demotes an editor, the owner is never a "member", and a link that has
 *      expired or been revoked lets nobody in;
 *   2. a save only lands if the note is still as the editor loaded it — and
 *      that the check is part of the write, not a read that happens first;
 *   3. who may write: owner and editor yes, viewer no; only the owner may
 *      delete;
 *   4. removing someone closes their live connection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { collabManager } from '../lib/collabManager.js';

const FOLDER = { id: 'f1', userId: 'owner', name: 'Biology' };
const T0 = new Date('2026-11-20T10:00:00.000Z');

const NOTE = {
  id: 'n1', userId: 'owner', folderId: 'f1',
  title: 'Photosynthesis', content: '<p>Light in, sugar out.</p>', tags: ['plants'],
  type: 'note', createdAt: T0, updatedAt: T0, collabRevision: 3, lastEditedBy: 'owner',
};

function asUser(id: string) {
  return { id, email: `${id}@b.com`, name: id === 'owner' ? 'Owen' : 'Ada', tier: 'FREE' as const };
}

/**
 * Answer the access question.
 *
 * `shareMember.findMany` is called twice per request — once to decide
 * access, once to list the group — so the mock tells them apart: the access
 * call asks for `select`, the listing call does not.
 *
 * `callerRole` is what the signed-in user resolves to when the folder owner
 * check does not already settle it (the owner never reaches the membership
 * query). `memberRole` is what any *other* user with a membership row
 * resolves to — the person being removed, for instance.
 */
function accessFor(
  caller: { role: 'owner' | 'editor' | 'viewer' | 'none' },
  members: any[] = [],
  memberRole: 'editor' | 'viewer' | 'none' = 'none',
) {
  prismaMock.folder.findUnique.mockResolvedValue(FOLDER as any);
  prismaMock.shareMember.findMany.mockImplementation(async (args: any) => {
    if (!args?.select) return members as any;
    const role = caller.role === 'owner' ? memberRole : caller.role;
    return (role === 'none' ? [] : [{ role }]) as any;
  });
  prismaMock.note.findMany.mockResolvedValue([NOTE] as any);
  prismaMock.user.findMany.mockResolvedValue([
    { id: 'owner', name: 'Owen' }, { id: 'u1', name: 'Ada' },
  ] as any);
  prismaMock.shareMember.updateMany.mockResolvedValue({ count: 1 } as any);
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/collab — joining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabManager.reset();
  });

  it('makes somebody who joins through an editor link an editor', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));

    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's1', folderId: 'f1', userId: 'owner', role: 'editor', revoked: false, expiresAt: null,
    } as any);
    prismaMock.shareMember.upsert.mockResolvedValue({} as any);
    accessFor({ role: 'editor' });

    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(200);

    expect(prismaMock.shareMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { shareId_userId: { shareId: 's1', userId: 'u1' } },
      create: expect.objectContaining({ role: 'editor' }),
    }));
    const body = await res.json();
    expect(body.myRole).toBe('editor');
    expect(body.folderName).toBe('Biology');
    expect(body.userId).toBe('u1');
  });

  it('never demotes an editor who joins again through a viewer link', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));

    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's2', folderId: 'f1', userId: 'owner', role: 'viewer', revoked: false, expiresAt: null,
    } as any);
    prismaMock.shareMember.upsert.mockResolvedValue({} as any);
    accessFor({ role: 'editor' });

    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(200);

    const update = (prismaMock.shareMember.upsert.mock.calls[0] as any)[0].update;
    expect(update.role).toBeUndefined();
    expect(update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('does not make the owner a member of their own folder', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('owner'));

    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's1', folderId: 'f1', userId: 'owner', role: 'editor', revoked: false, expiresAt: null,
    } as any);
    accessFor({ role: 'owner' });

    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(200);
    expect((await res.json()).myRole).toBe('owner');
    expect(prismaMock.shareMember.upsert).not.toHaveBeenCalled();
  });

  it('refuses an expired link', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's1', folderId: 'f1', userId: 'owner', role: 'editor', revoked: false,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    } as any);

    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(410);
    expect(prismaMock.shareMember.upsert).not.toHaveBeenCalled();
  });

  it('refuses a revoked link as if it did not exist', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's1', folderId: 'f1', userId: 'owner', role: 'editor', revoked: true, expiresAt: null,
    } as any);

    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(404);
  });

  it('refuses everything without a session', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/collab/join', json({ token: 'tok' }));
    expect(res.status).toBe(401);
  });
});

describe('/api/collab — reading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabManager.reset();
  });

  it('gives a member the folder, its notes and the group', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' }, [
      { id: 'm1', userId: 'u1', role: 'editor', lastSeenAt: T0 },
    ]);

    const res = await request('/api/collab/f1');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.notes[0]).toMatchObject({
      id: 'n1', title: 'Photosynthesis', revision: 3, lastEditedBy: 'owner',
      updatedAt: T0.toISOString(),
    });
    expect(body.members).toEqual([
      { memberId: null, userId: 'owner', name: 'Owen', role: 'owner', lastSeenAt: null },
      { memberId: 'm1', userId: 'u1', name: 'Ada', role: 'editor', lastSeenAt: T0.toISOString() },
    ]);
    // Only the owner's notes, so nothing of anybody else's leaks in.
    expect(prismaMock.note.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { folderId: 'f1', userId: 'owner' } }),
    );
  });

  it('looks only for notes that are still live', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'viewer' });

    // Access is only granted through a link that is neither revoked nor
    // expired — the query itself has to say so.
    await request('/api/collab/f1');
    const args = (prismaMock.shareMember.findMany.mock.calls[0] as any)[0];
    expect(args.where.share).toMatchObject({
      folderId: 'f1',
      revoked: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    });
  });

  it('will not open the folder for a stranger', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('stranger'));
    accessFor({ role: 'none' });

    const res = await request('/api/collab/f1');
    expect(res.status).toBe(404);
    expect(prismaMock.note.findMany).not.toHaveBeenCalled();
  });

  it('hands a member a ticket for the socket, and a stranger nothing', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'viewer' });

    const ok = await request('/api/collab/f1/ticket', { method: 'POST' });
    expect(ok.status).toBe(200);
    const { ticket } = await ok.json();
    expect(typeof ticket).toBe('string');
    expect(collabManager.redeemTicket('f1', ticket)).toEqual({ userId: 'u1', name: 'Ada' });

    accessFor({ role: 'none' });
    const no = await request('/api/collab/f1/ticket', { method: 'POST' });
    expect(no.status).toBe(404);
  });
});

describe('/api/collab — saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabManager.reset();
  });

  /** PATCH the note, starting from the version `NOTE` shows. */
  const save = (request: any, over: Record<string, unknown> = {}) => request('/api/collab/f1/notes/n1', {
    ...json({
      content: '<p>Changed</p>',
      baseUpdatedAt: T0.toISOString(),
      baseRevision: 3,
      ...over,
    }),
    method: 'PATCH',
  });

  it('lets an editor save, and stamps the note with who did it', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });
    prismaMock.note.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.note.findFirstOrThrow.mockResolvedValue({ ...NOTE, collabRevision: 4, lastEditedBy: 'u1' } as any);

    const res = await save(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revision: 4, lastEditedBy: 'u1' });

    const args = (prismaMock.note.updateMany.mock.calls[0] as any)[0];
    expect(args.data).toMatchObject({
      content: '<p>Changed</p>',
      collabRevision: { increment: 1 },
      lastEditedBy: 'u1',
    });
  });

  it('makes the check part of the write, so two saves cannot both land', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });
    prismaMock.note.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.note.findFirstOrThrow.mockResolvedValue(NOTE as any);

    await save(request);

    // The write is conditional on the note still being as it was loaded:
    // same `updatedAt` AND same revision. If this were a read-then-write,
    // two people saving in the same instant would both pass.
    const args = (prismaMock.note.updateMany.mock.calls[0] as any)[0];
    expect(args.where).toMatchObject({
      id: 'n1',
      folderId: 'f1',
      userId: 'owner',
      updatedAt: T0,
      collabRevision: 3,
    });
    // And no separate read decided it.
    expect(prismaMock.note.update).not.toHaveBeenCalled();
    expect(prismaMock.note.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a save from a stale copy and returns the note as it is now', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });

    const theirs = { ...NOTE, content: '<p>Theirs</p>', collabRevision: 4, updatedAt: new Date('2026-11-20T10:05:00.000Z') };
    prismaMock.note.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.note.findFirst.mockResolvedValue(theirs as any);

    const res = await save(request);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Someone else saved this note first.');
    expect(body.current.content).toBe('<p>Theirs</p>');
    expect(body.current.revision).toBe(4);
  });

  it('says "not found", not "conflict", when the note is gone', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });
    prismaMock.note.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.note.findFirst.mockResolvedValue(null as any);

    const res = await save(request);
    expect(res.status).toBe(404);
  });

  it('refuses a viewer, and tells them what to ask for', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'viewer' });

    const res = await save(request);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/read-only/);
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a stranger without revealing that the note exists', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('stranger'));
    accessFor({ role: 'none' });

    const res = await save(request);
    expect(res.status).toBe(404);
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a save that does not say which version it started from', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });

    const res = await save(request, { baseRevision: undefined, baseUpdatedAt: undefined });
    expect(res.status).toBe(400);
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
  });
});

describe('/api/collab — creating and deleting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabManager.reset();
  });

  it('lets an editor add a note, owned by the folder owner', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });
    prismaMock.note.create.mockImplementation(async ({ data }: any) => ({
      ...NOTE, ...data, collabRevision: 0,
    }));

    const res = await request('/api/collab/f1/notes', json({ title: 'New', content: '<p>x</p>' }));
    expect(res.status).toBe(201);

    expect(prismaMock.note.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'owner', folderId: 'f1', lastEditedBy: 'u1' }),
    }));
  });

  it('refuses a viewer who tries to add a note', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'viewer' });

    const res = await request('/api/collab/f1/notes', json({ title: 'New' }));
    expect(res.status).toBe(403);
    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it('does not let an editor delete — that is the owner\u2019s alone', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });

    const res = await request('/api/collab/f1/notes/n1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(prismaMock.note.delete).not.toHaveBeenCalled();
  });

  it('lets the owner delete a note', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('owner'));
    accessFor({ role: 'owner' });
    prismaMock.note.findFirst.mockResolvedValue(NOTE as any);
    prismaMock.note.delete.mockResolvedValue(NOTE as any);

    const res = await request('/api/collab/f1/notes/n1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.note.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
  });
});

describe('/api/collab — the group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabManager.reset();
  });

  it('lets the owner promote someone', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('owner'));
    accessFor({ role: 'owner' });
    prismaMock.shareMember.updateMany.mockResolvedValue({ count: 1 } as any);

    const res = await request('/api/collab/f1/members/m1', { ...json({ role: 'editor' }), method: 'PATCH' });
    expect(res.status).toBe(200);
    expect(prismaMock.shareMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1', share: { folderId: 'f1' } },
      data: { role: 'editor' },
    }));
  });

  it('does not let an editor change the group', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('u1'));
    accessFor({ role: 'editor' });

    const res = await request('/api/collab/f1/members/m2', { ...json({ role: 'editor' }), method: 'PATCH' });
    expect(res.status).toBe(403);
    expect(prismaMock.shareMember.updateMany).not.toHaveBeenCalled();
  });

  it('closes the socket of somebody the owner removes', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('owner'));
    accessFor({ role: 'owner' });
    prismaMock.shareMember.findFirst.mockResolvedValue({ userId: 'u1' } as any);
    prismaMock.shareMember.deleteMany.mockResolvedValue({ count: 1 } as any);
    const closeUser = vi.spyOn(collabManager, 'closeUser').mockImplementation(() => {});

    const res = await request('/api/collab/f1/members/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    // Removed, and — because they have no other way in — shut out of the room.
    expect(prismaMock.shareMember.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(closeUser).toHaveBeenCalledWith('f1', 'u1', expect.stringMatching(/no longer have access/));
  });

  it('leaves the socket of somebody who still has another way in', async () => {
    const { request, login } = await buildTestApp();
    login(asUser('owner'));
    accessFor({ role: 'owner' });
    prismaMock.shareMember.findFirst.mockResolvedValue({ userId: 'u1' } as any);
    prismaMock.shareMember.deleteMany.mockResolvedValue({ count: 1 } as any);
    const closeUser = vi.spyOn(collabManager, 'closeUser').mockImplementation(() => {});

    // After the removal they are still an editor through a second link.
    accessFor({ role: 'owner' }, [], 'editor');

    const res = await request('/api/collab/f1/members/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(closeUser).not.toHaveBeenCalled();
  });
});
