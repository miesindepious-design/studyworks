/**
 * Voice session token — a signed, stateless capability for the WebRTC
 * signaling server.
 *
 * WHY THIS EXISTS: the signaling server runs on a different host from the
 * API (Vercel serverless cannot hold persistent WebSocket connections), so
 * it cannot look up the caller's session in the database. Instead the API
 * (which DOES know the user and their tier) issues a short-lived signed
 * token, and the signaling server verifies the signature locally before
 * letting the socket join a room.
 *
 * Format: `base64url(JSON payload).base64url(HMAC-SHA256(payload))`.
 * The payload carries the user id, display name and an expiry timestamp
 * (unix seconds).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VoiceTokenPayload {
  /** User id (Better Auth / Prisma user id). */
  sub: string;
  /** Display name shown in the participant list. */
  name: string;
  /** Expiry, unix seconds. */
  exp: number;
}

/** Room codes avoid 0/O/1/I/L so they can be read aloud and typed. */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Secret used to sign voice tokens. Falls back to BETTER_AUTH_SECRET so
 * there is one secret to configure in a single-host setup.
 */
export function getVoiceTokenSecret(): string {
  return process.env.VOICE_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET || 'dev-voice-token-secret';
}

/** Sign a payload into a compact token. */
export function signVoiceToken(payload: VoiceTokenPayload, secret: string = getVoiceTokenSecret()): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a token and return its payload, or null when the token is
 * malformed, forged, or expired.
 */
export function verifyVoiceToken(token: string, secret: string = getVoiceTokenSecret()): VoiceTokenPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  const { sub, name, exp } = payload as Partial<VoiceTokenPayload>;

  if (typeof sub !== 'string' || !sub) return null;
  if (typeof name !== 'string') return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= Date.now()) return null;

  return { sub, name, exp };
}

/** A random, human-shareable 6-character room code. */
export function generateRoomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}
