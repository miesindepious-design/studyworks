/**
 * Lobby routes — the shareable front door to a live session.
 *
 *   GET /api/lobby/:code   → resolve a lobby code to the session it points at
 *   GET /api/lobby/mine    → list the lobbies the caller hosts
 *
 * The lobby is the piece that makes a session easy to share: one six-digit
 * code, one link, one QR code, all of which land the player on the right
 * screen for the right kind of session.
 *
 * Lookup by a six-digit code is brute-forceable in principle (900k
 * combinations), so resolution is rate limited per user. An unguessable
 * code is not the security boundary here — being signed in is.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import { rateLimit } from '../lib/rateLimit.js';
import { isLobbyExpired, normalizeLobbyCode, createLobbyForSession } from '../lib/lobby.js';

export const lobbyRouter = new Hono();
lobbyRouter.use('/*', requireAuth);

// ── Resolve a lobby code ──────────────────────────────────────────────────────
// 20 lookups a minute per user. Enough for a person trying a few codes
// after a typo, far too slow to walk the whole space.
const RESOLVE_LIMIT = 20;
const RESOLVE_WINDOW_MS = 60_000;

/** Public shape of a lobby — what the client needs to render and route. */
function toLobbySummary(lobby: {
  code: string;
  kind: string;
  title: string;
  status: string;
  maxParticipants: number;
  createdAt: Date;
  expiresAt: Date | null;
  host?: { name: string | null } | null;
}) {
  return {
    code: lobby.code,
    kind: lobby.kind,
    title: lobby.title,
    status: lobby.status,
    maxParticipants: lobby.maxParticipants,
    createdAt: lobby.createdAt.toISOString(),
    expiresAt: lobby.expiresAt ? lobby.expiresAt.toISOString() : null,
    hostName: lobby.host?.name ?? null,
  };
}

// ── Lobbies I host ────────────────────────────────────────────────────────────
// NOTE: registered before `/:code` — a param route registered first would
// swallow "/mine" and try to resolve it as a lobby code.
lobbyRouter.get('/mine', async c => {
  const user = c.get('user');

  const lobbies = await prisma.lobby.findMany({
    where: { hostId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { host: { select: { name: true } } },
  });

  return c.json(lobbies.map(l => ({
    ...toLobbySummary(l),
    expired: isLobbyExpired(l),
    target: l.kind === 'quiz'
      ? { kind: 'quiz' as const, roomCode: l.targetCode }
      : { kind: 'study' as const, roomUrl: l.targetUrl, voiceRoomId: l.targetCode },
  })));
});

// ── Resolve a lobby code ──────────────────────────────────────────────────────
lobbyRouter.get('/:code', async c => {
  const user = c.get('user');

  const limit = rateLimit(`lobby-resolve:${user.id}`, RESOLVE_LIMIT, RESOLVE_WINDOW_MS);
  if (!limit.allowed) {
    return c.json({
      error: 'Too many code attempts. Wait a minute and try again.',
      retryAfter: limit.resetAtMs,
    }, 429);
  }

  const code = normalizeLobbyCode(c.req.param('code') ?? '');
  if (!code) {
    return c.json({ error: 'Lobby codes are six digits.' }, 400);
  }

  const lobby = await prisma.lobby.findUnique({
    where: { code },
    include: { host: { select: { name: true } } },
  });

  if (!lobby) {
    return c.json({ error: 'No lobby found with that code.' }, 404);
  }
  if (isLobbyExpired(lobby)) {
    return c.json({ error: 'This lobby has expired. Ask the host for a new code.' }, 410);
  }

  // The session behind the lobby may have finished even though the lobby
  // itself is still open — report that so the client can explain it.
  let status = lobby.status;
  let sessionTitle = lobby.title;
  let playerCount: number | null = null;

  if (lobby.kind === 'quiz' && lobby.targetCode) {
    const room = await prisma.gameRoom.findUnique({
      where: { code: lobby.targetCode },
      include: { players: true, host: { select: { name: true } } },
    });
    if (!room) {
      return c.json({ error: 'That game room no longer exists.' }, 404);
    }
    if (room.status === 'finished') status = 'closed';
    sessionTitle = room.topic || lobby.title;
    playerCount = room.players.length;
  }

  return c.json({
    ...toLobbySummary({ ...lobby, status }),
    sessionTitle,
    playerCount,
    // Where the client should send the player once they arrive.
    // For a study room the voice room id travels with the link: the client
    // hands it to the signaling server so the joiner lands in the same
    // voice room as the host.
    target: lobby.kind === 'quiz'
      ? { kind: 'quiz' as const, roomCode: lobby.targetCode }
      : { kind: 'study' as const, roomUrl: lobby.targetUrl, voiceRoomId: lobby.targetCode },
  });
});

// ── Create a lobby directly ───────────────────────────────────────────────────
// The quiz and study-room routes mint their own lobby automatically; this
// endpoint exists so a client can spin up a lobby for a session that was
// created elsewhere.
lobbyRouter.post('/', zValidator('json', z.object({
  kind: z.enum(['quiz', 'study']),
  title: z.string().min(1).max(80).optional(),
  targetCode: z.string().max(64).optional(),
  targetUrl: z.string().url().optional(),
  maxParticipants: z.number().int().min(2).max(12).default(6),
})), async c => {
  const user = c.get('user');
  const body = await c.req.valid('json');

  const lobby = await createLobbyForSession({
    hostId: user.id,
    kind: body.kind,
    title: body.title || (body.kind === 'quiz' ? 'Quiz Battle' : 'Study Room'),
    targetCode: body.targetCode ?? null,
    targetUrl: body.targetUrl ?? null,
    maxParticipants: body.maxParticipants,
  });

  return c.json(toLobbySummary(lobby), 201);
});
