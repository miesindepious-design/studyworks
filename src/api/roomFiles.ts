import { apiGet, apiPost, apiDelete } from './client';

/**
 * Shared study files — the group's material in the lobby.
 *
 * A member drops a file into the lobby (a textbook chapter, the past paper,
 * the slides) and the whole group can study from it, battle each other over
 * it, or set a duel from it. The file's text is extracted in the browser and
 * stored with the metadata, because that text is what the AI reads.
 */
export type RoomFileType = 'pdf' | 'docx' | 'pptx' | 'image' | 'html' | 'text' | 'other';

export interface RoomFileInfo {
  id: string;
  name: string;
  type: RoomFileType;
  size: number;
  url: string | null;
  storageKey: string | null;
  /** True when text could be extracted — the AI can ground itself on it. */
  hasText: boolean;
  textLength: number;
  uploadedBy: { id: string; name: string | null };
  createdAt: string;
}

export interface RoomFileWithText extends RoomFileInfo {
  text: string;
}

export function listRoomFiles(code: string) {
  return apiGet<{ files: RoomFileInfo[] }>(`/api/lobby/${encodeURIComponent(code)}/files`);
}

/** One file including its extracted text — for opening it in the AI tutor. */
export function getRoomFile(code: string, fileId: string) {
  return apiGet<RoomFileWithText>(
    `/api/lobby/${encodeURIComponent(code)}/files/${encodeURIComponent(fileId)}`,
  );
}

export function addRoomFile(
  code: string,
  body: {
    name: string;
    type?: RoomFileType;
    size?: number;
    text?: string;
    storageKey?: string;
    url?: string;
  },
) {
  return apiPost<RoomFileInfo>(`/api/lobby/${encodeURIComponent(code)}/files`, body);
}

export function removeRoomFile(code: string, fileId: string) {
  return apiDelete<{ ok: true }>(
    `/api/lobby/${encodeURIComponent(code)}/files/${encodeURIComponent(fileId)}`,
  );
}

/**
 * Presign the raw bytes for object storage. When storage is not configured
 * the server says so and the file is still shared — the group just does not
 * get a downloadable copy of the original.
 */
export function presignRoomFile(
  code: string,
  body: { name: string; size: number; contentType?: string },
) {
  return apiPost<{
    storageEnabled: boolean;
    uploadUrl: string | null;
    storageKey: string | null;
    publicUrl: string | null;
  }>(`/api/lobby/${encodeURIComponent(code)}/files/presign`, body);
}
