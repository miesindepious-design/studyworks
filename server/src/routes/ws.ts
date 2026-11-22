/**
 * The multiplayer quiz WebSocket.
 *
 *   GET /ws?room=<room code>&ticket=<one-time ticket>
 *
 * The client asks REST for a ticket (`POST /api/game/auth-ticket`), then opens
 * this socket. The ticket is single-use and short-lived, so the socket URL
 * itself is not a credential worth replaying.
 *
 * Everything about the live game — questions, answers, scoring, the
 * countdown, the final ranking — is decided in `gameManager`. This file is
 * only the transport: it authenticates the socket, hands the connection to
 * the manager, and relays frames in both directions.
 *
 * Vercel serverless cannot hold a raw TCP socket, so on that platform the
 * multiplayer server runs as its own long-lived Node process (the same build,
 * started with `node dist/index.js`). Everywhere else — local dev, Railway,
 * Render — this attaches to the same HTTP server that serves the API.
 */
import { Hono } from 'hono';
import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { requireAuth } from '../lib/session.js';
import { gameManager } from '../lib/gameManager.js';

export const wsRouter = new Hono();
wsRouter.use('/*', requireAuth);
wsRouter.get('/', () => new Response('WebSocket route OK', { status: 200 }));

/** Close codes the client can tell apart. */
const CLOSE_BAD_REQUEST = 4001;
const CLOSE_ROOM_GONE   = 4004;

export function attachGameWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Only claim our own path — the voice signaling server has its own
    // upgrade path on the same HTTP server.
    let url: URL;
    try {
      url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      return;
    }
    if (url.pathname !== '/ws') return;

    wss.handleUpgrade(req, socket as any, head, ws => {
      wss.emit('connection', ws, req, url);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: any, url: URL) => {
    const roomCode = (url.searchParams.get('room') ?? '').toUpperCase();
    const ticket = url.searchParams.get('ticket') ?? '';

    if (!roomCode || !ticket) {
      ws.send(JSON.stringify({ type: 'error', message: 'A room code and a ticket are required.' }));
      ws.close(CLOSE_BAD_REQUEST, 'room and ticket are required');
      return;
    }

    const adapter = {
      send: (data: string) => { if (ws.readyState === 1) ws.send(data); },
      get readyState() { return ws.readyState; },
      close: () => ws.close(),
    };

    // The live state is in memory; the round itself is in the database. If
    // this process does not know the room yet (a restart, or the socket
    // running on its own host), put it back before joining.
    try {
      await gameManager.ensureRoom(roomCode);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Could not open that room.' }));
      ws.close(CLOSE_ROOM_GONE, 'room unavailable');
      return;
    }

    const joined = gameManager.connect(roomCode, ticket, adapter);
    if (!joined.ok) {
      ws.send(JSON.stringify({ type: 'error', message: joined.error }));
      ws.close(joined.error.includes('room') ? CLOSE_ROOM_GONE : CLOSE_BAD_REQUEST, joined.error);
      return;
    }

    const { player } = joined;
    const connId = player.connId;

    // Tell the room somebody arrived, and give the newcomer the scoreboard
    // so the waiting room fills in straight away.
    gameManager.broadcast(roomCode, {
      type: 'player-joined',
      userId: player.userId,
      name: player.name,
      role: player.role,
    });
    gameManager.broadcastScores(roomCode);

    ws.on('message', (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'answer': {
          const questionId = String(msg.questionId ?? '');
          const choiceIdx = Number(msg.choiceIdx);
          if (!questionId || !Number.isInteger(choiceIdx)) return;
          gameManager.answer(connId, questionId, choiceIdx);
          break;
        }
        case 'chat': {
          const text = String(msg.text ?? '').slice(0, 500);
          if (!text.trim()) return;
          gameManager.relayChat(connId, text);
          break;
        }
        case 'lobby-reaction': {
          const emoji = String(msg.emoji ?? '').slice(0, 8);
          if (!emoji) return;
          gameManager.broadcast(roomCode, {
            type: 'lobby-reaction',
            emoji,
            userId: player.userId,
            userName: player.name,
            timestamp: Date.now(),
          });
          break;
        }
        case 'use-power-up': {
          // Power-ups are a client-side effect (hiding options, extra time,
          // double points). The room hears about it so nobody wonders where
          // the other player's 50/50 went.
          const powerUp = String(msg.powerUp ?? '');
          if (!powerUp) return;
          gameManager.broadcast(roomCode, {
            type: 'power-up-used',
            userId: player.userId,
            powerUp,
          });
          break;
        }
        case 'end-room': {
          // Only the host may end the round for everybody.
          const room = gameManager.getRoom(roomCode);
          if (!room || room.hostUserId !== player.userId) return;
          gameManager.endRoom(roomCode, 'The host ended the room');
          break;
        }
        default:
          // Unknown frame types are ignored on purpose: a newer client may
          // send things this server does not know about yet.
          break;
      }
    });

    ws.on('close', () => {
      gameManager.disconnect(connId);
    });

    ws.on('error', () => {
      gameManager.disconnect(connId);
    });
  });

  console.log('🎮 Multiplayer quiz WebSocket attached at /ws');
}
