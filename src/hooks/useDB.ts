/**
 * useDB — loads all app data from IndexedDB on mount (after migration),
 * and provides setter functions that write-through to IDB immediately.
 *
 * Setters are diffing: they compute added/changed/removed vs the previous
 * state and emit put/delete transactions instead of clear()+putAll(). This
 * matters for two reasons:
 *   1. Cloud sync push (App.tsx → pushSync) and pull (→ remote.notes) won't
 *      race a wholesale clear+rewrite of an entire collection on every
 *      keystroke. Earlier versions called clear() and putAll() on every
 *      setter, which was both slow and unsafe under concurrent reads.
 *   2. Each IDB write becomes a minimal, observable transaction that can
 *      be reasoned about.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { migrateFromLocalStorage } from '../db/migration';
import {
  notesDB, contactsDB, flashcardsDB, foldersDB,
  practiceQuestionsDB, savedSearchesDB, settingsDB,
} from '../db/helpers';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';
import { buildStarterPack } from '../lib/studentTemplates';

export type DBStatus = 'loading' | 'ready' | 'error';

export interface UseDBResult {
  status: DBStatus;

  // Data
  notes:             Note[];
  contacts:          Contact[];
  flashcards:        Flashcard[];
  folders:           Folder[];
  practiceQuestions: PracticeQuestion[];
  savedSearches:     SavedSearch[];

  // Settings
  theme:    string;
  tier:     string;
  xp:       number;
  onboardingDone: boolean;
  aiSummariesThisMonth: number;
  qaQueriesThisMonth:   number;

  // Setters (write-through to IDB; diffing — only changed rows are written)
  setNotes:             (next: Note[])             => void;
  setContacts:          (next: Contact[])          => void;
  setFlashcards:        (next: Flashcard[])        => void;
  setFolders:           (next: Folder[])           => void;
  setPracticeQuestions: (next: PracticeQuestion[]) => void;
  setSavedSearches:     (next: SavedSearch[])      => void;

  setTheme:             (v: string) => void;
  setTier:              (v: string) => void;
  setXp:                (v: number | ((prev: number) => number)) => void;
  setOnboardingDone:    ()          => void;
  setAiSummariesThisMonth: (n: number) => void;
  setQaQueriesThisMonth:   (n: number) => void;
  /** Load the exam-prep starter pack (subject folders + sample notes + flashcards). */
  loadStarterPack:        () => void;
}

function parseCounter(raw: string | null): { count: number; date: string } {
  try { return raw ? JSON.parse(raw) : { count: 0, date: new Date().toISOString() }; }
  catch { return { count: 0, date: new Date().toISOString() }; }
}

function isCounterFresh(raw: string | null): boolean {
  const p = parseCounter(raw);
  const now = new Date(), d = new Date(p.date);
  return now.getMonth() === d.getMonth() && now.getFullYear() === d.getFullYear();
}

/**
 * Diff two arrays by `id` and apply add/change/delete to the store.
 * Each collection has the same shape: every item has a stable `id`, and the
 * new array is the desired state. Items present in `next` but not in `prev`
 * get `put`. Items in both get `put` (cheaper than read-then-compare; IDB
 * dedupes by key). Items in `prev` but not in `next` get `delete`.
 */
async function diffAndPersist<T extends { id: string }>(
  store: { put: (v: T) => Promise<void>; delete: (id: string) => Promise<void> },
  prev: T[],
  next: T[]
): Promise<void> {
  const prevById = new Map(prev.map(item => [item.id, item]));
  const nextById = new Map(next.map(item => [item.id, item]));

  const toPut:   T[] = [];
  const toDel:   string[] = [];

  for (const [id, item] of nextById) {
    const old = prevById.get(id);
    // Always put — even if `old === item` reference-wise, contents may differ
    // (e.g. array mapped from server). Cheap for IDB.
    if (!old || old !== item) toPut.push(item);
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) toDel.push(id);
  }

  if (toPut.length === 0 && toDel.length === 0) return;

  await Promise.all([
    ...toPut.map(item => store.put(item)),
    ...toDel.map(id => store.delete(id)),
  ]);
}

