import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';

// ── DB version history ────────────────────────────────────────────────────────
// v1 — initial: all stores created
// v2 — added `streaks` store (current streak, longest streak, daily counts)

const DB_NAME    = 'studyworks-db';
const DB_VERSION = 2;

// Streak data is a singleton with a fixed id.
export interface StreakData {
  id:                'singleton';
  lastReviewDate:    string | null;  // YYYY-MM-DD
  currentStreak:     number;
  longestStreak:     number;
  totalReviews:      number;
  // Sparse map: { "2026-07-21": 14, "2026-07-20": 7, ... }
  // Only days with at least 1 review are stored. Pruned to last 90 days on save.
  dailyCounts:       Record<string, number>;
}

// ── Schema ────────────────────────────────────────────────────────────────────
export interface StudyWorksDB extends DBSchema {
  notes: {
    key: string;
    value: Note;
    indexes: { by_folder: string; by_type: string; by_updated: Date };
  };
  contacts: {
    key: string;
    value: Contact;
    indexes: { by_folder: string };
  };
  flashcards: {
    key: string;
    value: Flashcard;
    indexes: { by_folder: string; by_difficulty: string; by_next_review: Date };
  };
  folders: {
    key: string;
    value: Folder;
  };
  practice_questions: {
    key: string;
    value: PracticeQuestion;
    indexes: { by_note: string };
  };
  saved_searches: {
    key: string;
    value: SavedSearch;
  };
  settings: {
    key: string;
    value: { key: string; value: string };
  };
  streaks: {
    key: 'singleton';
    value: StreakData;
  };
}

// ── Singleton DB promise ───────────────────────────────────────────────────────
let _db: IDBPDatabase<StudyWorksDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<StudyWorksDB>> {
  if (_db) return _db;

  _db = await openDB<StudyWorksDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v0 → v1: create all stores
      if (oldVersion < 1) {
        // notes
        const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
        notesStore.createIndex('by_folder',  'folderId', { unique: false });
        notesStore.createIndex('by_type',    'type',     { unique: false });
        notesStore.createIndex('by_updated', 'updatedAt',{ unique: false });

        // contacts
        const contactsStore = db.createObjectStore('contacts', { keyPath: 'id' });
        contactsStore.createIndex('by_folder', 'folderId', { unique: false });

        // flashcards
        const fcStore = db.createObjectStore('flashcards', { keyPath: 'id' });
        fcStore.createIndex('by_folder',     'folderId',   { unique: false });
        fcStore.createIndex('by_difficulty', 'difficulty', { unique: false });
        fcStore.createIndex('by_next_review','nextReview', { unique: false });

        // folders
        db.createObjectStore('folders', { keyPath: 'id' });

        // practice questions
        const pqStore = db.createObjectStore('practice_questions', { keyPath: 'id' });
        pqStore.createIndex('by_note', 'noteId', { unique: false });

        // saved searches
        db.createObjectStore('saved_searches', { keyPath: 'id' });

        // settings (theme, tier, counters)
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // v1 → v2: add streaks store
      if (oldVersion < 2) {
        db.createObjectStore('streaks', { keyPath: 'id' });
      }
    },
  });

  return _db;
}
