/**
 * Tests for the lobby routes.
 *
 *   GET  /api/lobby/:code        → resolve a six-digit code to the session it fronts
 *   GET  /api/lobby/mine         → the lobbies the caller hosts
 *   POST /api/lobby/:code/join   → register presence in a study session
 *   POST /api/lobby/:code/leave  → leave; hands the host role on if needed
 *   POST /api/lobby/:code/close  → host-only: kill the code, link and QR
 *
 * The lobby is the shareable front door, so the behaviour worth pinning down
 * is: the code format, what happens on a bad/expired/missing code, that a
 * quiz lobby points at the right game room, and that a study session keeps
 * a host when its creator leaves and closes once everybody is gone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { sweepLobbies } from '../lib/lobby.js';

// Fixtures are relative to the real clock. Hardcoded dates here were a time
// bomb: once the calendar moved past them every lobby fixture read as
// "expired" and the whole resolve suite started 410-ing.
const NOW = new Date();
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
  prismaMock.lobbyParticipant.findUnique.mockReset();
  prismaMock.lobbyParticipant.findMany.mockReset();
  prismaMock.lobbyParticipant.create.mockReset();
  prismaMock.lobbyParticipant.update.mockReset();
  prismaMock.lobbyParticipant.updateMany.mockReset();
  return { request };
}

/** A study lobby — the kind that tracks attendance. */
function studyLobby(overrides: Record<string, unknown> = {}) {
  return lobby({
    kind: 'study',
    title: 'Chemistry session',
    targetCode: 'voice-room-1',
    targetUrl: 'https://example.daily.co/room',
    maxParticipants: 6,
    ...overrides,
  });
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
    prismaMock.lobby.findUnique.mockResolvedValueOnce(studyLobby() as any);
    // The host is present, so no handoff — the roster comes back with them on it.
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u1', joinedAt: NOW, user: { name: 'Ada' } },
    ] as any);

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
    expect(body.hostUserId).toBe('u1');
    expect(body.participants.map((p: any) => p.userId)).toEqual(['u1']);
    // The read doubled as the caller's heartbeat.
    expect(prismaMock.lobbyParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lobbyId: 'lobby-1', userId: 'u1', leftAt: null } }),
    );
  });
});

describe('Lobby — my lobbies', () => {
  beforeEach(() => {
    prismaMock.lobby.findMany.mockReset();
  });

  it('lists the lobbies the caller hosts', async () => {
    const { request } = await login();
    // The resolve and the sweep both list lobbies; only the host query
    // filters by hostId, so the mock tells them apart by their where clause.
    prismaMock.lobby.findMany.mockImplementation(async (args: any) =>
      args?.where && 'hostId' in (args.where ?? {})
        ? [lobby(), lobby({ code: '771204', kind: 'study', title: 'Study room', targetUrl: null })]
        : [],
    );

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

// ── Study session presence ────────────────────────────────────────────────────
// The roster, the host handoff and the empty-room sweep all hang off the
// LobbyParticipant rows, so this is where "users can join and participate"
// actually gets pinned down.

describe('Lobby — joining a study session', () => {
  beforeEach(async () => {
    await login();
  });

  it('records the caller and returns the roster with the current host', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobbyParticipant.findUnique.mockResolvedValueOnce(null as any);
    prismaMock.lobbyParticipant.create.mockResolvedValueOnce({} as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u1', joinedAt: NOW, user: { name: 'Ada' } },
      { userId: 'u2', joinedAt: NOW, user: { name: 'Ben' } },
    ] as any);

    const res = await request('/api/lobby/482913/join', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hostUserId).toBe('u1');
    expect(body.participants.map((p: any) => p.userId)).toEqual(['u1', 'u2']);
    expect(prismaMock.lobbyParticipant.create).toHaveBeenCalledWith({
      data: { lobbyId: 'lobby-1', userId: 'u1' },
    });
  });

  it('reopens the same row when a returning player rejoins', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobbyParticipant.findUnique.mockResolvedValueOnce({ id: 'vp1', leftAt: PAST } as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u1', joinedAt: NOW, user: { name: 'Ada' } },
    ] as any);

    const res = await request('/api/lobby/482913/join', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobbyParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vp1' },
        data: expect.objectContaining({ leftAt: null }),
      }),
    );
    expect(prismaMock.lobbyParticipant.create).not.toHaveBeenCalled();
  });

  it('rejects a join when the room is full', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ maxParticipants: 2 }) as any);
    // Two people already in, neither of them the caller.
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u2', joinedAt: NOW, user: { name: 'Ben' } },
      { userId: 'u3', joinedAt: NOW, user: { name: 'Cleo' } },
    ] as any);

    const res = await request('/api/lobby/482913/join', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(prismaMock.lobbyParticipant.create).not.toHaveBeenCalled();
  });

  it('does not take attendance for quiz lobbies', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(lobby() as any);

    const res = await request('/api/lobby/482913/join', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(prismaMock.lobbyParticipant.create).not.toHaveBeenCalled();
  });

  it('refuses a join on a lobby the host has closed', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ status: 'closed' }) as any);

    const res = await request('/api/lobby/482913/join', { method: 'POST' });
    expect(res.status).toBe(410);
  });
});

