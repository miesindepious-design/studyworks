/**
 * Cloud sync API — pull all user data from server, push local changes up.
 * The frontend uses IndexedDB as the local cache; the server is the source of truth.
 */

import { apiGet, apiPost } from './client';
import type { Note, Contact, Flashcard, Folder, SavedSearch } from '../types';

function revivePractice(q: any): import('../types').PracticeQuestion {
  return {
    ...q,
    createdAt: new Date(q.createdAt),
    updatedAt: q.updatedAt ? new Date(q.updatedAt) : undefined,
    nextReview: q.nextReview ? new Date(q.nextReview) : undefined,
    ef:         typeof q.ef === 'number' ? q.ef : 2.5,
  };
}

export interface SyncPullResponse {
  tier:              'FREE' | 'PRO';
  notes:             Note[];
  contacts:          Contact[];
  flashcards:        Flashcard[];
  folders:           Folder[];
  practiceQuestions: import('../types').PracticeQuestion[];
  savedSearches:     SavedSearch[];
  aiSettings: {
    provider:             string;
    model:                string;
    enabled:              boolean;
    hasApiKey:            boolean;
    customSummaryPrompt:  string | null;
    customFlashcardPrompt: string | null;
    customQAPrompt:       string | null;
  } | null;
}

// ── Pull all user data from server ────────────────────────────────────────────
export async function pullSync(): Promise<SyncPullResponse> {
  const data = await apiGet<SyncPullResponse>('/api/sync');

  // Revive Date fields
  return {
    ...data,
    notes: data.notes.map(reviveNote),
    contacts: data.contacts.map(reviveContact),
    flashcards: data.flashcards.map(reviveFlashcard),
    folders: data.folders.map(f => ({ ...f, createdAt: new Date(f.createdAt) })),
    practiceQuestions: data.practiceQuestions.map(revivePractice),
    savedSearches: data.savedSearches.map(s => ({ ...s, createdAt: new Date(s.createdAt) })),
  };
}

// ── Push local state to server ────────────────────────────────────────────────
export interface SyncPushPayload {
  notes:             Note[];
  contacts:          Contact[];
  flashcards:        Flashcard[];
  folders:           Folder[];
  practiceQuestions: import('../types').PracticeQuestion[];
  savedSearches:     SavedSearch[];
}

export async function pushSync(payload: SyncPushPayload): Promise<void> {
  await apiPost('/api/sync', {
    notes:             payload.notes.map(n => ({ ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(), nextReminder: n.nextReminder?.toISOString() ?? null })),
    contacts:          payload.contacts.map(c => ({ ...c, createdAt: (c as any).createdAt?.toISOString?.() ?? new Date().toISOString(), updatedAt: (c as any).updatedAt?.toISOString?.() ?? new Date().toISOString(), nextReminder: c.nextReminder?.toISOString() ?? null, lastContacted: c.lastContacted?.toISOString() ?? null })),
    flashcards:        payload.flashcards.map(f => ({ ...f, ef: f.ef ?? 2.5, createdAt: f.createdAt.toISOString(), updatedAt: (f as any).updatedAt?.toISOString?.() ?? new Date().toISOString(), nextReview: f.nextReview?.toISOString() ?? null })),
    folders:           payload.folders.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
    practiceQuestions: payload.practiceQuestions.map(q => ({ ...q, createdAt: q.createdAt.toISOString(), nextReview: q.nextReview?.toISOString() ?? null })),
    savedSearches:     payload.savedSearches.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
  });
}

// ── Date revival helpers ──────────────────────────────────────────────────────
function reviveNote(n: any): Note {
  return {
    ...n,
    createdAt:    new Date(n.createdAt),
    updatedAt:    new Date(n.updatedAt),
    nextReminder: n.nextReminder ? new Date(n.nextReminder) : undefined,
    highlights:   (n.highlights || []).map((h: any) => ({ ...h, createdAt: new Date(h.createdAt) })),
    personalNotes: (n.personalNotes || []).map((p: any) => ({ ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) })),
    files: (n.attachments || n.files || []).map((a: any) => ({
      id:         a.id,
      name:       a.name,
      type:       a.type,
      url:        a.url,
      size:       a.size,
      uploadedAt: new Date(a.uploadedAt),
    })),
  };
}

function reviveContact(c: any): Contact {
  return {
    ...c,
    createdAt:    new Date(c.createdAt ?? Date.now()),
    updatedAt:    new Date(c.updatedAt ?? Date.now()),
    nextReminder: c.nextReminder  ? new Date(c.nextReminder)  : undefined,
    lastContacted: c.lastContacted ? new Date(c.lastContacted) : undefined,
  };
}

function reviveFlashcard(f: any): Flashcard {
  return {
    ...f,
    createdAt:  new Date(f.createdAt),
    updatedAt:  new Date(f.updatedAt ?? f.createdAt),
    nextReview: f.nextReview ? new Date(f.nextReview) : undefined,
    ef:         typeof f.ef === 'number' ? f.ef : 2.5,
  };
}
