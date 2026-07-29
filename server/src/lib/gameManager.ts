/**
 * In-memory multiplayer quiz game manager.
 *
 * One instance per server process. Holds live room state (players connected
 * via WebSocket, current question, scores) and relays events to clients.
 * Authoritative persistence happens at game start (questions snapshotted into
 * the DB) and at game end (answers + XP written to the DB). Mid-game state
 * lives here only — if the server restarts, in-flight games are lost (an
 * acceptable trade-off; players just start a new room).
 *
 * Scoring: XP for a correct answer = round(baseXp * speedBonus) where
 *   speedBonus = 1 + max(0, (perQuestionMs - responseMs) / perQuestionMs)
 * so the fastest correct answer earns up to 2× base, and a correct answer
 * at the buzzer earns exactly base. Wrong/timeout answers earn 0.
 */

import type { GameQuestion, GamePlayer } from '@prisma/client';
import { prisma } from './prisma';

export type Role = 'host' | 'player';

export interface PlayerConn {
  connId: string;
  userId: string;
  name: string;
  role: Role;
  xp: number;
  ws: WebSocketLike;
}

export interface QuizState {
  questionIndex: number;        // -1 before start / after finish
  questionCount: number;
  startedAt: number | null;
  deadlineAt: number | null;    // epoch ms when current question closes
}

export interface ServerMessage {
  type: string;
  [k: string]: unknown;
}

export interface WebSocketLike {
  send(data: string): void;
  readyState: number;
  close(): void;
}

const SPEED_BONUS_CAP = 1; // max extra (so fastest correct = 2× base)

export class GameManager {
  // roomCode -> room
  private rooms = new Map<string, Room>();
  // connId -> { roomCode, userId } for fast disconnect lookup
  private conns = new Map<string, { roomCode: string; userId: string }>();

  // Short-lived auth tickets: ticket -> { userId, name, expires }
  private tickets = new Map<string, { userId: string; name: string; expires: number }>();

  /** Issue a short-lived ticket the client presents when opening the WS. */
  issueTicket(userId: string, name: string): string {
    const t = crypto.randomUUID();
    this.tickets.set(t, { userId, name, expires: Date.now() + 60_000 });
    return t;
  }

  private redeemTicket(t: string): { userId: string; name: string } | null {
    const v = this.tickets.get(t);
    if (!v) return null;
    this.tickets.delete(t);
    if (v.expires < Date.now()) return null;
    return v;
  }

  /** Attach a WebSocket to a room. Returns the joined player or an error string. */
  connect(roomCode: string, ticket: string, ws: WebSocketLike): { ok: true; player: PlayerConn } | { ok: false; error: string } {
    const identity = this.redeemTicket(ticket);
    if (!identity) return { ok: false, error: 'invalid or expired ticket' };
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return { ok: false, error: 'room not found' };
    if (room.status === 'finished') return { ok: false, error: 'game already finished' };

    const connId = crypto.randomUUID();
    const isHost = room.hostUserId === identity.userId && room.players.size === 0;
    // If host already connected, treat subsequent same-user as player.
    const role: Role = isHost ? 'host' : 'player';

    // Reconnect / replace if same user already present.
    const existing = [...room.players.values()].find(p => p.userId === identity.userId);
    if (existing) {
      this.conns.delete(existing.connId);
      room.players.delete(existing.connId);
    }

    const player: PlayerConn = {
      connId,
      userId: identity.userId,
      name: identity.name,
      role,
      xp: existing?.xp ?? 0,
      ws,
    };
    room.players.set(connId, player);
    this.conns.set(connId, { roomCode: room.code, userId: identity.userId });
    return { ok: true, player };
  }

  disconnect(connId: string) {
    const meta = this.conns.get(connId);
    if (!meta) return;
    this.conns.delete(connId);
    const room = this.rooms.get(meta.roomCode);
    if (!room) return;
    const player = room.players.get(connId);
    if (!player) return;
    room.players.delete(connId);
    this.broadcast(room.code, { type: 'player-left', userId: player.userId, name: player.name });
    // If host left and game not started, end the room.
    if (player.role === 'host' && room.status !== 'finished') {
      this.endRoom(room.code, 'host-left');
    } else if (room.players.size === 0) {
      this.rooms.delete(room.code);
    }
  }

