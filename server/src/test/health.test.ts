/**
 * Smoke tests for /health and the requireAuth middleware.
 * Verifies the basic wiring is correct and the test harness works.
 */
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers.js';
import { prismaMock } from './setup.js';

describe('Health check', () => {
  it('returns ok status', async () => {
    const { request } = await buildTestApp();
    const res = await request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});

describe('Auth middleware', () => {
  it('rejects unauthenticated requests to /api/sync', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/sync', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST to /api/sync', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ notes: [], contacts: [], flashcards: [], folders: [], practiceQuestions: [], savedSearches: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('allows authenticated GET /api/sync', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.note.findMany.mockResolvedValueOnce([]);
    prismaMock.contact.findMany.mockResolvedValueOnce([]);
    prismaMock.flashcard.findMany.mockResolvedValueOnce([]);
    prismaMock.folder.findMany.mockResolvedValueOnce([]);
    prismaMock.practiceQuestion.findMany.mockResolvedValueOnce([]);
    prismaMock.savedSearch.findMany.mockResolvedValueOnce([]);
    prismaMock.aISettings.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({ tier: 'FREE' });

    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/sync', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('FREE');
    expect(body.notes).toEqual([]);
  });
});
