import 'dotenv/config';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { app } from './app.js';
import { attachGameWebSocket } from './routes/ws.js';

const port = Number(process.env.PORT) || 3001;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`🚀 StudyWorks API running on http://localhost:${port}`);
}) as unknown as Server;

// Attach the multiplayer quiz WebSocket server to the same HTTP server.
attachGameWebSocket(server);
