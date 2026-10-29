import 'dotenv/config';
import { Server } from 'http';
import { attachVoiceSignaling } from './routes/voiceSignaling.js';
import { serve } from '@hono/node-server';

const port = Number(process.env.PORT || 3002);

const server = serve({
  fetch: () => new Response('StudyWorks voice signaling server', { status: 200 }),
  port,
}) as unknown as Server;

attachVoiceSignaling(server);

console.log(`🎙️ Voice signaling running on http://localhost:${port}`);