  getConnMeta(connId: string) {
    return this.conns.get(connId);
  }

  /** Relay a chat message from one player to everyone in the room. */
  relayChat(connId: string, text: string) {
    const meta = this.conns.get(connId);
    if (!meta) return;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return;
    const player = room.players.get(connId);
    if (!player) return;
    this.broadcast(room.code, { type: 'chat', userId: player.userId, name: player.name, text });
  }

  /** Register a room that was created/persisted via REST. */
  registerRoom(code: string, hostUserId: string, status: string, dbRoomId: string) {
    this.rooms.set(code.toUpperCase(), {
      code: code.toUpperCase(),
      hostUserId,
      dbRoomId,
      status: status as Room['status'],
      players: new Map(),
      questions: [],
      settings: null,
      answeredThisQ: null,
      pendingAnswers: [],
      quiz: { questionIndex: -1, questionCount: 0, startedAt: null, deadlineAt: null },
      timer: null,
    });
  }

  /** Load questions into an in-memory room (called when game starts). */
  loadQuestions(code: string, questions: GameQuestion[], perQuestionSec: number, baseXp: number) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    room.questions = [...questions].sort((a, b) => a.order - b.order);
    room.settings = { perQuestionSec, baseXp };
    room.quiz.questionCount = room.questions.length;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Begin the round: emit question 0 with a deadline. */
  startQuiz(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.questions.length === 0) return;
    room.status = 'live';
    this.advance(code);
  }

  private advance(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    room.quiz.questionIndex += 1;
    if (room.quiz.questionIndex >= room.questions.length) {
      this.finish(code);
      return;
    }
    const q = room.questions[room.quiz.questionIndex];
    const perMs = (room.settings?.perQuestionSec ?? 15) * 1000;
    room.quiz.startedAt = Date.now();
    room.quiz.deadlineAt = Date.now() + perMs;
    room.answeredThisQ = new Set();
    this.broadcast(room.code, {
      type: 'question',
      index: room.quiz.questionIndex,
      total: room.questions.length,
      prompt: q.prompt,
      options: q.options,
      questionId: q.id,
      deadline: room.quiz.deadlineAt,
    });
    // Auto-advance on timeout.
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => this.onQuestionTimeout(code), perMs + 250);
  }

  private onQuestionTimeout(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    // Award 0 to players who didn't answer (already 0 by default) and reveal.
    this.reveal(code);
  }

  /** Record an answer from a player. */
  answer(connId: string, questionId: string, choiceIdx: number) {
    const meta = this.conns.get(connId);
    if (!meta) return;
    const room = this.rooms.get(meta.roomCode);
    if (!room || room.status !== 'live') return;
    const player = room.players.get(connId);
    if (!player) return;
    const q = room.questions[room.quiz.questionIndex];
    if (!q || q.id !== questionId) return;
    if (room.answeredThisQ?.has(player.userId)) return; // one answer per question
    room.answeredThisQ?.add(player.userId);

    const correct = choiceIdx === q.answerIdx;
    const responseMs = room.quiz.startedAt ? Math.max(0, Date.now() - room.quiz.startedAt) : null;
    let xp = 0;
    if (correct && responseMs != null) {
      const perMs = (room.settings?.perQuestionSec ?? 15) * 1000;
      const base = room.settings?.baseXp ?? 10;
      const speedBonus = 1 + Math.max(0, (perMs - responseMs) / perMs) * SPEED_BONUS_CAP;
      xp = Math.round(base * speedBonus);
    }
    player.xp += xp;
    room.pendingAnswers.push({ questionId, playerId: player.connId, userId: player.userId, choiceIdx, correct, responseMs, xpAwarded: xp });

    this.broadcast(room.code, { type: 'answer-ack', userId: player.userId, correct, xp });
    this.broadcastScores(room.code);

    // Advance early if everyone answered.
    const answeredCount = room.answeredThisQ?.size ?? 0;
    if (answeredCount >= room.players.size) {
      if (room.timer) clearTimeout(room.timer);
      setTimeout(() => this.reveal(meta.roomCode), 600);
    }
  }

  private reveal(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    const q = room.questions[room.quiz.questionIndex];
    if (!q) return;
    if (room.timer) clearTimeout(room.timer);
    this.broadcast(room.code, { type: 'reveal', answerIdx: q.answerIdx });
    setTimeout(() => this.advance(code), 2200);
  }

  private finish(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    room.status = 'finished';
    room.quiz.questionIndex = -1;
    if (room.timer) clearTimeout(room.timer);
    const ranking = [...room.players.values()].sort((a, b) => b.xp - a.xp);
    const winner = ranking[0];
    this.broadcast(room.code, {
      type: 'finished',
      ranking: ranking.map((p, i) => ({ userId: p.userId, name: p.name, xp: p.xp, rank: i + 1 })),
      winnerId: winner?.userId ?? null,
    });
    // Persist answers + XP to Neon (best-effort; failures are logged, not fatal).
    if (room.dbRoomId) {
      this.persistResults(code).catch(err =>
        console.error('[gameManager] persistResults failed:', err?.message ?? err));
    }
  }

  endRoom(code: string, reason: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    room.status = 'finished';
    this.broadcast(room.code, { type: 'room-ended', reason });
    this.rooms.delete(room.code);
  }

  /** Persist end-of-game results to the DB. Returns the winner userId. */
  async persistResults(code: string): Promise<string | null> {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    const ranking = [...room.players.values()].sort((a, b) => b.xp - a.xp);
    const winner = ranking[0]?.userId ?? null;

    // Resolve a GamePlayer id for each connected player ONCE (upsert), then
    // write answers referencing those ids. Doing the lookup outside the hot
    // per-answer loop avoids transaction timeouts.
    const playerIds = new Map<string, string>(); // userId -> gamePlayerId
    for (const p of room.players.values()) {
      const gp = await prisma.gamePlayer.upsert({
        where: { roomId_userId: { roomId: room.dbRoomId!, userId: p.userId } },
        create: { roomId: room.dbRoomId!, userId: p.userId, name: p.name, xp: p.xp },
        update: { name: p.name, xp: p.xp },
      });
      playerIds.set(p.userId, gp.id);
    }

    // Batch the answer inserts.
    await prisma.gameAnswer.createMany({
      data: room.pendingAnswers.map(a => ({
        roomId: room.dbRoomId!,
        questionId: a.questionId,
        playerId: playerIds.get(a.userId)!,
        choiceIdx: a.choiceIdx,
        correct: a.correct,
        responseMs: a.responseMs,
        xpAwarded: a.xpAwarded,
      })),
    });

    await prisma.gameRoom.update({ where: { id: room.dbRoomId! }, data: { status: 'finished' } });
    return winner;
  }

  /** Broadcast a message to everyone in the room. Public so the WS handler
   * (which is part of this subsystem) can announce joins/leaves. */
  broadcast(code: string, msg: ServerMessage) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  /** Broadcast the current scoreboard. */
  broadcastScores(code: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    this.broadcast(code, {
      type: 'scores',
      scores: [...room.players.values()].map(p => ({ userId: p.userId, name: p.name, xp: p.xp })),
    });
  }
}

export interface Room {
  code: string;
  hostUserId: string;
  dbRoomId: string | null;
  status: 'lobby' | 'live' | 'finished';
  players: Map<string, PlayerConn>;
  questions: GameQuestion[];
  settings: { perQuestionSec: number; baseXp: number } | null;
  quiz: QuizState;
  timer: ReturnType<typeof setTimeout> | null;
  answeredThisQ: Set<string> | null;
  pendingAnswers: { questionId: string; playerId: string; userId: string; choiceIdx: number | null; correct: boolean; responseMs: number | null; xpAwarded: number }[];
}

// Singleton used by the REST + WS routes.
export const gameManager = new GameManager();
