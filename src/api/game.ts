import { apiGet, apiPost } from './client';

export interface GamePlayerInfo { userId: string; name: string; xp: number; }
export interface GameRoomSummary {
  code: string;
  status: 'lobby' | 'live' | 'finished';
  source: 'flashcards' | 'topic';
  topic?: string | null;
  questionCount: number;
  host: { id: string; name?: string | null };
  players: GamePlayerInfo[];
  live: { connectedPlayers: number } | null;
}

export interface CreateRoomBody {
  source?: 'flashcards' | 'topic';
  topic?: string;
  flashcardIds?: string[];
  perQuestionSec?: number;
  baseXp?: number;
}

export function createGameRoom(body: CreateRoomBody) {
  return apiPost<{ code: string; roomId: string; questionCount: number }>('/api/game/rooms', body);
}

export function getGameRoom(code: string) {
  return apiGet<GameRoomSummary>(`/api/game/rooms/${code}`);
}

export function listMyGameRooms() {
  return apiGet<Array<{ code: string; status: string; source: string; host: string; questionCount: number }>>('/api/game/rooms');
}

export function getGameTicket(code: string) {
  return apiPost<{ ticket: string; wsUrl: string }>('/api/game/auth-ticket', { roomCode: code });
}

export function startGameRoom(code: string) {
  return apiPost<{ ok: true }>(`/api/game/rooms/${code}/start`, {});
}
