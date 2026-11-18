/**
 * Voice chat signaling via Socket.IO.
 *
 * This is intentionally a separate attachment so it can be a no-op on
 * hosts that don't support raw WebSockets (e.g. Vercel serverless).
 */

import { Server as SocketServer, Socket } from 'socket.io';

const socketPlayerMap = new Map<string, { playerId: string; roomId: string }>();

/** Everyone currently in a room, minus one player id. */
function peersInRoom(roomId: string, exceptPlayerId?: string): string[] {
  const ids = new Set<string>();
  for (const info of socketPlayerMap.values()) {
    if (info.roomId !== roomId) continue;
    if (exceptPlayerId && info.playerId === exceptPlayerId) continue;
    ids.add(info.playerId);
  }
  return Array.from(ids);
}

function getAllowedOrigins(): string | string[] {
  const raw = process.env.VOICE_ALLOWED_ORIGINS;
  if (!raw) return '*';
  const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

export function attachVoiceSignaling(server: unknown): void {
  const io = new SocketServer(server as any, {
    path: '/socket.io/voice',
    cors: {
      origin: getAllowedOrigins(),
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('voice:join', ({ playerId, roomId }: { playerId: string; roomId: string }) => {
      socketPlayerMap.set(socket.id, { playerId, roomId });
      socket.join(roomId);

      // Peer discovery. Without this the room is silent: a client only calls
      // peers it already knows about, and the only thing that used to reveal
      // a peer was the offer that never came — so both sides waited forever.
      // The newcomer is told who is already here, and the room is told that
      // the newcomer is here.
      socket.emit('voice:peers', { peers: peersInRoom(roomId, playerId) });
      socket.to(roomId).emit('voice:peer_joined', { playerId });
    });

    socket.on('voice:signal', ({ targetPlayerId, signal, roomId, senderPlayerId }: {
      targetPlayerId: string;
      signal: any;
      roomId: string;
      senderPlayerId?: string;
    }) => {
      const sender = senderPlayerId || socketPlayerMap.get(socket.id)?.playerId;
      if (!sender) return;

      for (const [targetSockId, info] of socketPlayerMap.entries()) {
        if (info.roomId === roomId && info.playerId === targetPlayerId) {
          io.to(targetSockId).emit('voice:signal', {
            senderPlayerId: sender,
            signal,
          });
          break;
        }
      }
    });

    socket.on('voice:state', ({ isMuted, isDeafened, roomId }: {
      isMuted: boolean;
      isDeafened: boolean;
      roomId: string;
    }) => {
      const playerInfo = socketPlayerMap.get(socket.id);
      if (!playerInfo) return;

      io.to(roomId).emit('voice:state_change', {
        playerId: playerInfo.playerId,
        isMuted,
        isDeafened,
      });
    });

    socket.on('disconnect', () => {
      const playerInfo = socketPlayerMap.get(socket.id);
      if (playerInfo) {
        // Notify remaining peers in the same room that this player left
        io.to(playerInfo.roomId).emit('voice:peer_left', { playerId: playerInfo.playerId });
      }
      socketPlayerMap.delete(socket.id);
    });
  });
}
