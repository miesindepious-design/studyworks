/**
 * Standalone voice signaling server.
 *
 * Deployed separately from the main API (Vercel serverless can't host
 * persistent WebSocket connections). Run with:
 *   dev:  npx tsx src/voiceServer.ts
 *   prod: node dist/voiceServer.js
 *
 * IMPORTANT: the Socket.IO server is mounted at `/socket.io/voice`. The
 * client (src/components/VoiceChat.tsx) must use the same path — the
 * default `/socket.io/` is swallowed by the HTTP handler below.
 */

import 'dotenv/config';
import { createServer } from 'http';
import { attachVoiceSignaling } from './routes/voiceSignaling.js';

const port = Number(process.env.PORT) || 3002;

const server = createServer((req, res) => {
  // Health check for Render + the keep-alive cron job.
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'studyworks-voice' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

attachVoiceSignaling(server);

server.listen(port, '0.0.0.0', () => {
  console.log(`🎙️ Voice signaling running on http://0.0.0.0:${port}`);
});
