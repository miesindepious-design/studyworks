/**
 * Voice chat signaling via Socket.IO.
 *
 * This is intentionally a separate attachment so it can be a no-op on
 * hosts that don't support raw WebSockets (e.g. Vercel serverless).
 */

import { Server as SocketServer, Socket } from 'socket.io';

const socketPlayerMap = new Map<string, { playerId: string; roomId: string }>();

export function attachVoiceSignaling(server: unknown): void {
  const io = new SocketServer(server as any, {
    path: '/socket.io/voice',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('voice:join', ({ playerId, roomId }: { playerId: string; roomId: string }) => {
      socketPlayerMap.set(socket.id, { playerId, roomId });
      socket.join(roomId);
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
      socketPlayerMap.delete(socket.id);
    });
  });
}
