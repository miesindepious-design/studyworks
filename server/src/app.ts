import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { contactsRouter } from './routes/contacts.js';
import { flashcardsRouter } from './routes/flashcards.js';
import { foldersRouter } from './routes/folders.js';
import { practiceRouter } from './routes/practice.js';
import { searchRouter } from './routes/search.js';
import { syncRouter } from './routes/sync.js';
import { stripeRouter } from './routes/stripe.js';
import { aiRouter } from './routes/ai.js';
import { attachmentsRouter } from './routes/attachments.js';
import { streakRouter } from './routes/streak.js';
import { unfurlRouter } from './routes/unfurl.js';
import { sharesRouter } from './routes/shares.js';
import { supportRouter } from './routes/support.js';
import { emailSaveRouter, inboundEmailRouter } from './routes/emailSave.js';
import { gameRouter } from './routes/game.js';
import { studyRoomRouter } from './routes/studyRoom.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin:      [FRONTEND_URL],
  credentials: true,
  allowHeaders:  ['Content-Type', 'Authorization'],
  allowMethods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.route('/auth',      authRouter);
app.route('/api/notes',     notesRouter);
app.route('/api/contacts',  contactsRouter);
app.route('/api/flashcards',flashcardsRouter);
app.route('/api/folders',   foldersRouter);
app.route('/api/practice',  practiceRouter);
app.route('/api/search',    searchRouter);
app.route('/api/sync',      syncRouter);
app.route('/api/stripe',    stripeRouter);
app.route('/api/ai',        aiRouter);
app.route('/api/attachments', attachmentsRouter);

// Phase 2
app.route('/api/streak',       streakRouter);
app.route('/api/unfurl',       unfurlRouter);
app.route('/api/shares',       sharesRouter);
app.route('/api/support',      supportRouter);
app.route('/api/email-save',   emailSaveRouter);
app.route('/api/inbound-email', inboundEmailRouter);

// Phase 3: multiplayer quiz
app.route('/api/game',    gameRouter);
app.route('/api/study-room', studyRoomRouter);

// ── 404 ────────────────────────────────────────────────────────────────────────
app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof app;
