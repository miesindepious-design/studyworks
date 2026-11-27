/**
 * Tests for the role a share link carries.
 *
 * A link is "viewer" unless the owner says otherwise, so every link made
 * before study groups existed keeps behaving exactly as it did. An "editor"
 * link is the only new thing, and revoking one has to take back what it
 * granted — including the live socket.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { collabManager } from '../lib/collabManager.js';

const owner = { id: 'owner', email: 'o@b.com', name: 'Owen', tier: 'PRO' as const };

const json = (body: unknown, method: string) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('/api/shares — link roles', () => {
  beforeEach(() => { vi.clearAllMocks(); collabManager.reset(); });

  it('makes a viewer link unless asked for an editor one', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folder.findFirst.mockResolvedValue({ id: 'f1', userId: 'owner' } as any);
    prismaMock.folderShare.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));

    const res = await request('/api/shares', json({ folderId: 'f1' }, 'POST'));
    expect(res.status).toBe(201);
    expect(prismaMock.folderShare.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'viewer' }) }),
    );
  });

  it('makes an editor link when asked', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folder.findFirst.mockResolvedValue({ id: 'f1', userId: 'owner' } as any);
    prismaMock.folderShare.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));

    const res = await request('/api/shares', json({ folderId: 'f1', role: 'editor' }, 'POST'));
    expect(res.status).toBe(201);
    expect((await res.json()).role).toBe('editor');
  });

  it('refuses a role that does not exist', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folder.findFirst.mockResolvedValue({ id: 'f1', userId: 'owner' } as any);

    const res = await request('/api/shares', json({ folderId: 'f1', role: 'admin' }, 'POST'));
    expect(res.status).toBe(400);
    expect(prismaMock.folderShare.create).not.toHaveBeenCalled();
  });

  it('tells the public page what the link would let a signed-in person do', async () => {
    const { request } = await buildTestApp();
    prismaMock.folderShare.findUnique.mockResolvedValue({
      id: 's1', folderId: 'f1', userId: 'owner', role: 'editor', revoked: false, expiresAt: null,
    } as any);
    prismaMock.folder.findUnique.mockResolvedValue({ id: 'f1', name: 'Biology' } as any);
    prismaMock.note.findMany.mockResolvedValue([] as any);

    const res = await request('/api/shares/public/tok');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('editor');
    expect(body.folderName).toBe('Biology');
  });
});

describe('/api/shares — revoking a link', () => {
  beforeEach(() => { vi.clearAllMocks(); collabManager.reset(); });

  it('shuts out everybody whose only way in was that link', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folderShare.findFirst.mockResolvedValue({
      id: 's1', folderId: 'f1', members: [{ userId: 'u1' }, { userId: 'u2' }],
    } as any);
    prismaMock.folderShare.update.mockResolvedValue({} as any);
    prismaMock.folder.findUnique.mockResolvedValue({ id: 'f1', userId: 'owner', name: 'Biology' } as any);
    prismaMock.shareMember.findMany.mockResolvedValue([] as any);
    const closeUser = vi.spyOn(collabManager, 'closeUser').mockImplementation(() => {});

    const res = await request('/api/shares/s1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    expect(prismaMock.folderShare.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: { revoked: true } }),
    );
    expect(closeUser).toHaveBeenCalledTimes(2);
    expect(closeUser).toHaveBeenCalledWith('f1', 'u1', expect.any(String));
    expect(closeUser).toHaveBeenCalledWith('f1', 'u2', expect.any(String));
  });

  it('still reports the revoke as done when the socket cleanup fails', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folderShare.findFirst.mockResolvedValue({
      id: 's1', folderId: 'f1', members: [{ userId: 'u1' }],
    } as any);
    prismaMock.folderShare.update.mockResolvedValue({} as any);
    // The lookup that decides whose socket to close blows up.
    prismaMock.folder.findUnique.mockRejectedValue(new Error('db gone'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request('/api/shares/s1', { method: 'DELETE' });
    // The link is revoked whatever happened afterwards, and saying otherwise
    // would send the owner back to redo a change that already took.
    expect(res.status).toBe(200);
    expect(prismaMock.folderShare.update).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves alone somebody who still has another link', async () => {
    const { request, login } = await buildTestApp();
    login(owner);
    prismaMock.folderShare.findFirst.mockResolvedValue({
      id: 's1', folderId: 'f1', members: [{ userId: 'u1' }],
    } as any);
    prismaMock.folderShare.update.mockResolvedValue({} as any);
    prismaMock.folder.findUnique.mockResolvedValue({ id: 'f1', userId: 'owner', name: 'Biology' } as any);
    prismaMock.shareMember.findMany.mockResolvedValue([{ role: 'editor' }] as any);
    const closeUser = vi.spyOn(collabManager, 'closeUser').mockImplementation(() => {});

    const res = await request('/api/shares/s1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(closeUser).not.toHaveBeenCalled();
  });

  it('cannot revoke somebody else\u2019s link', async () => {
    const { request, login } = await buildTestApp();
    login({ ...owner, id: 'stranger' });
    prismaMock.folderShare.findFirst.mockResolvedValue(null as any);

    const res = await request('/api/shares/s1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(prismaMock.folderShare.update).not.toHaveBeenCalled();
  });
});
