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
