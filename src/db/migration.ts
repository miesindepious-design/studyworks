/**
 * One-time migration from localStorage → IndexedDB.
 * Runs once; sets 'idb-migrated-v1' in IndexedDB settings to skip on subsequent loads.
 * Safe to run even if localStorage is empty.
 */

import {
  notesDB, contactsDB, flashcardsDB, foldersDB,
  practiceQuestionsDB, savedSearchesDB, settingsDB,
} from './helpers';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';

function reviveDates<T>(obj: any, dateFields: string[]): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const field of dateFields) {
    if (result[field]) result[field] = new Date(result[field]);
  }
  return result as T;
}

function parseLS<T>(key: string, dateFields: string[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as any[]).map(item => reviveDates<T>(item, dateFields));
  } catch {
    return [];
  }
}

export async function migrateFromLocalStorage(): Promise<void> {
  // Already migrated?
  const done = await settingsDB.get('idb-migrated-v1');
  if (done === '1') return;

  console.info('[StudyWorks] Migrating data from localStorage → IndexedDB…');

  const notes = parseLS<Note>('studyworks-notes', ['createdAt', 'updatedAt', 'lastRevisited', 'nextReminder']);
  const contacts = parseLS<Contact>('studyworks-contacts', ['lastContacted', 'nextReminder']);
  const flashcards = parseLS<Flashcard>('studyworks-flashcards', ['createdAt', 'nextReview']);
  const pqs = parseLS<PracticeQuestion>('studyworks-practice-questions', ['createdAt']);
  const searches = parseLS<SavedSearch>('studyworks-saved-searches', ['createdAt']);

  // Folders: either from LS or create the default
  const rawFolders = parseLS<Folder>('studyworks-folders', ['createdAt']);
  const folders: Folder[] = rawFolders.length > 0
    ? rawFolders
    : [{ id: 'default', name: 'All Items', createdAt: new Date() }];

  // Bulk-write everything
  await Promise.all([
    notes.length     ? notesDB.putAll(notes)                   : Promise.resolve(),
    contacts.length  ? contactsDB.putAll(contacts)             : Promise.resolve(),
    flashcards.length? flashcardsDB.putAll(flashcards)         : Promise.resolve(),
    foldersDB.putAll(folders),
    pqs.length       ? practiceQuestionsDB.putAll(pqs)         : Promise.resolve(),
    searches.length  ? savedSearchesDB.putAll(searches)        : Promise.resolve(),
  ]);

  // Migrate settings
  const theme = localStorage.getItem('studyworks-theme');
  const tier  = localStorage.getItem('studyworks-tier');
  const onboarded = localStorage.getItem('studyworks-onboarding-done');
  if (theme)    await settingsDB.set('theme', theme);
  if (tier)     await settingsDB.set('tier', tier);
  if (onboarded) await settingsDB.set('onboarding-done', onboarded);

  // Migrate monthly counters
  const aiRaw = localStorage.getItem('studyworks-ai-summaries');
  const qaRaw = localStorage.getItem('studyworks-qa-queries');
  if (aiRaw) await settingsDB.set('ai-summaries', aiRaw);
  if (qaRaw) await settingsDB.set('qa-queries', qaRaw);

  // Mark migration done
  await settingsDB.set('idb-migrated-v1', '1');

  // Clean up localStorage (keep it minimal — remove bulky data)
  const keysToRemove = [
    'studyworks-notes', 'studyworks-contacts', 'studyworks-flashcards',
    'studyworks-folders', 'studyworks-practice-questions', 'studyworks-saved-searches',
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  console.info(`[StudyWorks] Migration complete — ${notes.length} notes, ${contacts.length} contacts, ${flashcards.length} flashcards.`);
}
