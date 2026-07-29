/**
 * Typed CRUD helpers for every store.
 * All Date fields are stored/read as-is — IDB handles Date objects natively.
 */

import { getDB } from './schema';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';

// ── Generic helpers ───────────────────────────────────────────────────────────
async function getAll<T>(store: Parameters<Awaited<ReturnType<typeof getDB>>['getAll']>[0]): Promise<T[]> {
  const db = await getDB();
  return db.getAll(store as any) as Promise<T[]>;
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await getDB();
  await (db as any).put(store, value);
}

async function del(store: string, key: string): Promise<void> {
  const db = await getDB();
  await (db as any).delete(store, key);
}

async function clear(store: string): Promise<void> {
  const db = await getDB();
  await (db as any).clear(store);
}

async function putAll<T>(store: string, items: T[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(store as any, 'readwrite');
  await Promise.all([...items.map(item => (tx.store as any).put(item)), tx.done]);
}

// ── Notes ─────────────────────────────────────────────────────────────────────
export const notesDB = {
  getAll:  ()                  => getAll<Note>('notes'),
  put:     (note: Note)        => put('notes', note),
  delete:  (id: string)        => del('notes', id),
  putAll:  (items: Note[])     => putAll('notes', items),
  clear:   ()                  => clear('notes'),
};

// ── Contacts ──────────────────────────────────────────────────────────────────
export const contactsDB = {
  getAll:  ()                     => getAll<Contact>('contacts'),
  put:     (contact: Contact)     => put('contacts', contact),
  delete:  (id: string)           => del('contacts', id),
  putAll:  (items: Contact[])     => putAll('contacts', items),
  clear:   ()                     => clear('contacts'),
};

// ── Flashcards ────────────────────────────────────────────────────────────────
export const flashcardsDB = {
  getAll:  ()                       => getAll<Flashcard>('flashcards'),
  put:     (card: Flashcard)        => put('flashcards', card),
  delete:  (id: string)             => del('flashcards', id),
  putAll:  (items: Flashcard[])     => putAll('flashcards', items),
  clear:   ()                       => clear('flashcards'),
};

// ── Folders ───────────────────────────────────────────────────────────────────
export const foldersDB = {
  getAll:  ()                    => getAll<Folder>('folders'),
  put:     (folder: Folder)      => put('folders', folder),
  delete:  (id: string)          => del('folders', id),
  putAll:  (items: Folder[])     => putAll('folders', items),
  clear:   ()                    => clear('folders'),
};

// ── Practice questions ────────────────────────────────────────────────────────
export const practiceQuestionsDB = {
  getAll:  ()                              => getAll<PracticeQuestion>('practice_questions'),
  put:     (q: PracticeQuestion)           => put('practice_questions', q),
  delete:  (id: string)                    => del('practice_questions', id),
  putAll:  (items: PracticeQuestion[])     => putAll('practice_questions', items),
  clear:   ()                              => clear('practice_questions'),
};

// ── Saved searches ────────────────────────────────────────────────────────────
export const savedSearchesDB = {
  getAll:  ()                          => getAll<SavedSearch>('saved_searches'),
  put:     (s: SavedSearch)            => put('saved_searches', s),
  delete:  (id: string)                => del('saved_searches', id),
  putAll:  (items: SavedSearch[])      => putAll('saved_searches', items),
  clear:   ()                          => clear('saved_searches'),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsDB = {
  async get(key: string): Promise<string | null> {
    const db = await getDB();
    const row = await db.get('settings', key);
    return row?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    const db = await getDB();
    await db.put('settings', { key, value });
  },
};
