/**
 * Tests for server-side tier enforcement.
 * The frontend already gates Pro features in the UI, but anyone with
 * a session can `curl` the API directly. These tests prove the server
 * itself rejects non-Pro users from Pro-only endpoints.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

describe('Tier enforcement — AI routes', () => {
  it('blocks free user from POST /api/ai/summary', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/summary', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Pro/i);
    expect(body.upgradeUrl).toBe('/pricing');
  });

  it('blocks free user from POST /api/ai/qa', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/qa', {
      method: 'POST',
      body: JSON.stringify({ query: 'q', contexts: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks free user from POST /api/ai/flashcards', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/flashcards', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c', count: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks free user from POST /api/ai/practice-questions', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/practice-questions', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c', count: 4 }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks free user from POST /api/ai/insights', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/insights', {
      method: 'POST',
      body: JSON.stringify({ notes: [], flashcards: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks free user from POST /api/ai/rerank', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/rerank', {
      method: 'POST',
      body: JSON.stringify({ query: 'q', candidates: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('allows GET /api/ai/settings for free users (they may want to set up offline)', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.aISettings.findUnique.mockResolvedValueOnce(null);
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('blocks free user from PUT /api/ai/settings (server-side key storage is Pro)', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'gemini', model: 'gemini-1.5-flash', enabled: true, apiKey: 'k' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Tier enforcement — item limits', () => {
  it('blocks free user from creating note at 50-item limit', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.note.count.mockResolvedValueOnce(20);
    prismaMock.contact.count.mockResolvedValueOnce(20);
    prismaMock.flashcard.count.mockResolvedValueOnce(10); // total = 50

    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/50 items/);
    expect(body.limit).toBe(50);
    expect(body.currentCount).toBe(50);
  });

  it('allows free user to create note when under the limit', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.note.count.mockResolvedValueOnce(10);
    prismaMock.contact.count.mockResolvedValueOnce(5);
    prismaMock.flashcard.count.mockResolvedValueOnce(3); // total = 18
    prismaMock.note.create.mockResolvedValueOnce({ id: 'n1', title: 't', content: 'c' } as any);

    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c' }),
    });
    expect(res.status).toBe(201);
  });

  it('does not check the limit for Pro users', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.note.create.mockResolvedValueOnce({ id: 'n1' } as any);

    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'PRO' });
    const res = await request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c' }),
    });
    expect(res.status).toBe(201);
    // prismaMock.note.count should NOT have been called
    expect(prismaMock.note.count).not.toHaveBeenCalled();
  });
});
