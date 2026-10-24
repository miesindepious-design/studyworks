import { apiGet, apiPost } from './client';

export interface StudyRoom {
  id: string;
  name: string;
  url: string | null;
  roomName: string;
  provider: 'daily' | 'local';
  maxParticipants: number;
  createdAt: string;
}

export interface CreateStudyRoomBody {
  name?: string;
  maxParticipants?: number;
}

export function createStudyRoom(body: CreateStudyRoomBody) {
  return apiPost<StudyRoom>('/api/study-room', body);
}
