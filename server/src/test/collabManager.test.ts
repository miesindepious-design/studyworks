/**
 * Tests for the collaboration manager — the in-memory presence layer.
 *
 * What is proven here:
 *
 *   1. a ticket opens exactly one socket, for one folder, and then it is dead;
 *   2. a frame reaches everyone in the room and nobody else — in particular
 *      not the person who caused it;
 *   3. leaving, or being removed, is announced and leaves no ghost behind;
 *   4. a socket that has died does not stop the room being told things.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { collabManager } from '../lib/collabManager.js';

function fakeSocket() {
  const frames: string[] = [];
  return {
    frames,
    readyState: 1 as number,
    send: (data: string) => { frames.push(data); },
    close: vi.fn(),
    parsed: () => frames.map(f => JSON.parse(f)),
  };
}

/** Issue a ticket and join with it, in one step. */
function enter(folderId: string, userId: string, name = userId) {
  const ws = fakeSocket();
  const identity = collabManager.redeemTicket(folderId, collabManager.issueTicket(folderId, userId, name));
  if (!identity) throw new Error('ticket was refused');
  return { ws, conn: collabManager.join(folderId, identity, ws) };
}

describe('collabManager', () => {
  beforeEach(() => collabManager.reset());
  afterEach(() => vi.useRealTimers());

  // ── Tickets ──────────────────────────────────────────────────────────────

  it('spends a ticket on first use', () => {
    const t = collabManager.issueTicket('f1', 'u1', 'Ada');
    expect(collabManager.redeemTicket('f1', t)).toEqual({ userId: 'u1', name: 'Ada' });
    expect(collabManager.redeemTicket('f1', t)).toBeNull();
  });

  it('refuses a ticket presented for a different folder', () => {
    const t = collabManager.issueTicket('f1', 'u1', 'Ada');
    expect(collabManager.redeemTicket('f2', t)).toBeNull();
  });

  it('refuses a ticket after a minute', () => {
    vi.useFakeTimers();
    const t = collabManager.issueTicket('f1', 'u1', 'Ada');
    vi.advanceTimersByTime(61_000);
    expect(collabManager.redeemTicket('f1', t)).toBeNull();
  });

  it('does not issue the same ticket twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(collabManager.issueTicket('f1', 'u1', 'Ada'));
    expect(seen.size).toBe(200);
  });

  // ── Presence ─────────────────────────────────────────────────────────────

  it('knows who is in a folder', () => {
    enter('f1', 'u1', 'Ada');
    enter('f1', 'u2', 'Grace');
    expect(collabManager.presence('f1')).toEqual([
      { userId: 'u1', name: 'Ada', noteId: undefined },
      { userId: 'u2', name: 'Grace', noteId: undefined },
    ]);
    expect(collabManager.presence('nowhere')).toEqual([]);
  });

  it('forgets somebody who leaves, and tells the others', () => {
    const a = enter('f1', 'u1', 'Ada');
    const b = enter('f1', 'u2', 'Grace');
    b.ws.frames.length = 0;

    collabManager.disconnect(a.conn.connId);

    expect(collabManager.roomSize('f1')).toBe(1);
    expect(b.ws.parsed()).toContainEqual({ type: 'left', userId: 'u1', name: 'Ada' });
    expect(collabManager.presence('f1')).toEqual([{ userId: 'u2', name: 'Grace', noteId: undefined }]);
  });

  it('empties the room when the last person leaves', () => {
    const a = enter('f1', 'u1');
    collabManager.disconnect(a.conn.connId);
    expect(collabManager.roomSize('f1')).toBe(0);
    // And a second disconnect for the same socket is harmless.
    collabManager.disconnect(a.conn.connId);
    expect(collabManager.roomSize('f1')).toBe(0);
  });

  it('records which note somebody has open, and tells everyone but them', () => {
    const a = enter('f1', 'u1', 'Ada');
    const b = enter('f1', 'u2', 'Grace');
    a.ws.frames.length = 0;
    b.ws.frames.length = 0;

    collabManager.setEditing('f1', a.conn.connId, 'n1');

    expect(collabManager.presence('f1')[0].noteId).toBe('n1');
    expect(b.ws.parsed()).toContainEqual({ type: 'editing', userId: 'u1', name: 'Ada', noteId: 'n1' });
    expect(a.ws.parsed().some(f => f.type === 'editing')).toBe(false);

    collabManager.setEditing('f1', a.conn.connId, null);
    expect(collabManager.presence('f1')[0].noteId).toBeUndefined();
  });

  // ── Broadcasting ─────────────────────────────────────────────────────────

  it('reaches every socket in the folder and no other folder', () => {
    const a = enter('f1', 'u1');
    const b = enter('f1', 'u2');
    const c = enter('f2', 'u3');

    collabManager.broadcast('f1', { type: 'note-updated', noteId: 'n1' });

    expect(a.ws.parsed()).toHaveLength(1);
    expect(b.ws.parsed()).toHaveLength(1);
    expect(c.ws.frames).toHaveLength(0);
  });

  it('can leave one socket out, so nobody is told about their own save', () => {
    const a = enter('f1', 'u1');
    const b = enter('f1', 'u2');

    collabManager.broadcast('f1', { type: 'note-updated', noteId: 'n1' }, a.conn.connId);

    expect(a.ws.frames).toHaveLength(0);
    expect(b.ws.parsed()).toHaveLength(1);
  });

  it('keeps serving the room when one socket has died', () => {
    const a = enter('f1', 'u1');
    const b = enter('f1', 'u2');
    a.ws.readyState = 3; // CLOSED

    expect(() => collabManager.broadcast('f1', { type: 'presence', members: [] })).not.toThrow();
    expect(a.ws.frames).toHaveLength(0);
    expect(b.ws.parsed()).toHaveLength(1);
  });

  it('keeps serving the room when a socket throws on send', () => {
    const a = enter('f1', 'u1');
    const b = enter('f1', 'u2');
    a.ws.send = () => { throw new Error('socket is gone'); };

    expect(() => collabManager.broadcast('f1', { type: 'presence', members: [] })).not.toThrow();
    expect(b.ws.parsed()).toHaveLength(1);
  });

  it('sends to one connection only', () => {
    const a = enter('f1', 'u1');
    const b = enter('f1', 'u2');

    collabManager.sendTo(a.conn.connId, { type: 'welcome', connId: a.conn.connId });

    expect(a.ws.parsed()).toEqual([{ type: 'welcome', connId: a.conn.connId }]);
    expect(b.ws.frames).toHaveLength(0);
  });

  // ── Being removed ────────────────────────────────────────────────────────

  it('closes only the removed person, and tells them why before closing', () => {
    const removed = enter('f1', 'u1', 'Ada');
    const alsoTheirs = enter('f1', 'u1', 'Ada'); // a second tab
    const other = enter('f1', 'u2', 'Grace');
    other.ws.frames.length = 0;

    collabManager.closeUser('f1', 'u1', 'You no longer have access to this folder.');

    for (const ws of [removed.ws, alsoTheirs.ws]) {
      expect(ws.parsed()).toEqual([{ type: 'kicked', message: 'You no longer have access to this folder.' }]);
      expect(ws.close).toHaveBeenCalledTimes(1);
    }
    expect(other.ws.close).not.toHaveBeenCalled();
    expect(collabManager.presence('f1')).toEqual([{ userId: 'u2', name: 'Grace', noteId: undefined }]);
    expect(other.ws.parsed()).toContainEqual({ type: 'left', userId: 'u1', name: 'Ada' });
  });

  it('does nothing when the person is not in the room', () => {
    const other = enter('f1', 'u2');
    expect(() => collabManager.closeUser('f1', 'u9', 'gone')).not.toThrow();
    expect(other.ws.frames).toHaveLength(0);
    expect(collabManager.roomSize('f1')).toBe(1);
  });
});
