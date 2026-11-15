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
});

describe('Tier enforcement — BYOK (bring your own key)', () => {
  // A free-plan user who connected their own Google AI Studio key during
  // registration must get access to the AI features — that is what the
  // onboarding flow promises. requireAI allows PRO/trial OR an own key.

  const ownKeySettings = {
    id: 's1', userId: 'u1', provider: 'gemini', model: 'gemini-4-hydrogen',
    enabled: true, encryptedApiKey: 'enc:secret',
    customSummaryPrompt: null, customFlashcardPrompt: null, customQAPrompt: null,
  };

  beforeEach(() => {
    prismaMock.aISettings.findUnique.mockResolvedValue(ownKeySettings as any);
    prismaMock.aISettings.upsert.mockImplementation((args: any) => Promise.resolve({
      ...ownKeySettings, ...args.update, encryptedApiKey: 'enc:secret',
    } as any));
  });

  it('allows a free user WITH an own key to POST /api/ai/summary', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/summary', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c' }),
    });
    // 400/502 means the route ran (the AI call itself is unmocked); 403 means blocked.
    expect(res.status).not.toBe(403);
  });

  it('allows a free user WITH an own key to POST /api/ai/flashcards', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/flashcards', {
      method: 'POST',
      body: JSON.stringify({ title: 't', content: 'c', count: 5 }),
    });
    expect(res.status).not.toBe(403);
  });

  it('allows a free user WITH an own key to POST /api/ai/tutor', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/tutor', {
      method: 'POST',
      body: JSON.stringify({ topic: 'photosynthesis' }),
    });
    expect(res.status).not.toBe(403);
  });

  it('GET /settings reports hasOwnKey and canUseAI for a BYOK free user', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasOwnKey).toBe(true);
    expect(body.canUseAI).toBe(true);
    expect(body.hasApiKey).toBe(true);
    expect(body.apiKey).toBeUndefined();
  });

  it('GET /settings reports canUseAI=false for a free user with no key and no fallback', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.aISettings.findUnique.mockResolvedValue(null);
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', { method: 'GET' });
    const body = await res.json();
    expect(body.hasOwnKey).toBe(false);
    expect(body.canUseAI).toBe(false);
    expect(body.serverManaged).toBe(false);
  });

  it('PUT /api/ai/settings lets a free user store their own key (registration flow)', async () => {
    const { request, login } = await buildTestApp();
    prismaMock.aISettings.findUnique.mockResolvedValue(null);
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'gemini', model: 'gemini-4-hydrogen', enabled: true,
        apiKey: 'AIzaSyFakeKeyForTest0000000',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasOwnKey).toBe(true);
    expect(body.canUseAI).toBe(true);
    // The stored value must be encrypted, never the plaintext key.
    expect(prismaMock.aISettings.upsert).toHaveBeenCalled();
    const call = prismaMock.aISettings.upsert.mock.calls[0][0];
    expect(call.update.encryptedApiKey).not.toBe('AIzaSyFakeKeyForTest0000000');
    expect(String(call.update.encryptedApiKey)).not.toContain('AIza');
  });

  it('PUT /api/ai/settings keeps the stored key when apiKey is empty', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/settings', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', enabled: true, apiKey: '' }),
    });
    expect(res.status).toBe(200);
    const call = prismaMock.aISettings.upsert.mock.calls[0][0];
    expect(call.update.encryptedApiKey).toBe('enc:secret');
  });

  it('POST /api/ai/test validates an unsaved key without persisting it', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    // Mock the provider call: callProvider does a global fetch to Gemini.
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    }), { status: 200 }));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;
    try {
      const res = await request('/api/ai/test', {
        method: 'POST',
        body: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', apiKey: 'AIzaSyTest123' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(prismaMock.aISettings.upsert).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('POST /api/ai/test reports ok=false for an invalid key', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'API key not valid' },
    }), { status: 400 }));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;
    try {
      const res = await request('/api/ai/test', {
        method: 'POST',
        body: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', apiKey: 'bad-key' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/not valid/i);
    } finally {
      globalThis.fetch = savedFetch;
    }
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
