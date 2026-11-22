/**
 * lobby.ts — the shareable front door to a live session.
 *
 * A Lobby owns a six-digit code that people can type, share as a link, or
 * scan as a QR code. It points at the session it fronts (a quiz battle or a
 * study room) so the client can refer the player to the right place.
 *
 * Every session mints its lobby at creation time, which means the code a
 * host shares always resolves to something real. The lobby is deliberately
 * a thin pointer: the live state stays where it already lives (the game
 * manager for quizzes, Daily/Socket.IO for study rooms).
 */
import { randomInt } from 'node:crypto';
import { prisma } from './prisma.js';

export const LOBBY_CODE_LENGTH = 6;

/** How long a lobby stays joinable before it is treated as expired. */
export const LOBBY_TTL_MS = 24 * 60 * 60 * 1000;

export type LobbyKind = 'quiz' | 'study';
export type LobbyStatus = 'open' | 'live' | 'closed';

/**
 * A six-digit code in the range 100000–999999.
 *
 * The range deliberately excludes a leading zero: a code read aloud or
 * retyped from a screenshot must not lose its first digit to a sloppy
 * thumbs. There are 900k combinations, which is why the resolve endpoint
 * is rate limited rather than relying on the code being unguessable.
 */
export function generateLobbyCode(): string {
  return String(randomInt(100000, 1000000));
}

/** True when `value` looks like a lobby code (exactly six digits). */
export function isLobbyCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/**
 * Normalise whatever a player typed into a lobby code, or null if it can't be one.
 *
 * Non-digits are stripped so "482 913" and "482-913" still work. The digits
 * are kept as a string rather than run through Number(), because Number()
 * would drop a leading zero and turn a six-digit code into a five-digit one.
 */
export function normalizeLobbyCode(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== LOBBY_CODE_LENGTH) return null;
  return digits;
}

const MAX_CODE_ATTEMPTS = 8;

/**
 * Create a lobby for a session, retrying on the (rare) chance that the
 * generated code is already taken.
 */
export async function createLobbyForSession(params: {
  hostId: string;
  kind: LobbyKind;
  title: string;
  targetCode?: string | null;
  targetUrl?: string | null;
  maxParticipants?: number;
}) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    try {
      return await prisma.lobby.create({
        data: {
          code: generateLobbyCode(),
          kind: params.kind,
          title: params.title,
          hostId: params.hostId,
          targetCode: params.targetCode ?? null,
          targetUrl: params.targetUrl ?? null,
          maxParticipants: params.maxParticipants ?? 6,
          status: 'open',
          expiresAt: new Date(Date.now() + LOBBY_TTL_MS),
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation → this code was taken. Try another.
      if (err?.code === 'P2002' && attempt < MAX_CODE_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  throw new Error('Could not allocate a unique lobby code');
}

/** True when the lobby has aged out and should no longer be joinable. */
export function isLobbyExpired(lobby: { expiresAt: Date | null }): boolean {
  return !!lobby.expiresAt && lobby.expiresAt.getTime() < Date.now();
}

// ── Presence ──────────────────────────────────────────────────────────────────
// Study sessions need server-side presence to answer three questions the
// client can't answer on its own: who is here, who is the host, and has
// everybody left. A participant is "active" while they keep heartbeating
// (the lobby state poll touches lastSeenAt) and have not explicitly left.

/** How long a participant can go without a heartbeat before they count as gone. */
export const PARTICIPANT_STALE_MS = 90_000;

/** How long a lobby stays open with nobody in it before the sweep closes it. */
export const LOBBY_EMPTY_CLOSE_MS = 2 * 60_000;

function staleCutoff(): Date {
  return new Date(Date.now() - PARTICIPANT_STALE_MS);
}

/**
 * Join a lobby: (re)open the caller's presence row.
 *
 * Rejoining after leaving re-opens the same row rather than adding a second
 * one — the unique (lobbyId, userId) index makes that the only sane shape.
 */
export async function joinLobbySession(lobbyId: string, userId: string) {
  const existing = await prisma.lobbyParticipant.findUnique({
    where: { lobbyId_userId: { lobbyId, userId } },
  });
  if (existing) {
    return prisma.lobbyParticipant.update({
      where: { id: existing.id },
      data: { leftAt: null, lastSeenAt: new Date() },
    });
  }
  return prisma.lobbyParticipant.create({ data: { lobbyId, userId } });
}

/**
 * Leave a lobby. If the leaver was a study session's host, the participant
 * who has been there longest takes over so the session keeps a host
 * without anybody having to re-create it.
 */
export async function leaveLobbySession(
  lobbyId: string,
  userId: string,
): Promise<{ hostUserId: string | null }> {
  const existing = await prisma.lobbyParticipant.findUnique({
    where: { lobbyId_userId: { lobbyId, userId } },
  });
  if (existing && !existing.leftAt) {
    await prisma.lobbyParticipant.update({
      where: { id: existing.id },
      data: { leftAt: new Date() },
    });
  }

  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: { id: true, kind: true, hostId: true },
  });
  if (!lobby || lobby.kind !== 'study') return { hostUserId: null };

  const hostUserId = await ensureStudyHost(lobby.id, lobby.hostId);
  return { hostUserId };
}

/**
 * Close a lobby for good. Host-only: closing kills the code, the link and
 * the QR in one move, so nobody new can arrive after the session is over.
 */
export async function closeLobbySession(
  lobbyId: string,
  byUserId: string,
): Promise<{ ok: boolean; reason?: 'not-found' | 'not-host' }> {
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: { id: true, hostId: true, status: true },
  });
  if (!lobby) return { ok: false, reason: 'not-found' };
  if (lobby.hostId !== byUserId) return { ok: false, reason: 'not-host' };
  if (lobby.status !== 'closed') {
    await prisma.lobby.update({ where: { id: lobby.id }, data: { status: 'closed' } });
  }
  return { ok: true };
}

