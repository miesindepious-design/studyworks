/**
 * Tests for the lobby routes.
 *
 *   GET  /api/lobby/:code  → resolve a six-digit code to the session it fronts
 *   GET  /api/lobby/mine   → the lobbies the caller hosts
 *
 * The lobby is the shareable front door, so the behaviour worth pinning down
 * is: the code format, what happens on a bad/expired/missing code, and that
 * a quiz lobby points at the right game room.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const FUTURE = new Date('2026-11-18T12:00:00.000Z');
const PAST   = new Date('2026-11-16T12:00:00.000Z');

function lobby(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lobby-1',
    code: '482913',
    kind: 'quiz',
    title: 'Quiz Battle',
    hostId: 'u1',
    targetCode: 'ROOM123',
    targetUrl: null,
    maxParticipants: 12,
    status: 'open',
    createdAt: NOW,
    expiresAt: FUTURE,
    host: { name: 'Ada' },
    ...overrides,
  };
}

/** Log in and clear any queued one-shot implementations. */
async function login() {
  const { request, login: doLogin } = await buildTestApp();
  doLogin({ id: 'u1', email: 'a@b.com', name: 'Ada', tier: 'PRO' });
  prismaMock.lobby.findUnique.mockReset();
  prismaMock.lobby.findMany.mockReset();
  prismaMock.gameRoom.findUnique.mockReset();
  return { request };
}

describe('Lobby — resolve by code', () => {
  beforeEach(() => {
    prismaMock.lobby.findUnique.mockReset();
    prismaMock.lobby.findMany.mockReset();
    prismaMock.gameRoom.findUnique.mockReset();
  });

  it('rejects an unauthenticated request', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(401);
  });

  it('resolves a quiz lobby to its game room', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby() as any);
    prismaMock.gameRoom.findUnique.mockResolvedValueOnce({
      code: 'ROOM123',
      status: 'lobby',
      topic: 'Photosynthesis',
      players: [{ id: 'p1' }, { id: 'p2' }],
      host: { name: 'Ada' },
    } as any);

    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('482913');
    expect(body.kind).toBe('quiz');
    expect(body.hostName).toBe('Ada');
    expect(body.sessionTitle).toBe('Photosynthesis');
    expect(body.playerCount).toBe(2);
    expect(body.target).toEqual({ kind: 'quiz', roomCode: 'ROOM123' });
  });

  it('normalises a code the player pasted with spaces', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby() as any);
    prismaMock.gameRoom.findUnique.mockResolvedValueOnce({
      code: 'ROOM123', status: 'lobby', topic: null, players: [], host: { name: 'Ada' },
    } as any);

    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: '482913' } }),
    );
  });

  it('rejects a code that is not six digits', async () => {
    const { request } = await login();
    const res = await request('/api/lobby/123');
    expect(res.status).toBe(400);
    expect(prismaMock.lobby.findUnique).not.toHaveBeenCalled();
  });

  it('404s for an unknown code', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(null as any);
    const res = await request('/api/lobby/000000');
    expect(res.status).toBe(404);
  });

  it('410s for an expired lobby', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby({ expiresAt: PAST }) as any);
    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(410);
  });

  it('reports a finished game as closed', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby() as any);
    prismaMock.gameRoom.findUnique.mockResolvedValueOnce({
      code: 'ROOM123', status: 'finished', topic: null, players: [], host: { name: 'Ada' },
    } as any);

    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('closed');
  });

  it('404s when the game room behind the lobby is gone', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby() as any);
    prismaMock.gameRoom.findUnique.mockResolvedValueOnce(null as any);
    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(404);
  });

  it('resolves a study lobby to its room URL', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValueOnce(lobby({
      kind: 'study',
      title: 'Chemistry session',
      targetCode: 'voice-room-1',
      targetUrl: 'https://example.daily.co/room',
    }) as any);

    const res = await request('/api/lobby/482913');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('study');
    // The voice room id travels with the link so the joiner lands in the
    // same voice room as the host.
    expect(body.target).toEqual({
      kind: 'study',
      roomUrl: 'https://example.daily.co/room',
      voiceRoomId: 'voice-room-1',
    });
  });
});

describe('Lobby — my lobbies', () => {
  beforeEach(() => {
    prismaMock.lobby.findMany.mockReset();
  });

  it('lists the lobbies the caller hosts', async () => {
    const { request } = await login();
    prismaMock.lobby.findMany.mockResolvedValueOnce([
      lobby(),
      lobby({ code: '771204', kind: 'study', title: 'Study room', targetUrl: null }),
    ] as any);

    const res = await request('/api/lobby/mine');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].code).toBe('482913');
    expect(body[1].kind).toBe('study');
    expect(prismaMock.lobby.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hostId: 'u1' } }),
    );
  });

  it('rejects an unauthenticated request', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/lobby/mine');
    expect(res.status).toBe(401);
  });
});
