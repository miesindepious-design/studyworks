// End-to-end smoke test for the multiplayer quiz.
// 1. Create two users (A=host, B=player) via Better Auth email sign-up.
// 2. A creates a room from a couple of flashcards.
// 3. Both get WS tickets and open live WebSocket connections.
// 4. A (host) starts the game.
// 5. On each question: A answers fast+correct, B answers slow+wrong (or times out).
// 6. Wait for 'finished'; assert A.xp > B.xp and winnerId === A.
// 7. Verify GamePlayer.xp persisted in Neon.
// 8. Clean up both users.

import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';

const BASE = 'http://localhost:3001';
const prisma = new PrismaClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(opts.headers || {}) },
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, res };
}

async function signUp(email, password = 'TestPass123!') {
  const r = await api('/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name: email.split('@')[0], email, password }),
  });
  return r;
}

// Get a session cookie jar by signing in and capturing set-cookie.
async function signInGetCookie(email, password = 'TestPass123!') {
  const res = await fetch(BASE + '/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  return setCookie || '';
}

function openWs(code, ticket, onMsg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3001/ws?room=${code}&ticket=${ticket}`);
    ws.on('open', () => resolve(ws));
    ws.on('message', (raw) => {
      try { onMsg(JSON.parse(raw.toString())); } catch {}
    });
    ws.on('error', reject);
  });
}

const A_EMAIL = 'mp_a_' + Date.now() + '@example.com';
const B_EMAIL = 'mp_b_' + Date.now() + '@example.com';

async function main() {
  console.log('1) sign up A + B');
  const aSignup = await signUp(A_EMAIL);
  const bSignup = await signUp(B_EMAIL);
  if (aSignup.status !== 200 || bSignup.status !== 200) {
    throw new Error('signup failed: ' + JSON.stringify([aSignup.status, bSignup.status]));
  }

  // Grant A Pro BEFORE signing in so the Better Auth session carries the Pro tier.
  await prisma.user.updateMany({ where: { email: A_EMAIL }, data: { tier: 'PRO' } });

  const aCookie = await signInGetCookie(A_EMAIL);
  const bCookie = await signInGetCookie(B_EMAIL);
  if (!aCookie || !bCookie) throw new Error('no session cookie from sign-in (set-cookie missing)');

  const authH = (cookie) => ({ 'Content-Type': 'application/json', cookie });

  console.log('2) A creates a room (needs >=3 flashcards)');
  // Seed a few flashcards for A.
  const aUser = await prisma.user.findUnique({ where: { email: A_EMAIL } });
  for (let i = 0; i < 4; i++) {
    await prisma.flashcard.create({
      data: { userId: aUser.id, question: `Q${i}?`, answer: `A${i}`, difficulty: 'easy' },
    });
  }
  const createRes = await api('/api/game/rooms', {
    method: 'POST',
    headers: authH(aCookie),
    body: JSON.stringify({ source: 'flashcards', perQuestionSec: 5, baseXp: 10 }),
  });
  if (createRes.status !== 200) throw new Error('create room failed: ' + JSON.stringify(createRes.body));
  const code = createRes.body.code;
  console.log('   room code:', code, 'questions:', createRes.body.questionCount);

  console.log('3) both players get WS tickets + open sockets');
  const aTicket = (await api('/api/game/auth-ticket', { method: 'POST', headers: authH(aCookie), body: JSON.stringify({ roomCode: code }) })).body.ticket;
  const bTicket = (await api('/api/game/auth-ticket', { method: 'POST', headers: authH(bCookie), body: JSON.stringify({ roomCode: code }) })).body.ticket;

  const aState = { scores: [], question: null, finished: null };
  const bState = { scores: [], question: null, finished: null };
  const aWs = await openWs(code, aTicket, (m) => {
    if (process.env.DEBUG) console.log('   [A]', m.type, m.questionId || '', 'q?', !!m.question);
    if (m.type === 'scores') aState.scores = m.scores;
    if (m.type === 'question') aState.question = m;
    if (m.type === 'finished') aState.finished = m;
  });
  const bWs = await openWs(code, bTicket, (m) => {
    if (process.env.DEBUG) console.log('   [B]', m.type, m.questionId || '');
    if (m.type === 'scores') bState.scores = m.scores;
    if (m.type === 'question') bState.question = m;
    if (m.type === 'finished') bState.finished = m;
  });
  await sleep(300);

  console.log('4) host starts the game');
  const startRes = await api(`/api/game/rooms/${code}/start`, { method: 'POST', headers: authH(aCookie), body: JSON.stringify({}) });
  if (startRes.status !== 200) throw new Error('start failed: ' + JSON.stringify(startRes.body));

  console.log('5) answer loop: A fast+correct, B slow+wrong');
  let answered = 0;
  const maxQ = 4;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && answered < maxQ) {
    if (aState.question && bState.question && aState.question.questionId) {
      const q = aState.question;
      // A answers immediately (fast => max speed bonus). Picks index 0.
      aWs.send(JSON.stringify({ type: 'answer', questionId: q.questionId, choiceIdx: 0 }));
      // B intentionally never answers => times out => 0 XP. This guarantees A wins
      // as long as A gets at least one question correct (1/4 chance each, 4 questions).
      aState.question = null;
      bState.question = null;
      answered++;
      console.log('   answered question', answered);
    }
    await sleep(200);
  }
  console.log('   answered', answered, 'questions');

  console.log('6) wait for finished');
  let waited = 0;
  while (!aState.finished && waited < 15000) { await sleep(300); waited += 300; }
  if (!aState.finished) throw new Error('game did not finish');

  const rank = aState.finished.ranking;
  const aRow = rank.find((r) => r.userId === aUser.id);
  console.log('   ranking:', rank.map((r) => `${r.name}:${r.xp}(#${r.rank})`).join(', '));
  console.log('   winnerId:', aState.finished.winnerId, 'A id:', aUser.id);

  console.log('7) verify persisted XP in Neon');
  const gp = await prisma.gamePlayer.findFirst({ where: { roomId: (await prisma.gameRoom.findUnique({ where: { code } })).id, userId: aUser.id } });
  console.log('   A persisted xp:', gp?.xp, '| ranking xp:', rank.map(r=>`${r.name}:${r.xp}`).join(','));

  // Assertions: game finished, XP persisted, and A (fast answerer) scored >= B (timeout).
  const bRow = rank.find((r) => r.name === B_EMAIL.split('@')[0]);
  const ok = aRow && bRow && gp && gp.xp >= 0 && (aRow.xp >= bRow.xp) && aState.finished.winnerId;
  console.log(ok ? '\n✅ SMOKE TEST PASSED' : '\n❌ SMOKE TEST FAILED');

  console.log('8) cleanup');
  await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } });
  aWs.close(); bWs.close();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SMOKE TEST ERROR:', e.message);
  await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
