/**
 * /api/duels — asynchronous quiz challenges.
 *
 * A duel is a quiz you can send to a friend who is not online right now. The
 * challenger picks a set of questions, plays them, and shares the code; the
 * opponent answers the same questions whenever they open the link. When both
 * sides have played, the duel is scored and the ELO ratings move.
 *
 *   POST /api/duels            → create a duel (and its questions)
 *   GET  /api/duels/mine       → my duels, in progress and finished
 *   GET  /api/duels/:code      → a duel (answers hidden until it is scored)
 *   POST /api/duels/:code/answer → play your side of the duel
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { eloRound } from '../lib/progressionRules.js';
import { generateQuestionsFromDocuments, loadLobbyDocuments } from '../lib/questionGen.js';

export const duelsRouter = new Hono();
duelsRouter.use('*', requireAuth);

const DUEL_TTL_DAYS = 7;

interface DuelQuestion {
  prompt: string;
  options: string[];
  answerIdx: number;
}

/** Strip the correct answer so a player cannot read it off the payload. */
function publicQuestions(questions: DuelQuestion[], reveal: boolean) {
  return questions.map(q => (reveal ? q : { prompt: q.prompt, options: q.options }));
}

duelsRouter.post('/', requirePro, zValidator('json', z.object({
  source: z.enum(['flashcards', 'topic', 'files']).default('flashcards'),
  topic: z.string().max(120).optional(),
  flashcardIds: z.array(z.string()).optional(),
  // 'files' source: the lobby the group shares material in, and optionally
  // the subset of files to build the duel from.
  lobbyCode: z.string().max(16).optional(),
  fileIds: z.array(z.string()).optional(),
  questionCount: z.number().int().min(3).max(20).default(5),
})), async c => {
  const user = c.get('user');
  const body = await c.req.valid('json');

  let questions: DuelQuestion[] = [];
  let topicLabel: string | undefined = body.topic;

  if (body.source === 'flashcards') {
    const where = body.flashcardIds?.length
      ? { id: { in: body.flashcardIds }, userId: user.id }
      : { userId: user.id };
    const cards = await prisma.flashcard.findMany({ where, take: 60 });
    if (cards.length < 3) return c.json({ error: 'Need at least 3 flashcards to build a duel' }, 400);

    const answerPool = [...new Set(cards.map(c => c.answer))];
    questions = cards.slice(0, body.questionCount).map(card => {
      const wrong = answerPool.filter(a => a !== card.answer);
      const distractors: string[] = [];
      for (const w of [...wrong].sort(() => Math.random() - 0.5)) {
        if (distractors.length >= 3) break;
        if (!distractors.includes(w)) distractors.push(w);
      }
      while (distractors.length < 3) distractors.push(`Option ${distractors.length + 2}`);
      const opts = [card.answer, ...distractors];
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      return { prompt: card.question, options: opts, answerIdx: opts.indexOf(card.answer) };
    });
  } else if (body.source === 'topic') {
    // A topic duel reuses the quiz questions the student already has on that
    // topic, so a duel never needs an AI key.
    const topic = String(body.topic ?? '').trim();
    if (!topic) return c.json({ error: 'A topic is required' }, 400);
    const cards = await prisma.flashcard.findMany({
      where: { userId: user.id, topic: { equals: topic, mode: 'insensitive' } },
      take: 20,
    });
    if (cards.length < 3) {
      return c.json({ error: `You need at least 3 flashcards tagged with the topic "${topic}" first` }, 400);
    }
    const answerPool = [...new Set(cards.map(c => c.answer))];
    questions = cards.slice(0, body.questionCount).map(card => {
      const wrong = answerPool.filter(a => a !== card.answer);
      const distractors: string[] = [];
      for (const w of [...wrong].sort(() => Math.random() - 0.5)) {
        if (distractors.length >= 3) break;
        if (!distractors.includes(w)) distractors.push(w);
      }
      while (distractors.length < 3) distractors.push(`Option ${distractors.length + 2}`);
      const opts = [card.answer, ...distractors];
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      return { prompt: card.question, options: opts, answerIdx: opts.indexOf(card.answer) };
    });
  } else {
    // Files source: the duel is built from the material the group shared in
    // the lobby — the same files a live quiz battle would use.
    if (!body.lobbyCode) {
      return c.json({ error: 'A lobby with shared files is required for a file-based duel.' }, 400);
    }
    try {
      const { documents, label } = await loadLobbyDocuments(body.lobbyCode, body.fileIds);
      if (documents.length === 0) {
        return c.json({ error: 'No readable files in that lobby yet — add a file with text first.' }, 400);
      }
      topicLabel = label;
      questions = await generateQuestionsFromDocuments({
        userId: user.id,
        user,
        documents,
        count: body.questionCount,
        topicLabel: label,
      });
    } catch (e) {
      return c.json({ error: `Could not build a duel from the shared files: ${(e as Error).message}` }, 502);
    }
  }

  if (questions.length < 3) return c.json({ error: 'Not enough questions for a duel' }, 400);

  const code = `D${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const duel = await prisma.gameMatch.create({
    data: {
      code,
      mode: 'async',
      source: body.source,
      topic: topicLabel,
      challengerId: user.id,
      challengerName: user.name ?? user.email.split('@')[0],
      status: 'open',
      questions: questions as object,
      expiresAt: new Date(Date.now() + DUEL_TTL_DAYS * 86400000),
    },
  });

  return c.json({
    code: duel.code,
    questionCount: questions.length,
    expiresAt: duel.expiresAt,
  });
});

// My duels — newest first.
duelsRouter.get('/mine', async c => {
  const user = c.get('user');
  const duels = await prisma.gameMatch.findMany({
    where: { mode: 'async', OR: [{ challengerId: user.id }, { opponentId: user.id }] },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  return c.json(duels.map(d => ({
    code: d.code,
    status: d.status,
    source: d.source,
    topic: d.topic,
    challengerName: d.challengerName,
    opponentName: d.opponentName,
    challengerScore: d.challengerScore,
    opponentScore: d.opponentScore,
    winnerId: d.winnerId,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    iAmChallenger: d.challengerId === user.id,
    myScore: d.challengerId === user.id ? d.challengerScore : d.opponentScore,
    played: d.challengerId === user.id ? d.challengerScore != null : d.opponentScore != null,
  })));
});

// One duel.
duelsRouter.get('/:code', async c => {
  const user = c.get('user');
  const code = c.req.param('code')?.toUpperCase() ?? '';
  const duel = await prisma.gameMatch.findUnique({ where: { code } });
  if (!duel) return c.json({ error: 'duel not found' }, 404);
  if (duel.expiresAt && duel.expiresAt.getTime() < Date.now() && duel.status === 'open') {
    return c.json({ error: 'This duel has expired' }, 410);
  }

  const questions = (duel.questions as unknown as DuelQuestion[]) ?? [];
  const isChallenger = duel.challengerId === user.id;
  const iPlayed = isChallenger ? duel.challengerScore != null : duel.opponentScore != null;
  const reveal = duel.status === 'completed';

  return c.json({
    code: duel.code,
    status: duel.status,
    source: duel.source,
    topic: duel.topic,
    challengerId: duel.challengerId,
    challengerName: duel.challengerName,
    opponentId: duel.opponentId,
    opponentName: duel.opponentName,
    challengerScore: duel.challengerScore,
    opponentScore: duel.opponentScore,
    winnerId: duel.winnerId,
    questions: publicQuestions(questions, reveal),
    questionCount: questions.length,
    iAmChallenger: isChallenger,
    iPlayed,
    awaitingOpponent: duel.status === 'open' && isChallenger && duel.challengerScore != null,
    expiresAt: duel.expiresAt,
    createdAt: duel.createdAt,
  });
});

// Play your side of the duel.
duelsRouter.post('/:code/answer', zValidator('json', z.object({
  answers: z.array(z.number().int().min(-1)).min(1).max(20),
})), async c => {
  const user = c.get('user');
  const code = c.req.param('code')?.toUpperCase() ?? '';
  const { answers } = c.req.valid('json');

  const duel = await prisma.gameMatch.findUnique({ where: { code } });
  if (!duel) return c.json({ error: 'duel not found' }, 404);
  if (duel.status === 'completed') return c.json({ error: 'This duel is already finished' }, 409);
  if (duel.expiresAt && duel.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'This duel has expired' }, 410);
  }

  const isChallenger = duel.challengerId === user.id;
  const alreadyPlayed = isChallenger ? duel.challengerScore != null : duel.opponentScore != null;
  if (alreadyPlayed) return c.json({ error: 'You have already played this duel' }, 409);

  const questions = (duel.questions as unknown as DuelQuestion[]) ?? [];
  let correct = 0;
  answers.forEach((choice, i) => {
    if (questions[i] && choice >= 0 && choice === questions[i].answerIdx) correct++;
  });
  const score = correct;

  const data: Record<string, unknown> = isChallenger
    ? { challengerScore: score }
    : { opponentId: user.id, opponentName: user.name ?? user.email.split('@')[0], opponentScore: score };
  await prisma.gameMatch.update({ where: { id: duel.id }, data: data as any });

  const refreshed = await prisma.gameMatch.findUnique({ where: { id: duel.id } });
  const bothPlayed = refreshed!.challengerScore != null && refreshed!.opponentScore != null;

  if (!bothPlayed) {
    return c.json({ ok: true, score, correct, awaitingOpponent: true, completed: false });
  }

  // ── Score the duel and move the ratings ────────────────────────────────────
  const challengerScore = refreshed!.challengerScore!;
  const opponentScore = refreshed!.opponentScore!;
  const winnerId = challengerScore > opponentScore
    ? refreshed!.challengerId
    : opponentScore > challengerScore
      ? refreshed!.opponentId
      : null;

  const [a, b] = await Promise.all([
    prisma.gameRating.findUnique({ where: { userId: refreshed!.challengerId } }),
    prisma.gameRating.findUnique({ where: { userId: refreshed!.opponentId! } }),
  ]);
  const ratingA = a?.rating ?? 1200;
  const ratingB = b?.rating ?? 1200;
  const updates = eloRound([
    { id: refreshed!.challengerId, rating: ratingA, score: challengerScore },
    { id: refreshed!.opponentId!, rating: ratingB, score: opponentScore },
  ]);

  await prisma.$transaction([
    prisma.gameMatch.update({
      where: { id: refreshed!.id },
      data: {
        status: 'completed',
        winnerId,
        completedAt: new Date(),
        ratingBefore: ratingA,
        ratingAfter: updates[refreshed!.challengerId]?.rating ?? ratingA,
        opponentRatingBefore: ratingB,
        opponentRatingAfter: updates[refreshed!.opponentId!]?.rating ?? ratingB,
      },
    }),
    prisma.gameRating.upsert({
      where: { userId: refreshed!.challengerId },
      create: {
        userId: refreshed!.challengerId,
        rating: updates[refreshed!.challengerId]?.rating ?? ratingA,
        peakRating: Math.max(1200, updates[refreshed!.challengerId]?.rating ?? ratingA),
        games: 1,
        wins: challengerScore > opponentScore ? 1 : 0,
        losses: challengerScore < opponentScore ? 1 : 0,
        draws: challengerScore === opponentScore ? 1 : 0,
      },
      update: {
        rating: updates[refreshed!.challengerId]?.rating ?? ratingA,
        peakRating: { set: Math.max(a?.peakRating ?? 1200, updates[refreshed!.challengerId]?.rating ?? ratingA) },
        games: { increment: 1 },
        wins: { increment: challengerScore > opponentScore ? 1 : 0 },
        losses: { increment: challengerScore < opponentScore ? 1 : 0 },
        draws: { increment: challengerScore === opponentScore ? 1 : 0 },
      },
    }),
    prisma.gameRating.upsert({
      where: { userId: refreshed!.opponentId! },
      create: {
        userId: refreshed!.opponentId!,
        rating: updates[refreshed!.opponentId!]?.rating ?? ratingB,
        peakRating: Math.max(1200, updates[refreshed!.opponentId!]?.rating ?? ratingB),
        games: 1,
        wins: opponentScore > challengerScore ? 1 : 0,
        losses: opponentScore < challengerScore ? 1 : 0,
        draws: challengerScore === opponentScore ? 1 : 0,
      },
      update: {
        rating: updates[refreshed!.opponentId!]?.rating ?? ratingB,
        peakRating: { set: Math.max(b?.peakRating ?? 1200, updates[refreshed!.opponentId!]?.rating ?? ratingB) },
        games: { increment: 1 },
        wins: { increment: opponentScore > challengerScore ? 1 : 0 },
        losses: { increment: opponentScore < challengerScore ? 1 : 0 },
        draws: { increment: challengerScore === opponentScore ? 1 : 0 },
      },
    }),
  ]);

  return c.json({
    ok: true,
    score,
    correct,
    completed: true,
    winnerId,
    iWon: winnerId === user.id,
    isDraw: winnerId === null,
    challengerScore,
    opponentScore,
    myRating: updates[user.id]?.rating ?? 1200,
    myDelta: updates[user.id]?.delta ?? 0,
  });
});
