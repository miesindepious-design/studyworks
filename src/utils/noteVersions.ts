/**
 * noteVersions.ts — IndexedDB-backed version history for notes.
 *
 * Stores snapshots keyed by `${noteId}::${timestamp}` so a note can have
 * many versions without key collisions. The `by_note` index lets us pull
 * all versions for a single note quickly.
 */

import { getDB } from '../db/schema';
import type { NoteVersion } from '../types';

const VERSION_KEY_PREFIX = 'nv:';
const MAX_VERSIONS_PER_NOTE = 50; // prune oldest beyond this

export async function saveVersion(noteId: string, title: string, content: string, tags: string[]): Promise<NoteVersion> {
  const db = await getDB();
  const version: NoteVersion = {
    id: `${VERSION_KEY_PREFIX}${noteId}::${Date.now()}`,
    noteId,
    title,
    content,
    tags,
    snapshotAt: new Date(),
  };
  await db.put('note_versions', version);

  // Prune if over limit — oldest first
  const all = await db.getAllFromIndex('note_versions', 'by_note', noteId);
  if (all.length > MAX_VERSIONS_PER_NOTE) {
    all.sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime());
    const toDelete = all.slice(0, all.length - MAX_VERSIONS_PER_NOTE);
    await Promise.all(toDelete.map(v => db.delete('note_versions', v.id)));
  }

  return version;
}

export async function getVersionsForNote(noteId: string): Promise<NoteVersion[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('note_versions', 'by_note', noteId);
  return all.sort((a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime());
}

export async function deleteVersion(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('note_versions', id);
}

export async function clearVersionsForNote(noteId: string): Promise<void> {
  const db = await getDB();
  const all = await db.getAllFromIndex('note_versions', 'by_note', noteId);
  await Promise.all(all.map(v => db.delete('note_versions', v.id)));
}