export function useDB(): UseDBResult {
  const [status, setStatus]   = useState<DBStatus>('loading');

  const [notes,             setNotesState]             = useState<Note[]>([]);
  const [contacts,          setContactsState]          = useState<Contact[]>([]);
  const [flashcards,        setFlashcardsState]        = useState<Flashcard[]>([]);
  const [folders,           setFoldersState]           = useState<Folder[]>([{ id: 'default', name: 'All Items', createdAt: new Date() }]);
  const [practiceQuestions, setPracticeQuestionsState] = useState<PracticeQuestion[]>([]);
  const [savedSearches,     setSavedSearchesState]     = useState<SavedSearch[]>([]);

  const [theme,    setThemeState]    = useState('system');
  const [tier,     setTierState]     = useState('free');
  const [xp,       setXpState]       = useState(0);
  const [onboardingDone, setOnboardingDoneState] = useState(false);
  const [aiSummariesThisMonth, setAiState] = useState(0);
  const [qaQueriesThisMonth,   setQaState] = useState(0);

  // Keep a ref to the latest state so diffing setters can compute prev/next
  // without going through stale closures.
  const notesRef             = useRef<Note[]>([]);
  const contactsRef          = useRef<Contact[]>([]);
  const flashcardsRef        = useRef<Flashcard[]>([]);
  const foldersRef           = useRef<Folder[]>([]);
  const practiceQuestionsRef = useRef<PracticeQuestion[]>([]);
  const savedSearchesRef     = useRef<SavedSearch[]>([]);

  // ── Boot: migrate then load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateFromLocalStorage();

        const [n, c, f, fo, pq, ss] = await Promise.all([
          notesDB.getAll(),
          contactsDB.getAll(),
          flashcardsDB.getAll(),
          foldersDB.getAll(),
          practiceQuestionsDB.getAll(),
          savedSearchesDB.getAll(),
        ]);

        const [
          themeVal, tierVal, xpVal, onboardedVal, aiRaw, qaRaw,
        ] = await Promise.all([
          settingsDB.get('theme'),
          settingsDB.get('tier'),
          settingsDB.get('xp'),
          settingsDB.get('onboarding-done'),
          settingsDB.get('ai-summaries'),
          settingsDB.get('qa-queries'),
        ]);

        if (cancelled) return;

        setNotesState(n);
        setContactsState(c);
        setFlashcardsState(f);
        setFoldersState(fo.length ? fo : [{ id: 'default', name: 'All Items', createdAt: new Date() }]);
        setPracticeQuestionsState(pq);
        setSavedSearchesState(ss);

        notesRef.current             = n;
        contactsRef.current          = c;
        flashcardsRef.current        = f;
        foldersRef.current           = fo.length ? fo : [{ id: 'default', name: 'All Items', createdAt: new Date() }];
        practiceQuestionsRef.current = pq;
        savedSearchesRef.current     = ss;

        if (themeVal)    setThemeState(themeVal);
        if (tierVal)     setTierState(tierVal);
        if (xpVal != null) setXpState(Number(xpVal) || 0);
        if (onboardedVal === '1') setOnboardingDoneState(true);

        const aiCount = isCounterFresh(aiRaw) ? parseCounter(aiRaw).count : 0;
        const qaCount = isCounterFresh(qaRaw) ? parseCounter(qaRaw).count : 0;
        setAiState(aiCount);
        setQaState(qaCount);

        setStatus('ready');
      } catch (err) {
        console.error('[StudyWorks] IDB load failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Diffing write-through setters ────────────────────────────────────────
  const setNotes = useCallback((next: Note[]) => {
    const prev = notesRef.current;
    notesRef.current = next;
    setNotesState(next);
    diffAndPersist(notesDB, prev, next).catch(err =>
      console.error('[StudyWorks] notes diff persist failed:', err));
  }, []);

  const setContacts = useCallback((next: Contact[]) => {
    const prev = contactsRef.current;
    contactsRef.current = next;
    setContactsState(next);
    diffAndPersist(contactsDB, prev, next).catch(err =>
      console.error('[StudyWorks] contacts diff persist failed:', err));
  }, []);

  const setFlashcards = useCallback((next: Flashcard[]) => {
    const prev = flashcardsRef.current;
    flashcardsRef.current = next;
    setFlashcardsState(next);
    diffAndPersist(flashcardsDB, prev, next).catch(err =>
      console.error('[StudyWorks] flashcards diff persist failed:', err));
  }, []);

  const setFolders = useCallback((next: Folder[]) => {
    const prev = foldersRef.current;
    foldersRef.current = next;
    setFoldersState(next);
    diffAndPersist(foldersDB, prev, next).catch(err =>
      console.error('[StudyWorks] folders diff persist failed:', err));
  }, []);

  const setPracticeQuestions = useCallback((next: PracticeQuestion[]) => {
    const prev = practiceQuestionsRef.current;
    practiceQuestionsRef.current = next;
    setPracticeQuestionsState(next);
    diffAndPersist(practiceQuestionsDB, prev, next).catch(err =>
      console.error('[StudyWorks] practice diff persist failed:', err));
  }, []);

  const setSavedSearches = useCallback((next: SavedSearch[]) => {
    const prev = savedSearchesRef.current;
    savedSearchesRef.current = next;
    setSavedSearchesState(next);
    diffAndPersist(savedSearchesDB, prev, next).catch(err =>
      console.error('[StudyWorks] savedSearches diff persist failed:', err));
  }, []);

  // Append the exam-prep starter pack (subject folders + sample notes +
  // flashcards) without clobbering anything the user already has.
  const loadStarterPack = useCallback(() => {
    const pack = buildStarterPack();
    setFolders([...foldersRef.current, ...pack.folders]);
    setNotes([...notesRef.current, ...pack.notes]);
    setFlashcards([...flashcardsRef.current, ...pack.flashcards]);
  }, [setFolders, setNotes, setFlashcards]);

  const setTheme = useCallback((v: string) => {
    setThemeState(v);
    settingsDB.set('theme', v);
  }, []);

  const setTier = useCallback((v: string) => {
    setTierState(v);
    settingsDB.set('tier', v);
  }, []);

  const setXp = useCallback((v: number | ((prev: number) => number)) => {
    setXpState(prev => {
      const next = typeof v === 'function' ? (v as (p: number) => number)(prev) : v;
      settingsDB.set('xp', String(next));
      return next;
    });
  }, []);

  const setOnboardingDone = useCallback(() => {
    setOnboardingDoneState(true);
    settingsDB.set('onboarding-done', '1');
  }, []);

  const setAiSummariesThisMonth = useCallback((n: number) => {
    setAiState(n);
    settingsDB.set('ai-summaries', JSON.stringify({ count: n, date: new Date().toISOString() }));
  }, []);

  const setQaQueriesThisMonth = useCallback((n: number) => {
    setQaState(n);
    settingsDB.set('qa-queries', JSON.stringify({ count: n, date: new Date().toISOString() }));
  }, []);

  return {
    status,
    notes, contacts, flashcards, folders, practiceQuestions, savedSearches,
    theme, tier, xp, onboardingDone,
    aiSummariesThisMonth, qaQueriesThisMonth,
    setNotes, setContacts, setFlashcards, setFolders, setPracticeQuestions, setSavedSearches,
    setTheme, setTier, setXp, setOnboardingDone,
    setAiSummariesThisMonth, setQaQueriesThisMonth,
    loadStarterPack,
  };
}
