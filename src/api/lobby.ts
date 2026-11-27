import { apiGet, apiPost, apiDelete } from './client';

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

export interface LobbyParticipantInfo {
  userId: string;
  name: string | null;
  joinedAt: string;
}

export interface LobbyDetail extends LobbySummary {
  sessionTitle: string;
  playerCount: number | null;
  /** Who hosts the session right now — the creator, or whoever took over. */
  hostUserId: string | null;
  /** Who is actually in a study session, in join order. */
  participants: LobbyParticipantInfo[];
  target: LobbyTarget;
}

export interface MyLobby extends LobbySummary {
  expired: boolean;
  /**
   * True when the lobby can no longer be joined — the host closed it, the
   * session behind it finished, or it aged out. Ended lobbies are kept out
   * of the way until the host asks to see them.
   *
   * Optional because the server may be a version that predates the field;
   * the client falls back to reading the status and the expiry itself.
   */
  isEnded?: boolean;
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

/** Find one of my lobbies by whatever the caller cares about. */
export async function findMyLobby(match: (l: MyLobby) => boolean): Promise<MyLobby | null> {
  const mine = await listMyLobbies();
  return mine.find(match) ?? null;
}

/**
 * Register presence in a study session. Also the shape of truth for the
 * roster and the host — the session client polls resolve() for that.
 */
export function joinLobby(code: string) {
  return apiPost<{ ok: true; hostUserId: string | null; participants: LobbyParticipantInfo[] }>(
    `/api/lobby/${encodeURIComponent(code)}/join`,
    {},
  );
}

/** Leave a study session. Hands the host role on if the caller was hosting. */
export function leaveLobby(code: string) {
  return apiPost<{ ok: true; hostUserId: string | null }>(
    `/api/lobby/${encodeURIComponent(code)}/leave`,
    {},
  );
}

/** Close a lobby for good. Host-only: the code, link and QR all stop working. */
export function closeLobby(code: string) {
  return apiPost<{ ok: true }>(`/api/lobby/${encodeURIComponent(code)}/close`, {});
}

/**
 * Delete a lobby for good. Host-only.
 *
 * Closing only stops people arriving — the lobby stays in the host's list.
 * This removes it entirely: the lobby, its roster and the files shared on it.
 */
export function deleteLobby(code: string) {
  return apiDelete<{ ok: true }>(`/api/lobby/${encodeURIComponent(code)}`);
}

/**
 * Delete every lobby of mine that has already ended, in one go.
 *
 * For the host with a screenful of dead rooms and no interest in going
 * through them one at a time.
 */
export function deleteEndedLobbies() {
  return apiDelete<{ ok: true; deleted: number }>('/api/lobby/mine');
}

/**
 * Bring a study group back after it closed itself for sitting idle.
 *
 * Only a group that exists purely to hold material can be reopened — a lobby
 * that fronts a finished session has nothing to go back to.
 */
export function reopenLobby(code: string) {
  return apiPost<{ ok: true }>(`/api/lobby/${encodeURIComponent(code)}/reopen`, {});
}

/**
 * Create a lobby directly. A quiz and a study room mint their own; this is
 * for a group that only wants a place to share material — a code, a link and
 * a shared shelf of files.
 */
export function createLobby(body: { kind: LobbyKind; title?: string; maxParticipants?: number }) {
  return apiPost<LobbySummary>('/api/lobby', body);
}

/**
 * The shareable link for a lobby code. Opens the lobby, which then sends
 * the player to the right screen for the session.
 */
export function lobbyShareUrl(code: string, origin?: string) {
  // In the Tauri desktop app window.location.origin is tauri://localhost —
  // not a shareable URL.  Fall back to the production Vercel URL.
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
  const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const defaultOrigin = isTauri ? API_BASE : (typeof window !== 'undefined' ? window.location.origin : '');
  const base = origin ?? defaultOrigin;
  return `${base}/?lobby=${code}`;
}
