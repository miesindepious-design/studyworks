/**
 * Tests for the Socratic tutor mode.
 *
 * A Socratic session is a conversation, not a single answer: the tutor asks
 * a question, the student replies, and the reply becomes the next question.
 * What is proven here:
 *
 *   1. the server asks for the Socratic rules — one question, no answers;
 *   2. the student's answer reaches the model as the turn's answer;
 *   3. the topic stays in view on every turn of the session;
 *   4. a Socratic reply is short and carries no key-points block, because a
 *      list of key points is exactly what the student is being asked to
 *      work out for themselves.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { encryptApiKey } from '../lib/encryption.js';

function geminiReply(text: string) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }), { status: 200 });
}

function withFetch(mock: ReturnType<typeof vi.fn>) {
  const saved = globalThis.fetch;
  globalThis.fetch = mock as any;
  return () => { globalThis.fetch = saved; };
}

const OWN_KEY_SETTINGS = {
  id: 's1',
  userId: 'u1',
  provider: 'gemini',
  model: 'gemini-4-hydrogen',
  enabled: true,
  encryptedApiKey: encryptApiKey('AIzaSyFakeKeyForTest0000000'),
  customSummaryPrompt: null,
  customFlashcardPrompt: null,
  customQAPrompt: null,
};

const TUTOR_QUESTION = 'What is the primary input that makes photosynthesis possible?';

describe('POST /api/ai/tutor — socratic mode', () => {
  beforeEach(() => {
    prismaMock.aISettings.findUnique.mockResolvedValue(OWN_KEY_SETTINGS as any);
  });

  it('asks the model to lead the student instead of answering', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(TUTOR_QUESTION));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'socratic' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toContain('photosynthesis');
      expect(body.response).toContain('primary input');

      // The system prompt is where the Socratic contract lives.
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const system = payload.systemInstruction?.parts?.[0]?.text ?? '';
      expect(system).toContain('Socratic');
      expect(system).toContain('EXACTLY ONE question');
      expect(system).toContain('Never state the answer');
    } finally {
      restore();
    }
  });

  it('sends the student answer and keeps the topic in view', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('Good. And where is that energy captured?'));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({
          topic: 'photosynthesis',
          mode: 'socratic',
          lastAnswer: 'sunlight, water and CO2',
        }),
      });
      expect(res.status).toBe(200);

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const userTurn = payload.contents
        .map((c: any) => c.parts?.[0]?.text ?? '')
        .join('\n');
      expect(userTurn).toContain('sunlight, water and CO2');
      // The topic must never fall out of view mid-session, or the model
      // loses what it is leading the student towards.
      expect(userTurn).toContain('photosynthesis');
    } finally {
      restore();
    }
  });

  it('does not ask for a key-points block', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(TUTOR_QUESTION));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'socratic' }),
      });
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const system = payload.systemInstruction?.parts?.[0]?.text ?? '';
      expect(system).not.toContain('KEY_POINTS');
    } finally {
      restore();
    }
  });

  it('keeps the reply short — a Socratic turn is one question', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(TUTOR_QUESTION));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'socratic' }),
      });
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const cfg = payload.generationConfig ?? {};
      // A Socratic reply that runs to 8000 tokens of notes is not a
      // Socratic reply.
      expect(cfg.maxOutputTokens).toBeLessThanOrEqual(1000);
    } finally {
      restore();
    }
  });

  it('still answers a lesson normally', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('## Photosynthesis\n\nA full lesson.'));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'lesson' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toContain('Photosynthesis');
    } finally {
      restore();
    }
  });
});
