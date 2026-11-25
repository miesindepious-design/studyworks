/**
 * Tests for the cloud sync LWW (last-write-wins) merge.
 *
 * Before the fix: push() did unconditional upsert — pushing an older copy
 * would clobber a newer one. After the fix: only incoming records with
 * `updatedAt >= existing.updatedAt` are applied; older ones are rejected
 * and counted as conflicts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

const baseUser = { id: 'u1', email: 'a@b.com', name: 'A', tier: 'PRO' as const };

describe('Sync LWW — push endpoint', () => {
  it('applies a note when no existing record', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.folder.upsert.mockResolvedValue({} as any);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'Hello', content: 'world', tags: [], type: 'note',
          createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z',
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stats.notes).toBe(1);
    expect(body.stats.conflicts).toBe(0);
    expect(prismaMock.note.upsert).toHaveBeenCalledOnce();
  });

  it('overwrites when incoming note is newer', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue({
      updatedAt: new Date('2026-07-13T10:00:00.000Z'), // server is older
    } as any);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'Newer', content: 'world', tags: [], type: 'note',
          createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T11:00:00.000Z',
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.notes).toBe(1);
    expect(body.stats.conflicts).toBe(0);
  });

  it('REJECTS incoming note when server copy is newer (data loss protection)', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue({
      updatedAt: new Date('2026-07-13T12:00:00.000Z'), // server is newer
    } as any);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'Stale', content: 'world', tags: [], type: 'note',
          createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:30:00.000Z', // older!
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.notes).toBe(0);          // not applied
    expect(body.stats.conflicts).toBe(1);      // counted as conflict
    expect(prismaMock.note.upsert).not.toHaveBeenCalled(); // CRITICAL: never wrote
  });

  it('applies incoming note when timestamps are equal (idempotent)', async () => {
    const { request, login } = await buildTestApp();
    const sameTime = '2026-07-13T10:00:00.000Z';
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue({ updatedAt: new Date(sameTime) } as any);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'Tied', content: 'world', tags: [], type: 'note',
          createdAt: sameTime, updatedAt: sameTime,
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.notes).toBe(1);
    expect(body.stats.conflicts).toBe(0);
  });

  it('keeps a flashcard\'s shape, subject, leech count and review trail', async () => {
    // These fields were missing from the input schema, so Zod stripped them
    // from every push and the server stored a card with no subject, no
    // review history and no leech count. That silently broke the Mastery Map
    // and reset the spaced-repetition history on the server copy.
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.upsert.mockResolvedValue({} as any);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [], contacts: [], folders: [], savedSearches: [],
        practiceQuestions: [],
        flashcards: [{
          id: 'f1', question: 'Q', answer: 'A', tags: [],
          type: 'cloze', topic: 'Biology', leechCount: 2, source: 'ai',
          reviewHistory: [{ date: '2026-01-10', quality: 0 }],
          createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-11T10:00:00.000Z',
        }],
      }),
    });
    expect(res.status).toBe(200);

    const call = prismaMock.flashcard.upsert.mock.calls[0][0] as any;
    expect(call.update.type).toBe('cloze');
    expect(call.update.topic).toBe('Biology');
    expect(call.update.leechCount).toBe(2);
    expect(call.update.source).toBe('ai');
    expect(call.update.reviewHistory).toEqual([{ date: '2026-01-10', quality: 0 }]);
  });

  it('keeps a practice question\'s subject', async () => {
    // Like the flashcard fields above, `topic` was stripped on push, which
    // quietly emptied practice questions out of the Mastery Map.
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.create.mockResolvedValue({} as any);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [], contacts: [], flashcards: [], folders: [], savedSearches: [],
        practiceQuestions: [{
          id: 'pq1', question: 'Q', answer: 'A', type: 'open', options: [], topic: 'Quadratics',
          createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-11T10:00:00.000Z',
        }],
      }),
    });
    expect(res.status).toBe(200);

    const call = prismaMock.practiceQuestion.create.mock.calls[0][0] as any;
    expect(call.data.topic).toBe('Quadratics');
  });

  it('saves a note\'s highlights and personal notes', async () => {
    // Highlights were pulled from the server but never written back to it,
    // so anything the student highlighted on one device was missing on
    // every other device.
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'T', content: 'C', tags: [], type: 'note',
          highlights: [{ id: 'h1', text: 'important bit', color: '#fde68a', createdAt: '2026-01-10T10:00:00.000Z' }],
          personalNotes: [{ id: 'pn1', content: 'my thought', createdAt: '2026-01-10T10:00:00.000Z', updatedAt: '2026-01-10T10:00:00.000Z' }],
          createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-11T10:00:00.000Z',
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);

    const call = prismaMock.note.upsert.mock.calls[0][0] as any;
    expect(call.update.highlights.create).toHaveLength(1);
    expect(call.update.highlights.create[0].text).toBe('important bit');
    expect(call.update.personalNotes.create).toHaveLength(1);
    expect(call.update.personalNotes.create[0].content).toBe('my thought');
  });

  it('keeps a note\'s spaced-repetition state', async () => {
    // Without these in the schema, Zod stripped them from every push and a
    // note's schedule was reset on every sync — so a note due in three days
    // came back due immediately on the next device.
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.note.upsert.mockResolvedValue({} as any);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        notes: [{
          id: 'n1', title: 'T', content: 'C', tags: [], type: 'note',
          repetitions: 4, interval: 12, ef: 2.6, leechCount: 1,
          nextReview: '2026-01-20T09:00:00.000Z',
          reviewHistory: [{ date: '2026-01-10', quality: 2 }],
          createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-11T10:00:00.000Z',
        }],
        contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);

    const call = prismaMock.note.upsert.mock.calls[0][0] as any;
    expect(call.update.repetitions).toBe(4);
    expect(call.update.interval).toBe(12);
    expect(call.update.ef).toBe(2.6);
    expect(call.update.leechCount).toBe(1);
    expect(call.update.nextReview).toBeInstanceOf(Date);
    expect(call.update.reviewHistory).toEqual([{ date: '2026-01-10', quality: 2 }]);
  });

  it('protects contacts the same way', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.folder.findUnique.mockResolvedValue(null);
    prismaMock.note.findUnique.mockResolvedValue(null);
    prismaMock.contact.findUnique.mockResolvedValue({
      updatedAt: new Date('2026-07-13T12:00:00.000Z'),
    } as any);
    prismaMock.flashcard.findUnique.mockResolvedValue(null);
    prismaMock.practiceQuestion.findUnique.mockResolvedValue(null);
    prismaMock.savedSearch.findUnique.mockResolvedValue(null);

    login(baseUser);
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        contacts: [{
          id: 'c1', name: 'Older', role: 'r', tags: [],
          createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:30:00.000Z',
        }],
        notes: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.contacts).toBe(0);
    expect(body.stats.conflicts).toBe(1);
    expect(prismaMock.contact.upsert).not.toHaveBeenCalled();
  });
});
