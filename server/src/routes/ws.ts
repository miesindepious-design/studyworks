/**
 * WebSocket server for the live multiplayer quiz.
 *
 * Attached to the underlying Node http.Server (see index.ts) on the path
 * /ws. Clients connect to ws[s]://host/ws?room=<CODE>&ticket=<TICKET>. The
 * ticket is issued by POST /api/game/auth-ticket (authenticated) and redeemed
 * once here — we do this instead of parsing the Better Auth session cookie on
 * the upgrade request.
 *
 * Client -> server messages:
 *   { type: 'answer', questionId, choiceIdx }
 *   { type: 'chat', text }
 * Server -> client messages (see lib/gameManager.ts): question, reveal, scores,
 * answer-ack, finished, chat, player-joined, player-left, room-ended, error.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { gameManager } from '../lib/gameManager';

export function attachGameWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return; // let other upgrades (none) pass
    wss.handleUpgrade(req, socket, head, ws => {
      const room = (url.searchParams.get('room') ?? '').toUpperCase();
      const ticket = url.searchParams.get('ticket') ?? '';

      const res = gameManager.connect(room, ticket, ws as unknown as any);
      if (!res.ok) {
        ws.send(JSON.stringify({ type: 'error', message: res.error }));
        ws.close();
        return;
      }
      const connId = res.player.connId;
      gameManager.broadcast(room, {
        type: 'player-joined',
        userId: res.player.userId,
        name: res.player.name,
        role: res.player.role,
      });
      gameManager.broadcastScores(room);

      ws.on('message', (raw: Buffer) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'answer') {
          gameManager.answer(connId, msg.questionId, Number(msg.choiceIdx));
        } else if (msg.type === 'chat') {
          gameManager.relayChat(connId, String(msg.text ?? '').slice(0, 500));
        }
      });

      ws.on('close', () => gameManager.disconnect(connId));
      ws.on('error', () => gameManager.disconnect(connId));
    });
  });
}
