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
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { gameManager } from '../lib/gameManager.js';
import { createLobbyForSession } from '../lib/lobby.js';
import { SYSTEM_BASE, loadAIConfig, callProvider } from '../lib/aiProvider.js';
import { generateQuestionsFromDocuments, loadLobbyDocuments, parseQuestions } from '../lib/questionGen.js';
import { copyLobbyFiles } from '../lib/roomFiles.js';
import { studentProfileBits, studentPromptContext } from '../lib/studentProfile.js';
import { eloRound } from '../lib/progressionRules.js';

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

// Create a room. Host's flashcards (or a topic, or the files the group
// shared in the lobby) seed it.
gameRouter.post('/rooms', requireAuth, requirePro, zValidator('json', z.object({
  source: z.enum(['flashcards', 'topic', 'files']).default('flashcards'),
  topic: z.string().max(120).optional(),
  flashcardIds: z.array(z.string()).optional(),
  // 'files' source: the lobby the group shares material in, and optionally
  // the subset of files to build the round from.
  lobbyCode: z.string().max(16).optional(),
  fileIds: z.array(z.string()).optional(),
  questionCount: z.number().int().min(3).max(20).optional(),
  perQuestionSec: z.number().int().min(5).max(60).default(15),
  baseXp: z.number().int().min(1).max(100).default(10),
})), async c => {
  const user = c.get('user');
  const body = await c.req.valid('json');

  // Build the question list from source.
  let questions: { prompt: string; options: string[]; answerIdx: number }[] = [];
  let topicLabel: string | undefined = body.topic;
  // The lobby the material came from — its files are copied into the new
  // room's lobby so the material travels with the game.
  let sourceLobbyId: string | null = null;
  let sourceFileIds: string[] | undefined = body.fileIds;
  if (body.source === 'flashcards') {
    const where = body.flashcardIds?.length
      ? { id: { in: body.flashcardIds }, userId: user.id }
      : { userId: user.id };
    const cards = await prisma.flashcard.findMany({ where, take: 60 });
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
  } else if (body.source === 'topic') {
    // Topic source: generate level-aware multiple-choice questions with AI.
    if (!body.topic || !String(body.topic).trim()) {
      return c.json({ error: 'A topic is required for AI questions.' }, 400);
    }
    const topic = String(body.topic).trim();
    try {
      const cfg = await loadAIConfig(user.id);
      const profileBits = studentProfileBits(user);
      const audience = profileBits.length > 0 ? profileBits.join(', ') : 'a general student';
      const studentCtx = studentPromptContext(profileBits);
      // As many questions as one generation can reasonably produce.
      const questionCount = 20;
      const raw = await callProvider({
        provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
        messages: [
          { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
          {
            role: 'user',
            content: `Generate ${questionCount} multiple-choice quiz questions on the topic "${topic}" for ${audience}.
Rules:
- Each question has exactly 4 options and exactly one correct answer.
- Cover the full breadth of the topic: definitions, application, reasoning and exam-style traps.
- Difficulty should match what is actually taught at the student's level.
- Distractors must be plausible but clearly wrong on careful reading.
Return JSON: { "questions": [ { "prompt": "...", "options": ["...","...","...","..."], "answerIdx": 0 } ] } where answerIdx is the 0-based index of the correct option.`,
          },
        ],
        temperature: 0.6, maxTokens: 8192, jsonMode: true, thinking: 'low',
      });
      questions = parseQuestions(raw).slice(0, questionCount);
      if (questions.length < 3) {
        return c.json({ error: 'The AI generated too few valid questions — try again or host from your flashcards.' }, 502);
      }
    } catch (e) {
      return c.json({ error: `AI question generation failed: ${(e as Error).message}` }, 502);
    }
  } else {
    // Files source: the group shared material in a lobby — build the round
    // from those files. This is the "let's battle over this chapter" path.
    if (!body.lobbyCode) {
      return c.json({ error: 'A lobby with shared files is required for a file-based game.' }, 400);
    }
    try {
      const { documents, label, lobbyId } = await loadLobbyDocuments(body.lobbyCode, body.fileIds);
      if (documents.length === 0) {
        return c.json({ error: 'No readable files in that lobby yet — add a file with text first.' }, 400);
      }
      topicLabel = label;
      sourceLobbyId = lobbyId;
      questions = await generateQuestionsFromDocuments({
        userId: user.id,
        user,
        documents,
        count: body.questionCount ?? 15,
        topicLabel: label,
      });
      if (questions.length < 3) {
        return c.json({ error: 'The AI could not build a round from those files — try adding more material.' }, 502);
      }
    } catch (e) {
      return c.json({ error: `Could not build questions from the shared files: ${(e as Error).message}` }, 502);
    }
  }

  const room = await prisma.gameRoom.create({
    data: {
      hostId: user.id,
      code: crypto.randomUUID().slice(0, 8).toUpperCase(),
      source: body.source,
      topic: topicLabel,
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

  // Every room gets a lobby: the six-digit code, share link and QR code that
  // let a friend land straight in this game. If the lobby can't be minted we
  // still return the room — the game itself is unaffected.
  let lobbyCode: string | null = null;
  try {
    const lobby = await createLobbyForSession({
      hostId: user.id,
      kind: 'quiz',
      title: topicLabel ? `Quiz: ${topicLabel}` : 'Quiz Battle',
      targetCode: room.code,
      maxParticipants: 12,
    });
    lobbyCode = lobby.code;

    // The material the group shared travels with the battle: copy the files
    // into the room's own lobby so the waiting room still shows what this
    // quiz is about.
    if (sourceLobbyId) {
      const copied = await copyLobbyFiles({
        fromLobbyId: sourceLobbyId,
        toLobbyId: lobby.id,
        fileIds: sourceFileIds,
        uploaderId: user.id,
      });
      if (copied > 0) console.log(`[game] copied ${copied} shared file(s) into lobby ${lobby.code}`);
    }
  } catch (err) {
    console.error('[game] failed to create lobby for room', room.code, err);
  }

  return c.json({ code: room.code, roomId: room.id, questionCount: created.length, lobbyCode });
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

/**
 * Report the outcome of a finished battle.
 *
 * The WebSocket host may be a separate deployment, so the client posts the
 * final scores here. This is where the match is recorded, the ELO ratings are
 * moved and the winner's XP is booked.
 */
gameRouter.post('/results', requireAuth, zValidator('json', z.object({
  roomCode: z.string().min(1),
  players: z.array(z.object({
    userId: z.string().min(1),
    name: z.string().min(1),
    score: z.number().int().min(0),
  })).min(1).max(12),
  // How many double-points power-ups each player spent, so the bonus is
  // applied to the score that gets recorded.
  powerUps: z.record(z.string(), z.number().int().min(0)).default({}),
})), async c => {
  const user = c.get('user');
  const body = await c.req.valid('json');
  const code = body.roomCode.toUpperCase();

  const room = await prisma.gameRoom.findUnique({
    where: { code },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  if (!room) return c.json({ error: 'room not found' }, 404);

  const players = body.players.map(p => ({
    ...p,
    score: p.score + (body.powerUps[p.userId] ?? 0) * 10,
  }));

  // ── ELO ────────────────────────────────────────────────────────────────────
  const ratings = await prisma.gameRating.findMany({
    where: { userId: { in: players.map(p => p.userId) } },
  });
  const ratingOf = new Map(ratings.map(r => [r.userId, r.rating]));
  const before = new Map<string, number>();
  const eloInput = players.map(p => {
    const r = ratingOf.get(p.userId) ?? 1200;
    before.set(p.userId, r);
    return { id: p.userId, rating: r, score: p.score };
  });
  const updates = eloRound(eloInput);

  for (const p of players) {
    const upd = updates[p.userId];
    if (!upd) continue;
    const existing = ratings.find(r => r.userId === p.userId);
    const won = players.filter(o => o.userId !== p.userId).every(o => p.score >= o.score);
    await prisma.gameRating.upsert({
      where: { userId: p.userId },
      create: {
        userId: p.userId,
        rating: upd.rating,
        peakRating: Math.max(1200, upd.rating),
        games: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
      },
      update: {
        rating: upd.rating,
        peakRating: Math.max(existing?.peakRating ?? 1200, upd.rating),
        games: { increment: 1 },
        wins: { increment: won ? 1 : 0 },
        losses: { increment: won ? 0 : 1 },
      },
    });
  }

  // ── Record the match ───────────────────────────────────────────────────────
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const winnerIsChallenger = winner.userId === user.id;

  const match = await prisma.gameMatch.create({
    data: {
      code: `M${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      mode: 'live',
      source: room.source,
      topic: room.topic,
      challengerId: sorted[1]?.userId ?? winner.userId,
      challengerName: sorted[1]?.name ?? winner.name,
      opponentId: winner.userId,
      opponentName: winner.name,
      status: 'completed',
      questions: room.questions.map(q => ({ prompt: q.prompt, options: q.options, answerIdx: q.answerIdx })),
      challengerScore: sorted[1]?.score ?? winner.score,
      opponentScore: winner.score,
      winnerId: winner.userId,
      ratingBefore: before.get(sorted[1]?.userId ?? winner.userId) ?? 1200,
      ratingAfter: updates[sorted[1]?.userId ?? winner.userId]?.rating ?? 1200,
      opponentRatingBefore: before.get(winner.userId) ?? 1200,
      opponentRatingAfter: updates[winner.userId]?.rating ?? 1200,
      completedAt: new Date(),
    },
  });

  return c.json({
    ok: true,
    matchId: match.id,
    winnerId: winner.userId,
    winnerName: winner.name,
    iWon: winnerIsChallenger,
    ratings: players.map(p => ({
      userId: p.userId,
      name: p.name,
      score: p.score,
      ratingBefore: before.get(p.userId) ?? 1200,
      ratingAfter: updates[p.userId]?.rating ?? 1200,
      delta: updates[p.userId]?.delta ?? 0,
    })),
  });
});

/** ELO leaderboard — the competitive table of the whole school. */
gameRouter.get('/leaderboard', requireAuth, async c => {
  const user = c.get('user');
  const take = Math.min(100, Math.max(1, Number(c.req.query('take') ?? 50)));
  const rows = await prisma.gameRating.findMany({
    orderBy: { rating: 'desc' },
    take,
    include: { user: { select: { id: true, name: true, image: true } } },
  });
  const me = await prisma.gameRating.findUnique({
    where: { userId: user.id },
    include: { user: { select: { id: true, name: true, image: true } } },
  });
  const shape = (r: typeof rows[number] | typeof me) => {
    if (!r) return null;
    return {
      userId: r.user.id,
      name: r.user.name ?? 'Student',
      image: r.user.image,
      rating: r.rating,
      peakRating: r.peakRating,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      isMe: r.user.id === user.id,
    };
  };
  return c.json({ rows: rows.map(shape), me: shape(me) });
});

/**
 * Rematch: spin up a new room with exactly the same questions.
 *
 * The old room keeps its history; the new one is a fresh live round, so the
 * "one more?" button at the end of a battle actually works.
 */
gameRouter.post('/rematch', requireAuth, requirePro, zValidator('json', z.object({
  roomCode: z.string().min(1),
})), async c => {
  const user = c.get('user');
  const code = c.req.valid('json').roomCode.toUpperCase();

  const old = await prisma.gameRoom.findUnique({
    where: { code },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  if (!old) return c.json({ error: 'room not found' }, 404);
  if (old.questions.length < 3) return c.json({ error: 'not enough questions to replay' }, 400);

  const settings = (old.settings as any) ?? { perQuestionSec: 15, baseXp: 10 };

  const room = await prisma.gameRoom.create({
    data: {
      hostId: user.id,
      code: crypto.randomUUID().slice(0, 8).toUpperCase(),
      source: old.source,
      topic: old.topic,
      status: 'lobby',
      settings: { perQuestionSec: settings.perQuestionSec ?? 15, baseXp: settings.baseXp ?? 10 },
    },
  });

  const created = await prisma.$transaction(
    old.questions.map((q, i) => prisma.gameQuestion.create({
      data: { roomId: room.id, prompt: q.prompt, options: q.options, answerIdx: q.answerIdx, order: i },
    }))
  );
  await prisma.gameRoom.update({ where: { id: room.id }, data: { questionIds: created.map(q => q.id) } });
  await prisma.gamePlayer.create({ data: { roomId: room.id, userId: user.id, name: user.name ?? user.email.split('@')[0] } });

  gameManager.registerRoom(room.code, user.id, 'lobby', room.id);
  gameManager.loadQuestions(room.code, created, settings.perQuestionSec ?? 15, settings.baseXp ?? 10);

  let lobbyCode: string | null = null;
  try {
    const lobby = await createLobbyForSession({
      hostId: user.id,
      kind: 'quiz',
      title: old.topic ? `Rematch: ${old.topic}` : 'Rematch',
      targetCode: room.code,
      maxParticipants: 12,
    });
    lobbyCode = lobby.code;
  } catch (err) {
    console.error('[game] failed to create lobby for rematch', room.code, err);
  }

  return c.json({ code: room.code, roomId: room.id, questionCount: created.length, lobbyCode });
});
