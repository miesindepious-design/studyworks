/**
 * notes.ts — client-side helpers for note deletion.
 */
import { apiDelete } from './client';

export async function deleteNote(id: string): Promise<void> {
  await apiDelete(`/api/notes/${encodeURIComponent(id)}`);
}

export async function bulkDeleteNotes(ids: string[]): Promise<void> {
  await apiDelete('/api/notes', { ids });
}
