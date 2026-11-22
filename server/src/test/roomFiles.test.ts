/**
 * Tests for the shared study files in a lobby.
 *
 *   GET    /api/lobby/:code/files          → the material the group shared
 *   POST   /api/lobby/:code/files          → add a file (metadata + text)
 *   GET    /api/lobby/:code/files/:fileId  → one file, with its text
 *   DELETE /api/lobby/:code/files/:fileId  → take a file back down
 *
 * The file is the group's material: the tutor reads it, a quiz battle is
 * built from it, a duel is set from it. So what matters here is that the
 * group sees the same files, that a file carries its text (the AI's
 * grounding material), and that only the person who added a file — or the
 * lobby host — can remove it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

const NOW = new Date();
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function lobby(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lobby-1',
    code: '482913',
    kind: 'study',
    title: 'Chemistry group',
    hostId: 'u1',
    targetCode: null,
    targetUrl: null,
    maxParticipants: 6,
    status: 'open',
    createdAt: NOW,
    expiresAt: FUTURE,
    ...overrides,
  };
}

function roomFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    lobbyId: 'lobby-1',
    uploaderId: 'u1',
    name: 'chapter-3.pdf',
    type: 'pdf',
    size: 2048,
    storageKey: null,
    url: null,
    text: 'Photosynthesis happens in the chloroplast.',
    createdAt: NOW,
    uploader: { name: 'Ada' },
    ...overrides,
  };
}

async function login(userId = 'u1', name = 'Ada') {
  const { request, login: doLogin } = await buildTestApp();
  doLogin({ id: userId, email: `${userId}@b.com`, name, tier: 'PRO' });
  prismaMock.lobby.findUnique.mockReset();
  prismaMock.roomFile.findMany.mockReset();
  prismaMock.roomFile.findFirst.mockReset();
  prismaMock.roomFile.create.mockReset();
  prismaMock.roomFile.delete.mockReset();
  prismaMock.roomFile.count.mockReset();
  return { request };
}

describe('Room files — listing', () => {
  beforeEach(() => {
    prismaMock.lobby.findUnique.mockReset();
    prismaMock.roomFile.findMany.mockReset();
  });

  it('rejects an unauthenticated request', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/lobby/482913/files');
    expect(res.status).toBe(401);
  });

  it('lists what the group shared', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(lobby() as any);
    prismaMock.roomFile.findMany.mockResolvedValue([roomFile()] as any);

    const res = await request('/api/lobby/482913/files');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe('chapter-3.pdf');
    // The list never carries the text itself — only whether there is any.
    expect(body.files[0].hasText).toBe(true);
    expect(body.files[0].text).toBeUndefined();
  });

  it('reports a lobby that does not exist', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(null);
    const res = await request('/api/lobby/482913/files');
    expect(res.status).toBe(404);
  });
});

describe('Room files — adding', () => {
  beforeEach(() => {
    prismaMock.lobby.findUnique.mockReset();
    prismaMock.roomFile.create.mockReset();
    prismaMock.roomFile.count.mockReset();
  });

  it('stores the file with the text the AI reads', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(lobby() as any);
    prismaMock.roomFile.count.mockResolvedValue(0);
    prismaMock.roomFile.create.mockImplementation(async ({ data }: any) => roomFile({ ...data }));

    const res = await request('/api/lobby/482913/files', {
      method: 'POST',
      body: JSON.stringify({
        name: 'chapter-3.pdf',
        type: 'pdf',
        size: 2048,
        text: 'Photosynthesis happens in the chloroplast.',
      }),
    });

    expect(res.status).toBe(201);
    expect(prismaMock.roomFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lobbyId: 'lobby-1',
          uploaderId: 'u1',
          name: 'chapter-3.pdf',
          text: 'Photosynthesis happens in the chloroplast.',
        }),
      }),
    );
  });

  it('refuses to add to a closed lobby', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(lobby({ status: 'closed' }) as any);

    const res = await request('/api/lobby/482913/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'notes.pdf', type: 'pdf', size: 10 }),
    });
    expect(res.status).toBe(410);
    expect(prismaMock.roomFile.create).not.toHaveBeenCalled();
  });
});

describe('Room files — removing', () => {
  beforeEach(() => {
    prismaMock.lobby.findUnique.mockReset();
    prismaMock.roomFile.findFirst.mockReset();
    prismaMock.roomFile.delete.mockReset();
  });

  it('lets the person who added the file take it down', async () => {
    const { request } = await login('u1');
    prismaMock.lobby.findUnique.mockResolvedValue(lobby() as any);
    prismaMock.roomFile.findFirst.mockResolvedValue(roomFile() as any);

    const res = await request('/api/lobby/482913/files/file-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.roomFile.delete).toHaveBeenCalled();
  });

  it('stops somebody else from taking it down', async () => {
    const { request } = await login('u2', 'Ben');
    prismaMock.lobby.findUnique.mockResolvedValue(lobby({ hostId: 'u1' }) as any);
    prismaMock.roomFile.findFirst.mockResolvedValue(roomFile({ uploaderId: 'u1' }) as any);

    const res = await request('/api/lobby/482913/files/file-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(prismaMock.roomFile.delete).not.toHaveBeenCalled();
  });

  it('lets the lobby host remove anything', async () => {
    const { request } = await login('u2', 'Ben');
    prismaMock.lobby.findUnique.mockResolvedValue(lobby({ hostId: 'u2' }) as any);
    prismaMock.roomFile.findFirst.mockResolvedValue(roomFile({ uploaderId: 'u1' }) as any);

    const res = await request('/api/lobby/482913/files/file-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.roomFile.delete).toHaveBeenCalled();
  });
});
