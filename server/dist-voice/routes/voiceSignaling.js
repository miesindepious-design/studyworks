/**
 * Voice chat signaling via Socket.IO.
 *
 * This is intentionally a separate attachment so it can be a no-op on
 * hosts that don't support raw WebSockets (e.g. Vercel serverless).
 */
import { Server as SocketServer } from 'socket.io';
const socketPlayerMap = new Map();
function getAllowedOrigins() {
    const raw = process.env.VOICE_ALLOWED_ORIGINS;
    if (!raw)
        return '*';
    const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
}
export function attachVoiceSignaling(server) {
    const io = new SocketServer(server, {
        path: '/socket.io/voice',
        cors: {
            origin: getAllowedOrigins(),
            methods: ['GET', 'POST'],
        },
    });
    io.on('connection', (socket) => {
        socket.on('voice:join', ({ playerId, roomId }) => {
            socketPlayerMap.set(socket.id, { playerId, roomId });
            socket.join(roomId);
        });
        socket.on('voice:signal', ({ targetPlayerId, signal, roomId, senderPlayerId }) => {
            const sender = senderPlayerId || socketPlayerMap.get(socket.id)?.playerId;
            if (!sender)
                return;
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
        socket.on('voice:state', ({ isMuted, isDeafened, roomId }) => {
            const playerInfo = socketPlayerMap.get(socket.id);
            if (!playerInfo)
                return;
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