describe('Lobby — leaving a study session', () => {
  beforeEach(async () => {
    await login();
  });

  it('hands the host to the earliest-joined participant when the host leaves', async () => {
    const { request } = await login();
    // The leave route resolves the lobby by code, then again by id.
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobbyParticipant.findUnique.mockResolvedValueOnce({ id: 'vp1', leftAt: null } as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u2', joinedAt: NOW, user: { name: 'Ben' } },
    ] as any);

    const res = await request('/api/lobby/482913/leave', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostUserId).toBe('u2');
    expect(prismaMock.lobbyParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'vp1' }, data: { leftAt: expect.any(Date) } }),
    );
    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { hostId: 'u2' },
    });
  });

  it('keeps the host when somebody else leaves', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobbyParticipant.findUnique.mockResolvedValueOnce({ id: 'vp2', leftAt: null } as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { userId: 'u1', joinedAt: NOW, user: { name: 'Ada' } },
    ] as any);

    const res = await request('/api/lobby/482913/leave', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).hostUserId).toBe('u1');
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('is a no-op for somebody who was never in the lobby', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobbyParticipant.findUnique.mockResolvedValueOnce(null as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([] as any);

    const res = await request('/api/lobby/482913/leave', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobbyParticipant.update).not.toHaveBeenCalled();
  });
});

describe('Lobby — closing a lobby', () => {
  beforeEach(async () => {
    await login();
  });

  it('lets the host close the lobby, killing code, link and QR together', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);

    const res = await request('/api/lobby/482913/close', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('refuses to let anybody but the host close it', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ hostId: 'u2' }) as any);

    const res = await request('/api/lobby/482913/close', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('closing twice is harmless', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ status: 'closed' }) as any);

    const res = await request('/api/lobby/482913/close', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });
});

