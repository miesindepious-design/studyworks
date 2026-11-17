import { apiPost } from './client';

export interface StudyRoom {
  id: string;
  name: string;
  url: string | null;
  roomName: string;
  provider: 'daily' | 'local';
  maxParticipants: number;
  /** Six-digit lobby code for this room — share it, the link, or the QR. */
  lobbyCode?: string | null;
  createdAt: string;
}

export interface CreateStudyRoomBody {
  name?: string;
  maxParticipants?: number;
}

export function createStudyRoom(body: CreateStudyRoomBody) {
  return apiPost<StudyRoom>('/api/study-room', body);
}
