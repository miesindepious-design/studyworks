/**
 * The multiplayer quiz over the real WebSocket.
 *
 * The quiz used to be a client that spoke to a socket server that did not
 * exist in this bundle, so a "live" battle could not actually go live. This
 * test drives the real thing: a `ws` client connects to the socket the
 * server attaches, the room is joined, the host starts the round, a question
 * goes out, and an answer comes back scored.
 *
 * It is the difference between "the code compiles" and "two students can
 * play".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { WebSocket } from 'ws';
import { app } from '../app.js';
import { attachGameWebSocket } from '../routes/ws.js';
import { gameManager } from '../lib/gameManager.js';
import { prismaMock } from './setup.js';

const ROOM = 'WSROOM1';

let server: Server;
let port: number;

const questions = [
  { id: 'q1', prompt: 'Which organelle makes sugar?', options: ['Nucleus', 'Chloroplast', 'Ribosome', 'Mitochondrion'], answerIdx: 1, order: 0 },
  { id: 'q2', prompt: 'What gas do plants take in?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], answerIdx: 1, order: 1 },
];

beforeAll(async () => {
  prismaMock.gamePlayer.upsert.mockResolvedValue({ id: 'gp-1' } as any);
  prismaMock.gamePlayer.findMany.mockResolvedValue([] as any);
  prismaMock.gameAnswer.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.gameRoom.update.mockResolvedValue({} as any);
  prismaMock.lobby.updateMany.mockResolvedValue({ count: 0 } as any);

  server = serve({ fetch: app.fetch, port: 0 }) as unknown as Server;
  attachGameWebSocket(server);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  port = (server.address() as any).port;

  gameManager.registerRoom(ROOM, 'u1', 'lobby', 'db-room-1');
  gameManager.loadQuestions(ROOM, questions as any, 15, 10);
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/**
 * A socket plus a buffer of everything it has received. The buffer matters:
 * the server answers a join before the client's 'open' event lands, so a
 * listener attached afterwards would miss the first messages.
 */
function openSocket(ticket: string): Promise<{ ws: WebSocket; messages: any[]; next: (type: string, timeoutMs?: number) => Promise<any> }> {
  const messages: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${ROOM}&ticket=${ticket}`);
  ws.on('message', (raw: any) => {
    try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });

  const next = (type: string, timeoutMs = 5000): Promise<any> => {
    const seen = messages.find(m => m?.type === type);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${type}"`)), timeoutMs);
      const onMessage = () => {
        const hit = messages.find(m => m?.type === type);
        if (!hit) return;
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(hit);
      };
      ws.on('message', onMessage);
    });
  };

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, messages, next }));
    ws.once('error', reject);
  });
}

describe('The multiplayer quiz socket', () => {
  it('refuses a socket without a ticket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${ROOM}`);
    const error = await new Promise<any>(resolve => {
      ws.once('message', (raw: any) => resolve(JSON.parse(raw.toString())));
      ws.once('error', () => resolve({ type: 'error' }));
    });
    expect(error.type).toBe('error');
    ws.close();
  });

  it('refuses a socket for a room that does not exist', async () => {
    const ticket = gameManager.issueTicket('u2', 'Ben');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=NOSUCHRM&ticket=${ticket}`);
    const error = await new Promise<any>(resolve => {
      ws.once('message', (raw: any) => resolve(JSON.parse(raw.toString())));
      ws.once('error', () => resolve({ type: 'error' }));
    });
    expect(error.type).toBe('error');
    expect(error.message).toMatch(/room/i);
    ws.close();
  });

  it('joins the room, starts the round and scores an answer', async () => {
    const hostTicket = gameManager.issueTicket('u1', 'Ada');
    const playerTicket = gameManager.issueTicket('u2', 'Ben');

    const host = await openSocket(hostTicket);
    const player = await openSocket(playerTicket);

    // Both players are in, and the room knows it.
    const scores = await player.next('scores');
    expect(Array.isArray(scores.scores)).toBe(true);
    expect(scores.scores.length).toBeGreaterThanOrEqual(1);

    // The host starts the round; everybody gets the first question.
    const questionPromise = player.next('question');
    gameManager.startQuiz(ROOM);
    const question = await questionPromise;
    expect(question.prompt).toBe(questions[0].prompt);
    expect(question.options).toHaveLength(4);
    expect(question.total).toBe(2);

    // A correct answer is acknowledged and scores XP.
    const ackPromise = player.next('answer-ack');
    player.ws.send(JSON.stringify({
      type: 'answer',
      questionId: question.questionId,
      choiceIdx: question.options.indexOf('Chloroplast'),
    }));
    const ack = await ackPromise;
    expect(ack.correct).toBe(true);
    expect(ack.xp).toBeGreaterThan(0);

    host.ws.close();
    player.ws.close();
  });
});
