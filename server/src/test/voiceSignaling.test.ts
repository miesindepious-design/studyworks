/**
 * Regression tests for the voice signaling server.
 *
 * The Socket.IO mount path is the part most easily broken by accident: the
 * server listens on `/socket.io/voice` while the default is `/socket.io/`.
 * If the client and server disagree, voice chat silently fails to connect
 * even though the server is healthy — so we assert the contract here.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'http';
import { io, type Socket } from 'socket.io-client';
import { attachVoiceSignaling } from '../routes/voiceSignaling.js';

const VOICE_PATH = '/socket.io/voice';
const ROOM = 'test-room';

let server: Server;
let port: number;
const clients: Socket[] = [];

function connect(): Socket {
  const sock = io(`http://127.0.0.1:${port}`, {
    path: VOICE_PATH,
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(sock);
  return sock;
}

function waitFor<T>(fn: () => T | undefined, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = fn();
      if (value !== undefined) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  attachVoiceSignaling(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as any).port;
});

afterAll(() => {
  clients.forEach(c => c.close());
  server.close();
});

describe('voice signaling', () => {
  it('accepts a connection on the /socket.io/voice path', async () => {
    const a = connect();
    await waitFor(() => (a.connected ? true : undefined));
    expect(a.connected).toBe(true);
  });

  it('relays voice:signal to the targeted peer in the same room', async () => {
    const a = connect();
    const b = connect();
    await waitFor(() => (a.connected && b.connected ? true : undefined));

    a.emit('voice:join', { playerId: 'player-a', roomId: ROOM });
    b.emit('voice:join', { playerId: 'player-b', roomId: ROOM });
    await new Promise(r => setTimeout(r, 300));

    const received = waitFor<any>(() => {
      const ev = (b as any).__lastSignal;
      return ev ?? undefined;
    });
    (b as any).on('voice:signal', (payload: any) => { (b as any).__lastSignal = payload; });

    a.emit('voice:signal', {
      roomId: ROOM,
      senderPlayerId: 'player-a',
      targetPlayerId: 'player-b',
      signal: { sdp: { type: 'offer', sdp: 'v=0-test' } },
    });

    const signal = await received;
    expect(signal.senderPlayerId).toBe('player-a');
    expect(signal.signal.sdp.type).toBe('offer');
  });

  it('broadcasts voice:state to everyone in the room', async () => {
    const a = connect();
    const b = connect();
    await waitFor(() => (a.connected && b.connected ? true : undefined));

    a.emit('voice:join', { playerId: 'state-a', roomId: 'state-room' });
    b.emit('voice:join', { playerId: 'state-b', roomId: 'state-room' });
    await new Promise(r => setTimeout(r, 300));

    const received = waitFor<any>(() => (b as any).__lastState ?? undefined);
    (b as any).on('voice:state_change', (payload: any) => { (b as any).__lastState = payload; });

    a.emit('voice:state', { roomId: 'state-room', isMuted: true, isDeafened: false });

    const state = await received;
    expect(state.playerId).toBe('state-a');
    expect(state.isMuted).toBe(true);
  });

  it('does not relay signals across different rooms', async () => {
    const a = connect();
    const b = connect();
    await waitFor(() => (a.connected && b.connected ? true : undefined));

    a.emit('voice:join', { playerId: 'iso-a', roomId: 'room-1' });
    b.emit('voice:join', { playerId: 'iso-b', roomId: 'room-2' });
    await new Promise(r => setTimeout(r, 300));

    let leaked = false;
    (b as any).on('voice:signal', () => { leaked = true; });

    a.emit('voice:signal', {
      roomId: 'room-1',
      senderPlayerId: 'iso-a',
      targetPlayerId: 'iso-b',
      signal: { sdp: { type: 'offer', sdp: 'v=0-leak' } },
    });

    await new Promise(r => setTimeout(r, 600));
    expect(leaked).toBe(false);
  });
});
