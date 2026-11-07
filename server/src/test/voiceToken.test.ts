/**
 * Tests for the voice session token.
 *
 * The WebRTC signaling server runs on a separate host from the API (Vercel
 * serverless can't hold WebSocket connections), so the API hands out a
 * signed token that the signaling server verifies statelessly. Without
 * this, anyone could join any voice room by guessing a room code.
 */
import { describe, it, expect } from 'vitest';
import { signVoiceToken, verifyVoiceToken, generateRoomCode } from '../lib/voiceToken.js';

const SECRET = 'test-voice-secret';

describe('voice session token', () => {
  it('round-trips a signed payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signVoiceToken({ sub: 'u1', name: 'Ada', exp }, SECRET);

    const payload = verifyVoiceToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('u1');
    expect(payload!.name).toBe('Ada');
  });

  it('rejects a token signed with a different secret', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signVoiceToken({ sub: 'u1', name: 'Ada', exp }, 'other-secret');

    expect(verifyVoiceToken(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = signVoiceToken({ sub: 'u1', name: 'Ada', exp }, SECRET);

    expect(verifyVoiceToken(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signVoiceToken({ sub: 'u1', name: 'Ada', exp }, SECRET);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', name: 'Ada', exp })).toString('base64url');

    expect(verifyVoiceToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(body).not.toBe('');
  });

  it('rejects malformed tokens', () => {
    expect(verifyVoiceToken('', SECRET)).toBeNull();
    expect(verifyVoiceToken('not-a-token', SECRET)).toBeNull();
    expect(verifyVoiceToken('a.b.c', SECRET)).toBeNull();
  });

  it('generates room codes without ambiguous characters', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(code).not.toMatch(/[01OIL]/);
  });

  it('generates distinct room codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBe(50);
  });
});
