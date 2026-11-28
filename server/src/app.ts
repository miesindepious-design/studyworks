import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { TRUSTED_ORIGINS } from './lib/origins.js';

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
import { lobbyRouter } from './routes/lobby.js';
import { roomFilesRouter } from './routes/roomFiles.js';
import { adminRouter } from './routes/admin.js';
import { progressionRouter } from './routes/progression.js';
import { duelsRouter } from './routes/duels.js';
import { examsRouter } from './routes/exams.js';
import { gradesRouter } from './routes/grades.js';
import { citationsRouter } from './routes/citations.js';
import { collabRouter } from './routes/collab.js';
import { digestRouter } from './routes/digest.js';

export const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  // One list, shared with Better Auth's trustedOrigins — see lib/origins.ts.
  // When the two lists drifted, the desktop app's sign-in broke in two
  // different ways depending on which gate rejected it first.
  origin:      TRUSTED_ORIGINS,
  credentials: true,
  allowHeaders:  ['Content-Type', 'Authorization'],
  allowMethods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Health check ──────────────────────────────────────────────────────────────
// Registered at both /health (direct hosting) and /api/health (Vercel, whose
// rewrites only forward /api/* and /auth/* here).
app.get('/health',    c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

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

// Phase 4: lobby — the shareable front door to a live session
app.route('/api/lobby',   lobbyRouter);
// Phase 6: the group's shared study files, dropped into that lobby
app.route('/api/lobby',   roomFilesRouter);

// Phase 5: progression (XP, quests, achievements, season), duels and exams
app.route('/api/progression', progressionRouter);
app.route('/api/duels',       duelsRouter);
app.route('/api/exams',       examsRouter);
app.route('/api/grades',      gradesRouter);
app.route('/api/citations',   citationsRouter);
app.route('/api/collab',      collabRouter);
app.route('/api/digest',     digestRouter);

// Admin
app.route('/api/admin', adminRouter);

// ── Desktop app auto-updater manifest ────────────────────────────────────────
// Served from the API so it works even with a private GitHub repo.
// The updater in tauri.conf.json points here.
app.get('/api/releases/latest', c => {
  return c.json({
    version: '0.2.1',
    notes: 'Desktop sign-in fixes: the Windows desktop origin is now trusted by the API, Google sign-in opens in the system browser, and the updater has a working signing key so future versions install automatically.',
    pub_date: '2026-11-28T17:31:44.000Z',
    platforms: {
      'windows-x86_64': {
        signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRdTU5SG1nUTkrLzh6QWY2YlRpQjRNMGdjdG9HN1VXZUtQeGtrLzdvQUpiT25DWnkzUGMrd0tkVjJHaHBYQVBxemdWNFFLYld1MGNxU3F6SzFuV0JZQ0VDWHljU2JwNEFZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1ODcwNDk4CWZpbGU6U3R1ZHlXb3Jrc18wLjIuMV94NjQtc2V0dXAuZXhlCXZlcnNpb246MC4yLjEKR0xPS0F5SzlpMC9FTkZTSjE0d01LeUZGK1NvWEc2VmxMbVhLWmpZZnVPTmRENm43dHBUdzVsN0tkMC9pSUxLcERsdEhEWEtrNGRYeVhvc1RxbzJQRFE9PQo=',
        url: 'https://github.com/miesindepious-design/studyworks/releases/download/v0.2.1/StudyWorks_0.2.1_x64-setup.exe',
      },
    },
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof app;
