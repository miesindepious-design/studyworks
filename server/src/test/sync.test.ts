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
