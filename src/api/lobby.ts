import { apiGet, apiPost } from './client';

/**
 * A lobby is the shareable front door to a live session. It owns a
 * six-digit code and points at the session it fronts, so a player who
 * arrives with only a code (or the link, or the QR) can be routed to the
 * right kind of session.
 */
export type LobbyKind = 'quiz' | 'study';
export type LobbyStatus = 'open' | 'live' | 'closed';

export interface LobbySummary {
  code: string;
  kind: LobbyKind;
  title: string;
  status: LobbyStatus;
  maxParticipants: number;
  createdAt: string;
  expiresAt: string | null;
  hostName: string | null;
}

export interface LobbyTarget {
  kind: LobbyKind;
  /** Quiz: the game room code to join. */
  roomCode?: string | null;
  /** Study: the video room URL. */
  roomUrl?: string | null;
  /** Study: the voice room id — the joiner needs it to reach the same voice room. */
  voiceRoomId?: string | null;
}

export interface LobbyDetail extends LobbySummary {
  sessionTitle: string;
  playerCount: number | null;
  target: LobbyTarget;
}

export interface MyLobby extends LobbySummary {
  expired: boolean;
  target: LobbyTarget;
}

/** Resolve a six-digit lobby code to the session it points at. */
export function getLobby(code: string) {
  return apiGet<LobbyDetail>(`/api/lobby/${encodeURIComponent(code)}`);
}

/** The lobbies the signed-in user hosts. */
export function listMyLobbies() {
  return apiGet<MyLobby[]>('/api/lobby/mine');
}

/**
 * Create a lobby for a session that was made outside the quiz/study-room
 * routes. Sessions created through those routes get a lobby automatically.
 */
export function createLobby(body: {
  kind: LobbyKind;
  title?: string;
  targetCode?: string;
  targetUrl?: string;
  maxParticipants?: number;
}) {
  return apiPost<LobbySummary>('/api/lobby', body);
}

/**
 * The shareable link for a lobby code. Opens the lobby, which then sends
 * the player to the right screen for the session.
 */
export function lobbyShareUrl(code: string, origin?: string) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/?lobby=${code}`;
}
