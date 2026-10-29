/**
 * flashcards.ts — client-side helpers for flashcard deletion.
 */
import { apiDelete } from './client';

export async function deleteFlashcard(id: string): Promise<void> {
  await apiDelete(`/api/flashcards/${encodeURIComponent(id)}`);
}

export async function bulkDeleteFlashcards(ids: string[]): Promise<void> {
  await apiDelete('/api/flashcards', { ids });
}