/**
 * Make sure a study session's host is somebody who is actually here.
 *
 * The host is the original creator for as long as they are an active
 * participant. When they leave (or their heartbeat goes silent — a closed
 * tab counts as leaving), the earliest-joined active participant becomes
 * the host and the lobby row is updated to say so.
 */
export async function ensureStudyHost(lobbyId: string, currentHostId: string): Promise<string> {
  const active = await prisma.lobbyParticipant.findMany({
    where: { lobbyId, leftAt: null, lastSeenAt: { gt: staleCutoff() } },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });

  // Nobody to hand the session to — keep the host as-is; the sweep will
  // close the lobby once it has been empty long enough.
  if (active.length === 0) return currentHostId;
  if (active.some(p => p.userId === currentHostId)) return currentHostId;

  const nextHostId = active[0].userId;
  await prisma.lobby.update({ where: { id: lobbyId }, data: { hostId: nextHostId } });
  return nextHostId;
}

/** The people currently in a lobby, in join order, with display names. */
export async function activeParticipants(lobbyId: string) {
  return prisma.lobbyParticipant.findMany({
    where: { lobbyId, leftAt: null, lastSeenAt: { gt: staleCutoff() } },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, joinedAt: true, user: { select: { name: true } } },
  });
}

/**
 * Heartbeat the caller's presence. Best effort — a failed touch just means
 * this poll doesn't count as a beat, and the next one will.
 */
export async function touchPresence(lobbyId: string, userId: string): Promise<void> {
  try {
    await prisma.lobbyParticipant.updateMany({
      where: { lobbyId, userId, leftAt: null },
      data: { lastSeenAt: new Date() },
    });
  } catch {
    // Presence bookkeeping must never break the read it rides on.
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────
// Lobbies are closed lazily: whenever somebody looks at a lobby (resolving a
// code, listing their own), stale ones are swept. No cron needed — a lobby
// nobody looks at is a lobby nobody cares about, and the next person who
// looks will see it closed.

const SWEEP_THROTTLE_MS = 30_000;
let lastSweepAt = 0;

/**
 * Close lobbies that are done:
 *   • quiz lobbies whose game room has finished — the game is over, there
 *     is nothing left for the lobby to front;
 *   • study lobbies that have been empty for two minutes — the grace
 *     period covers a refresh or a dropped connection, not a departure.
 */
export async function sweepLobbies(opts: { force?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (!opts.force && now - lastSweepAt < SWEEP_THROTTLE_MS) return;
  lastSweepAt = now;

  let lobbies: Array<{ id: string; kind: string; targetCode: string | null; createdAt: Date; expiresAt: Date | null }>;
  try {
    lobbies = await prisma.lobby.findMany({
      where: { status: { in: ['open', 'live'] } },
      select: { id: true, kind: true, targetCode: true, createdAt: true, expiresAt: true },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
  } catch (err) {
    // The sweep is maintenance, not the read itself — it must never break
    // the resolve that triggered it.
    console.error('[lobby] sweep could not list lobbies', err);
    return;
  }
  if (!lobbies?.length) return;

  for (const lobby of lobbies ?? []) {
    try {
      // TTL first: a lobby that has aged out is closed no matter what its
      // session is doing — this is what stops lobbies from lingering for
      // days after everybody has forgotten about them.
      if (lobby.expiresAt && lobby.expiresAt.getTime() < now) {
        await prisma.lobby.update({ where: { id: lobby.id }, data: { status: 'closed' } });
        continue;
      }

      if (lobby.kind === 'quiz') {
        if (!lobby.targetCode) continue;
        const room = await prisma.gameRoom.findUnique({
          where: { code: lobby.targetCode },
          select: { status: true },
        });
        // Finished is over; missing means the room was deleted out from
        // under the lobby — both leave nothing for the lobby to front.
        if (!room || room.status === 'finished') {
          await prisma.lobby.update({ where: { id: lobby.id }, data: { status: 'closed' } });
        }
        continue;
      }

      // A study lobby with no session behind it is a material-only group —
      // a shelf the group shares files on. Nobody "joins" it and nobody
      // heartbeats, so the empty-room rule would close it two minutes after
      // it was created. It lives until its TTL instead.
      if (!lobby.targetCode) continue;

      const visits = await prisma.lobbyParticipant.findMany({
        where: { lobbyId: lobby.id },
        select: { leftAt: true, lastSeenAt: true },
      });
      const anybodyActive = visits.some(
        v => !v.leftAt && v.lastSeenAt.getTime() > now - PARTICIPANT_STALE_MS,
      );
      if (anybodyActive) continue;

      // Nobody is here. The grace clock runs from the last departure — or,
      // for a lobby nobody ever joined, from its creation — so an abandoned
      // room can't sit open forever just because it never had a roster.
      const lastActivity = visits.length
        ? visits.reduce(
            (latest, v) => Math.max(latest, (v.leftAt ?? v.lastSeenAt).getTime()),
            0,
          )
        : lobby.createdAt.getTime();
      if (now - lastActivity >= LOBBY_EMPTY_CLOSE_MS) {
        await prisma.lobby.update({ where: { id: lobby.id }, data: { status: 'closed' } });
      }
    } catch (err) {
      // One bad lobby must not stop the sweep.
      console.error('[lobby] sweep failed for lobby', lobby.id, err);
    }
  }
}
