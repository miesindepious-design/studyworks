import { Hono } from 'hono';
import { requireAuth } from '../lib/session.js';

export const wsRouter = new Hono();
wsRouter.use('/*', requireAuth);
wsRouter.get('/', () => new Response('WebSocket route OK', { status: 200 }));

// Vercel serverless does not support raw TCP sockets.
// The actual multiplayer quiz server lives on a separate Node/Railway host.
export function attachGameWebSocket(): void {
  // no-op in this bundle
}
