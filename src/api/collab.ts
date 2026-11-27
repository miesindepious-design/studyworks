/**
 * /api/collab — a shared folder that a study group edits together.
 *
 * Every save says which version of the note it started from. If the note has
 * moved on, the server answers 409 with the note as it is now, and the
 * caller decides — see utils/collab.ts.
 */
import { APIError, apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { CollabNote, CollabRole } from '../utils/collab';

export interface CollabMember {
  /** Null for the owner, who has no membership row. */
  memberId: string | null;
  userId: string;
  name: string;
  role: CollabRole;
  lastSeenAt: string | null;
}

export interface CollabFolder {
  folderId: string;
  folderName: string;
  ownerId: string;
  myRole: CollabRole;
  /** The signed-in user's id, so the client can leave itself out of "who is here". */
  userId: string;
  notes: CollabNote[];
  members: CollabMember[];
}

/** What the server sends when it refuses a save. */
export class CollabConflictError extends Error {
  readonly current: CollabNote;
  constructor(message: string, current: CollabNote) {
    super(message);
    this.name = 'CollabConflictError';
    this.current = current;
  }
}

export async function joinWithToken(token: string): Promise<CollabFolder> {
  return apiPost<CollabFolder>('/api/collab/join', { token });
}

export async function getCollabFolder(folderId: string): Promise<CollabFolder> {
  return apiGet<CollabFolder>(`/api/collab/${encodeURIComponent(folderId)}`);
}

export async function getCollabNote(folderId: string, noteId: string): Promise<CollabNote> {
  return apiGet<CollabNote>(
    `/api/collab/${encodeURIComponent(folderId)}/notes/${encodeURIComponent(noteId)}`,
  );
}

export async function getCollabTicket(folderId: string): Promise<{ ticket: string }> {
  return apiPost<{ ticket: string }>(`/api/collab/${encodeURIComponent(folderId)}/ticket`, {});
}

export function saveCollabNote(
  folderId: string,
  draft: { noteId: string; title: string; content: string; tags: string[]; base: CollabNote },
  connId?: string,
): Promise<CollabNote> {
  const folder = encodeURIComponent(folderId);
  const note = encodeURIComponent(draft.noteId);
  return apiPatch<CollabNote>(`/api/collab/${folder}/notes/${note}`, {
    title: draft.title,
    content: draft.content,
    tags: draft.tags,
    baseUpdatedAt: draft.base.updatedAt,
    baseRevision: draft.base.revision,
    connId,
  }).catch((err: any) => {
    // A 409 is not a failure, it is an answer: "somebody got there first".
    // Give it its own shape so the caller cannot mistake it for a network
    // problem and retry it.
    if (err instanceof APIError && err.status === 409) {
      const current = (err.body as { current?: CollabNote } | undefined)?.current;
      if (current) throw new CollabConflictError(err.message, current);
    }
    throw err;
  });
}

export function createCollabNote(
  folderId: string,
  note: { title: string; content: string; tags?: string[] },
  connId?: string,
): Promise<CollabNote> {
  return apiPost<CollabNote>(`/api/collab/${encodeURIComponent(folderId)}/notes`, { ...note, connId });
}

export function deleteCollabNote(folderId: string, noteId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/collab/${encodeURIComponent(folderId)}/notes/${encodeURIComponent(noteId)}`,
  );
}

export function setMemberRole(
  folderId: string,
  memberId: string,
  role: 'viewer' | 'editor',
): Promise<{ ok: boolean }> {
  return apiPatch<{ ok: true }>(
    `/api/collab/${encodeURIComponent(folderId)}/members/${encodeURIComponent(memberId)}`,
    { role },
  );
}

export function removeMember(folderId: string, memberId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/collab/${encodeURIComponent(folderId)}/members/${encodeURIComponent(memberId)}`,
  );
}