describe('Lobby — deleting a lobby', () => {
  beforeEach(async () => {
    await login();
    prismaMock.lobby.delete.mockReset();
    prismaMock.lobby.deleteMany.mockReset();
  });

  it('lets the host delete the lobby for good', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby() as any);
    prismaMock.lobby.delete.mockResolvedValue({} as any);

    const res = await request('/api/lobby/482913', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.delete).toHaveBeenCalledWith({ where: { id: 'lobby-1' } });
  });

  it('deletes a lobby that is already closed — that is the whole point', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ status: 'closed' }) as any);
    prismaMock.lobby.delete.mockResolvedValue({} as any);

    const res = await request('/api/lobby/482913', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.delete).toHaveBeenCalled();
  });

  it('refuses to let anybody but the host delete it', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(studyLobby({ hostId: 'u2' }) as any);

    const res = await request('/api/lobby/482913', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(prismaMock.lobby.delete).not.toHaveBeenCalled();
  });

  it('404s for an unknown code', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(null as any);

    const res = await request('/api/lobby/000000', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(prismaMock.lobby.delete).not.toHaveBeenCalled();
  });

  it('rejects a code that is not six digits', async () => {
    const { request } = await login();
    const res = await request('/api/lobby/123', { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(prismaMock.lobby.delete).not.toHaveBeenCalled();
  });

  it('clears every ended lobby of mine in one go', async () => {
    const { request } = await login();
    prismaMock.lobby.deleteMany.mockResolvedValue({ count: 7 } as any);

    const res = await request('/api/lobby/mine', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(7);
    // Only my own ended lobbies — never a live one, never somebody else's.
    const where = prismaMock.lobby.deleteMany.mock.calls[0][0].where;
    expect(where.hostId).toBe('u1');
    expect(where.OR).toEqual([
      { status: 'closed' },
      { expiresAt: { lt: expect.any(Date) } },
    ]);
  });
});

describe('Lobby — reopening a study group', () => {
  beforeEach(async () => {
    await login();
  });

  /** A group that exists only to hold material — no session behind it. */
  function materialGroup(overrides: Record<string, unknown> = {}) {
    return lobby({
      kind: 'study',
      title: 'Study group',
      targetCode: null,
      targetUrl: null,
      ...overrides,
    });
  }

  it('brings a closed material group back to life', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(materialGroup({ status: 'closed' }) as any);

    const res = await request('/api/lobby/482913/reopen', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: {
        status: 'open',
        lastActivityAt: expect.any(Date),
        expiresAt: expect.any(Date),
      },
    });
  });

  it('refuses to reopen a lobby that fronts a finished session', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(lobby({ status: 'closed' }) as any);

    const res = await request('/api/lobby/482913/reopen', { method: 'POST' });
    expect(res.status).toBe(410);
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('refuses to let anybody but the host reopen it', async () => {
    const { request } = await login();
    prismaMock.lobby.findUnique.mockResolvedValue(materialGroup({ hostId: 'u2' }) as any);

    const res = await request('/api/lobby/482913/reopen', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });
});

; const T = Date.now();
// The sweep works against the real clock, so these fixtures are relative
// to Date.now() rather than the fixed NOW the rest of the file uses.
describe('Lobby — the empty-room sweep', () => {
  beforeEach(async () => {
    await login();
  });

  it('closes a study lobby that has been empty for over two minutes', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([studyLobby()] as any);
    // Everybody left three minutes ago.
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { leftAt: new Date(T - 3 * 60_000), lastSeenAt: new Date(T - 3 * 60_000) },
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('leaves a study lobby alone while somebody is still heartbeating', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([studyLobby()] as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { leftAt: null, lastSeenAt: new Date(T) },
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('gives an empty study lobby its two-minute grace period', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([studyLobby()] as any);
    // Left just now — a refresh or a dropped connection, not a departure.
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([
      { leftAt: new Date(T - 10_000), lastSeenAt: new Date(T - 10_000) },
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('closes a quiz lobby whose game has finished', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([lobby()] as any);
    prismaMock.gameRoom.findUnique.mockResolvedValue({ status: 'finished' } as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('closes a quiz lobby whose game room has been deleted', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([lobby()] as any);
    prismaMock.gameRoom.findUnique.mockResolvedValue(null as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('closes a lobby past its 24-hour TTL even if its session looks alive', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      lobby({ expiresAt: new Date(T - 60_000) }),
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
    // The TTL check happens before the session lookup — nothing to ask.
    expect(prismaMock.gameRoom.findUnique).not.toHaveBeenCalled();
  });

  it('closes a study lobby nobody ever joined once the grace period passes', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      studyLobby({ createdAt: new Date(T - 5 * 60_000) }),
    ] as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('leaves a freshly created study lobby alone before the grace period ends', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      studyLobby({ createdAt: new Date(T - 30_000) }),
    ] as any);
    prismaMock.lobbyParticipant.findMany.mockResolvedValue([] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('leaves a quiz lobby alone while its game is still going', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([lobby()] as any);
    prismaMock.gameRoom.findUnique.mockResolvedValue({ status: 'live' } as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });
});

describe('Lobby — the idle sweep for material-only groups', () => {
  beforeEach(async () => {
    await login();
    prismaMock.lobby.update.mockReset();
  });

  /** A group that exists only to hold material — no session behind it. */
  function materialGroup(overrides: Record<string, unknown> = {}) {
    return lobby({
      kind: 'study',
      title: 'Study group',
      targetCode: null,
      targetUrl: null,
      ...overrides,
    });
  }

  it('closes a group nobody has touched for two hours', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      materialGroup({ lastActivityAt: new Date(T - 3 * 60 * 60_000) }),
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('leaves a group that was used a moment ago alone', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      materialGroup({ lastActivityAt: new Date(T - 60_000) }),
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
  });

  it('falls back to the creation time when a group has no activity stamp', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      materialGroup({ lastActivityAt: null, createdAt: new Date(T - 5 * 60 * 60_000) }),
    ] as any);

    await sweepLobbies({ force: true });

    expect(prismaMock.lobby.update).toHaveBeenCalledWith({
      where: { id: 'lobby-1' },
      data: { status: 'closed' },
    });
  });

  it('does not use the roster for a group — nobody joins a shelf', async () => {
    prismaMock.lobby.findMany.mockResolvedValue([
      materialGroup({ lastActivityAt: new Date(T - 60_000) }),
    ] as any);

    await sweepLobbies({ force: true });

    // A group that is in use must not be closed just because it has no
    // participant rows, and it must not be closed twice over either.
    expect(prismaMock.lobby.update).not.toHaveBeenCalled();
    expect(prismaMock.lobbyParticipant.findMany).not.toHaveBeenCalled();
  });
});
