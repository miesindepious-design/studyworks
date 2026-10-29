/**
 * Local end-to-end check for the voice signaling relay.
 * Two clients join the same room; one sends a signal targeted at the other.
 */
import { io } from 'socket.io-client';

const URL = 'http://127.0.0.1:3998';
const PATH = '/socket.io/voice';
const ROOM = 'test-room';

const a = io(URL, { path: PATH, transports: ['websocket'] });
const b = io(URL, { path: PATH, transports: ['websocket'] });

let gotSignal = false;
let gotState = false;
let done = false;

const finish = (code) => {
  if (done) return;
  done = true;
  a.close(); b.close();
  console.log(`RESULT signal_relay=${gotSignal} state_broadcast=${gotState}`);
  process.exit(code);
};

setTimeout(() => {
  if (!gotSignal || !gotState) {
    console.error('TIMEOUT — signal relay did not complete');
    finish(1);
  }
}, 12000);

b.on('connect', () => {
  b.emit('voice:join', { playerId: 'player-b', roomId: ROOM });
  console.log('client B connected');
});

b.on('voice:signal', ({ senderPlayerId, signal }) => {
  if (senderPlayerId === 'player-a' && signal?.sdp) {
    gotSignal = true;
    console.log('client B received voice:signal from player-a ✓');
  }
});

b.on('voice:state_change', ({ playerId, isMuted }) => {
  if (playerId === 'player-a' && isMuted === true) {
    gotState = true;
    console.log('client B received voice:state_change from player-a ✓');
  }
});

a.on('connect', () => {
  a.emit('voice:join', { playerId: 'player-a', roomId: ROOM });
  console.log('client A connected');

  setTimeout(() => {
    a.emit('voice:signal', {
      roomId: ROOM,
      senderPlayerId: 'player-a',
      targetPlayerId: 'player-b',
      signal: { sdp: { type: 'offer', sdp: 'v=0-fake' } },
    });
    a.emit('voice:state', { roomId: ROOM, isMuted: true, isDeafened: false });
  }, 600);
});
