/**
 * Multiplayer quiz REST routes.
 *
 * Auth-guarded. Flow:
 *   1. Host:  POST /api/game/rooms            { source, topic?, flashcardIds? } → { code, roomId }
 *   2. Host:  POST /api/game/rooms/:code/start → snapshots questions, returns nothing
 *   3. Anyone: POST /api/game/auth-ticket      { roomCode } → { ticket }   (then open WS)
 *   4. Anyone: GET  /api/game/rooms/:code      → lobby/state summary
 *
 * The actual live play (questions, answers, chat, scoring, finish) happens
 * over /ws (see routes/ws.ts + lib/gameManager.ts).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/session';
import { requirePro } from '../lib/tier';
import { gameManager } from '../lib/gameManager';

export const gameRouter = new Hono();

// Issue a short-lived WS auth ticket. Must be authed + room must exist and
// not be finished. Anyone with the code can join (the GamePlayer DB row is
// created at game-end via ensurePlayer, so we don't require membership here).
gameRouter.post('/auth-ticket', requireAuth, zValidator('json', z.object({
  roomCode: z.string().min(1),
})), async c => {
  const user = c.get('user');
  const { roomCode } = await c.req.json();
  const room = await prisma.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
  if (!room) return c.json({ error: 'room not found' }, 404);
  if (room.status === 'finished') return c.json({ error: 'game already finished' }, 410);
  const ticket = gameManager.issueTicket(user.id, user.name ?? user.email.split('@')[0]);
  return c.json({ ticket, wsUrl: `/ws?room=${room.code}&ticket=${ticket}` });
});

// Create a room. Host's flashcards (or a topic for AI questions later) seed it.
gameRouter.post('/rooms', requireAuth, requirePro, zValidator('json', z.object({
  source: z.enum(['flashcards', 'topic']).default('flashcards'),
  topic: z.string().max(120).optional(),
  flashcardIds: z.array(z.string()).optional(),
  perQuestionSec: z.number().int().min(5).max(60).default(15),
  baseXp: z.number().int().min(1).max(100).default(10),
})), async c => {
  const user = c.get('user');
  const body = await c.req.json();

  // Build the question list from source.
  let questions: { prompt: string; options: string[]; answerIdx: number }[] = [];
  if (body.source === 'flashcards') {
    const where = body.flashcardIds?.length
      ? { id: { in: body.flashcardIds }, userId: user.id }
      : { userId: user.id };
    const cards = await prisma.flashcard.findMany({ where, take: 30 });
    if (cards.length < 3) return c.json({ error: 'Need at least 3 flashcards to host a game' }, 400);
    // Pool of plausible wrong answers = other cards' answers.
    const answerPool = cards.map(c => c.answer).filter((v, i, a) => a.indexOf(v) === i);
    questions = cards.map(card => {
      const wrong = answerPool.filter(a => a !== card.answer);
      // pick up to 3 distractors
      const distractors: string[] = [];
      const shuffled = [...wrong].sort(() => Math.random() - 0.5);
      for (const w of shuffled) { if (distractors.length >= 3) break; if (!distractors.includes(w)) distractors.push(w); }
      while (distractors.length < 3) distractors.push(`Option ${distractors.length + 2}`);
      const opts = [card.answer, ...distractors];
      for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      return { prompt: card.question, options: opts, answerIdx: opts.indexOf(card.answer) };
    });
  } else {
    // Topic source requires AI; for now return an actionable error pointing
    // at AI setup. (AI question generation can be layered on later.)
    return c.json({ error: 'Topic-based games need an AI key configured. Use your flashcards for now.' }, 400);
  }

  const room = await prisma.gameRoom.create({
    data: {
      hostId: user.id,
      code: crypto.randomUUID().slice(0, 8).toUpperCase(),
      source: body.source,
      topic: body.topic,
      status: 'lobby',
      settings: { perQuestionSec: body.perQuestionSec, baseXp: body.baseXp },
    },
  });

  // Snapshot questions into the DB so the round is self-contained.
  const created = await prisma.$transaction(
    questions.map((q, i) => prisma.gameQuestion.create({
      data: { roomId: room.id, prompt: q.prompt, options: q.options, answerIdx: q.answerIdx, order: i },
    }))
  );
  await prisma.gameRoom.update({ where: { id: room.id }, data: { questionIds: created.map(q => q.id) } });

  // Host is automatically a player.
  await prisma.gamePlayer.create({ data: { roomId: room.id, userId: user.id, name: user.name ?? user.email.split('@')[0] } });

  // Register the live room in the manager.
  gameManager.registerRoom(room.code, user.id, 'lobby', room.id);
  gameManager.loadQuestions(room.code, created, body.perQuestionSec, body.baseXp);

  return c.json({ code: room.code, roomId: room.id, questionCount: created.length });
});

// Start the round (host only). Moves lobby -> live.
gameRouter.post('/rooms/:code/start', requireAuth, async c => {
  const user = c.get('user');
  const code = c.req.param('code')?.toUpperCase() ?? '';
  const room = await prisma.gameRoom.findUnique({ where: { code } });
  if (!room) return c.json({ error: 'room not found' }, 404);
  if (room.hostId !== user.id) return c.json({ error: 'only the host can start' }, 403);
  const playerCount = await prisma.gamePlayer.count({ where: { roomId: room.id } });
  if (playerCount < 1) return c.json({ error: 'no players joined yet' }, 400);

  const questions = await prisma.gameQuestion.findMany({ where: { roomId: room.id } });
  const settings = (room.settings as any) ?? { perQuestionSec: 15, baseXp: 10 };
  // NOTE: do NOT call registerRoom here — it would wipe the in-memory room's
  // connected players. The room already exists (created at room creation or on
  // first WS connect). Just (re)load questions and start.
  gameManager.loadQuestions(room.code, questions, settings.perQuestionSec, settings.baseXp);
  await prisma.gameRoom.update({ where: { id: room.id }, data: { status: 'live' } });
  gameManager.startQuiz(room.code);
  return c.json({ ok: true });
});

// Lobby / state summary (who's in, question count, status).
gameRouter.get('/rooms/:code', requireAuth, async c => {
  const code = c.req.param('code')?.toUpperCase() ?? '';
  const room = await prisma.gameRoom.findUnique({
    where: { code },
    include: { players: true, host: { select: { id: true, name: true } } },
  });
  if (!room) return c.json({ error: 'room not found' }, 404);
  const live = gameManager.getRoom(code);
  return c.json({
    code: room.code,
    status: room.status,
    source: room.source,
    topic: room.topic,
    questionCount: room.questionIds.length,
    host: room.host,
    players: room.players.map(p => ({ userId: p.userId, name: p.name, xp: p.xp })),
    live: live ? { connectedPlayers: live.players.size } : null,
  });
});

// List the calling user's active (lobby/live) rooms.
gameRouter.get('/rooms', requireAuth, async c => {
  const user = c.get('user');
  const rooms = await prisma.gameRoom.findMany({
    where: { OR: [{ hostId: user.id }, { players: { some: { userId: user.id } } }], status: { not: 'finished' } },
    include: { host: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return c.json(rooms.map(r => ({ code: r.code, status: r.status, source: r.source, host: r.host.name, questionCount: r.questionIds.length })));
});
