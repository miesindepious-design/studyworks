import 'dotenv/config';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { app } from './app.js';
import { attachGameWebSocket } from './routes/ws.js';
import { attachVoiceSignaling } from './routes/voiceSignaling.js';

const port = Number(process.env.PORT) || 3001;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`🚀 StudyWorks API running on http://localhost:${port}`);
}) as unknown as Server;

// Attach the multiplayer quiz WebSocket server to the same HTTP server.
attachGameWebSocket();

// Attach voice chat signaling on the same host/port when available.
// On Vercel serverless this will no-op because there's no persistent server.
attachVoiceSignaling(server);
