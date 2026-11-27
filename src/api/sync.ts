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
    // The subject is what files a question under a heading in the Mastery
    // Map, so it has to survive the round-trip.
    topic:      q.topic ?? undefined,
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
    notes: payload.notes.map(n => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      nextReminder: n.nextReminder?.toISOString() ?? null,
      // When the note was last opened on this device.  The server only
      // overwrites this if the incoming value is non-null, so the most
      // recent "last opened" across all devices wins.
      lastRevisited: n.lastRevisited instanceof Date
        ? n.lastRevisited.toISOString()
        : (n.lastRevisited ?? null),
      // The note's spaced-repetition state travels with it, so a note that
      // is due in three days stays due in three days on the other device.
      nextReview:  n.nextReview?.toISOString() ?? null,
      repetitions: n.repetitions ?? 0,
      interval:    n.interval ?? 0,
      ef:          n.ef ?? 2.5,
      leechCount:  n.leechCount ?? 0,
      reviewHistory: n.reviewHistory ?? [],
      // Highlights and personal notes are part of the note, so they travel
      // with it. The server replaces its copy wholesale with what is sent
      // here, which keeps every device showing the same annotations.
      highlights: (n.highlights ?? []).map(h => ({
        id: h.id,
        text: h.text,
        color: h.color,
        note: h.note ?? null,
        createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : h.createdAt,
      })),
      personalNotes: (n.personalNotes ?? []).map(p => ({
        id: p.id,
        content: p.content,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
      })),
    })),
    contacts:          payload.contacts.map(c => ({ ...c, createdAt: (c as any).createdAt?.toISOString?.() ?? new Date().toISOString(), updatedAt: (c as any).updatedAt?.toISOString?.() ?? new Date().toISOString(), nextReminder: c.nextReminder?.toISOString() ?? null, lastContacted: c.lastContacted?.toISOString() ?? null })),
    // The fields below were being stripped by the server's input schema, so
    // a card's shape, subject, leech count, origin and review trail were all
    // lost on every push. They are now part of the contract.
    flashcards:        payload.flashcards.map(f => ({
      ...f,
      ef: f.ef ?? 2.5,
      createdAt: f.createdAt.toISOString(),
      updatedAt: (f as any).updatedAt?.toISOString?.() ?? new Date().toISOString(),
      nextReview: f.nextReview?.toISOString() ?? null,
      type: f.type ?? 'standard',
      topic: f.topic ?? null,
      leechCount: f.leechCount ?? 0,
      source: f.source ?? null,
      reviewHistory: f.reviewHistory ?? [],
    })),
    folders:           payload.folders.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
    practiceQuestions: payload.practiceQuestions.map(q => ({
      ...q,
      createdAt: q.createdAt.toISOString(),
      nextReview: q.nextReview?.toISOString() ?? null,
      topic: q.topic ?? null,
    })),
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
    // When the note was last opened on any device.
    lastRevisited: n.lastRevisited ? new Date(n.lastRevisited) : undefined,
    // The note's spaced-repetition state, with the same defaults the card
    // revive uses, so every consumer can rely on these being present.
    nextReview:  n.nextReview ? new Date(n.nextReview) : undefined,
    repetitions: typeof n.repetitions === 'number' ? n.repetitions : 0,
    interval:    typeof n.interval === 'number' ? n.interval : 0,
    ef:          typeof n.ef === 'number' ? n.ef : 2.5,
    leechCount:  typeof n.leechCount === 'number' ? n.leechCount : 0,
    reviewHistory: Array.isArray(n.reviewHistory) ? n.reviewHistory : [],
    // The server sends highlights and personal notes as child relations
    // (`n.highlights` / `n.personalNotes`), while the client stores them
    // under those same names. The dates arrive as ISO strings.
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
    // A card that has never been reviewed has no shape, subject or history.
    // Filling in the defaults here means every consumer can rely on these
    // fields being present after a pull.
    type:        f.type ?? 'standard',
    topic:       f.topic ?? undefined,
    leechCount:  typeof f.leechCount === 'number' ? f.leechCount : 0,
    source:      f.source ?? undefined,
    reviewHistory: Array.isArray(f.reviewHistory) ? f.reviewHistory : [],
  };
}
