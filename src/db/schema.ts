import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type {
  Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch,
  Achievement, StudyGoal, StudyTimerSession, NoteVersion, StudyGroup, SessionStat,
} from '../types';

// ── DB version history ────────────────────────────────────────────────────────
// v1 — initial: all stores created
// v2 — added `streaks` store (current streak, longest streak, daily counts)
// v3 — added `note_versions` store for version history snapshots
// v4 — added `flashcard_sessions` store for persisted review session stats

const DB_NAME    = 'studyworks-db';
const DB_VERSION = 4;

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
  note_versions: {
    key: string;          // composite: `${noteId}::${Date.now()}`
    value: NoteVersion;
    indexes: { by_note: string };
  };
  achievements: {
    key: string;
    value: Achievement;
  };
  study_goals: {
    key: string;
    value: StudyGoal;
  };
  study_sessions: {
    key: string;
    value: StudyTimerSession;
    indexes: { by_date: string };
  };
  study_groups: {
    key: string;
    value: StudyGroup;
  };
  flashcard_sessions: {
    key: string;
    value: SessionStat;
    indexes: { by_date: string };
  };
}

// ── Singleton DB promise ───────────────────────────────────────────────────────
let _db: IDBPDatabase<StudyWorksDB> | null = null;

/**
 * Create an object store only if it does not already exist.
 *
 * IndexedDB upgrade transactions abort entirely if `createObjectStore` throws
 * on a name that already exists, which would leave the database stuck at its
 * old version and break the app for that user permanently. A store can end
 * up pre-existing if an earlier upgrade was interrupted, so every store
 * creation below is guarded.
 */
function ensureStore(db: IDBPDatabase<any>, name: string, keyPath: string): void {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath });
  }
}

export async function getDB(): Promise<IDBPDatabase<StudyWorksDB>> {
  if (_db) return _db;

  _db = await openDB<StudyWorksDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v0 → v1: create all stores
      if (oldVersion < 1) {
        // notes
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('by_folder',  'folderId', { unique: false });
          notesStore.createIndex('by_type',    'type',     { unique: false });
          notesStore.createIndex('by_updated', 'updatedAt',{ unique: false });
        }

        // contacts
        if (!db.objectStoreNames.contains('contacts')) {
          const contactsStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactsStore.createIndex('by_folder', 'folderId', { unique: false });
        }

        // flashcards
        if (!db.objectStoreNames.contains('flashcards')) {
          const fcStore = db.createObjectStore('flashcards', { keyPath: 'id' });
          fcStore.createIndex('by_folder',     'folderId',   { unique: false });
          fcStore.createIndex('by_difficulty', 'difficulty', { unique: false });
          fcStore.createIndex('by_next_review','nextReview', { unique: false });
        }

        // folders
        ensureStore(db, 'folders', 'id');

        // practice questions
        if (!db.objectStoreNames.contains('practice_questions')) {
          const pqStore = db.createObjectStore('practice_questions', { keyPath: 'id' });
          pqStore.createIndex('by_note', 'noteId', { unique: false });
        }

        // saved searches
        ensureStore(db, 'saved_searches', 'id');

        // settings (theme, tier, counters)
        ensureStore(db, 'settings', 'key');
      }
      // v1 → v2: add streaks store
      if (oldVersion < 2) {
        ensureStore(db, 'streaks', 'id');
      }
      // v2 → v3: add note_versions, achievements, goals, sessions, study_groups
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('note_versions')) {
          const nvStore = db.createObjectStore('note_versions', { keyPath: 'id' });
          nvStore.createIndex('by_note', 'noteId', { unique: false });
        }
        ensureStore(db, 'achievements', 'id');
        ensureStore(db, 'study_goals', 'id');
        ensureStore(db, 'study_sessions', 'id');
        ensureStore(db, 'study_groups', 'id');
      }
      // v3 → v4: add flashcard_sessions store
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains('flashcard_sessions')) {
          const fsStore = db.createObjectStore('flashcard_sessions', { keyPath: 'id' });
          fsStore.createIndex('by_date', 'date', { unique: false });
        }
      }
    },
  });

  return _db;
}
