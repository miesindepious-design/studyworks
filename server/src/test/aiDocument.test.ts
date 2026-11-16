/**
 * Tests for the AI Tutor's document analysis and the "key points" panel.
 *
 * Two things are proven here:
 *   1. POST /api/ai/document/analyze turns uploaded text into a briefing
 *      (explanation + the points the student must know + structure + vocab).
 *   2. POST /api/ai/tutor returns structured key points for a *plain topic*
 *      too, and grounds its lesson in any uploaded documents.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { encryptApiKey } from '../lib/encryption.js';
import { KEY_POINTS_OPEN, KEY_POINTS_CLOSE } from '../lib/keyPoints.js';

/** A Gemini-style response carrying `text`. */
function geminiReply(text: string) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }), { status: 200 });
}

/** Swap the global fetch for a mock and hand back the restore function. */
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

const ANALYSIS_JSON = JSON.stringify({
  title: 'Photosynthesis and Plant Energy',
  overview: '## What this covers\nThis chapter explains how plants convert light into chemical energy.',
  keyPoints: [
    { point: 'Light energy is converted into glucose.', why: 'It is the core process of the chapter.', importance: 'must-know' },
    { point: 'Chlorophyll absorbs red and blue light.', why: 'It explains why leaves look green.', importance: 'should-know' },
  ],
  outline: [{ heading: 'Light reactions', detail: 'Happens in the thylakoid membrane.' }],
  glossary: [{ term: 'Thylakoid', meaning: 'A membrane sac inside the chloroplast.' }],
  questions: ['Explain the light-dependent reactions.', 'Why are leaves green?'],
});

describe('POST /api/ai/document/analyze', () => {
  beforeEach(() => {
    prismaMock.aISettings.findUnique.mockResolvedValue(OWN_KEY_SETTINGS as any);
  });

  it('returns the briefing with structured key points', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(ANALYSIS_JSON));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/document/analyze', {
        method: 'POST',
        body: JSON.stringify({
          documents: [{ name: 'chapter3.pdf', text: 'Photosynthesis is the process…' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Photosynthesis and Plant Energy');
      expect(body.overview).toContain('light into chemical energy');
      expect(body.keyPoints).toHaveLength(2);
      expect(body.keyPoints[0].importance).toBe('must-know');
      expect(body.keyPoints[0].why).toContain('core process');
      expect(body.outline[0].heading).toBe('Light reactions');
      expect(body.glossary[0].term).toBe('Thylakoid');
      expect(body.questions).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('sends the uploaded text to the provider', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(ANALYSIS_JSON));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/document/analyze', {
        method: 'POST',
        body: JSON.stringify({
          documents: [{ name: 'chapter3.pdf', text: 'THE-UNIQUE-MARKER-TEXT' }],
        }),
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const prompt = body.contents[0].parts[0].text;
      expect(prompt).toContain('THE-UNIQUE-MARKER-TEXT');
      expect(prompt).toContain('chapter3.pdf');
      // JSON mode is required for the structured briefing.
      expect(body.generationConfig.responseMimeType).toBe('application/json');
    } finally {
      restore();
    }
  });

  it('falls back to the raw text when the model does not answer with JSON', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('Plain prose without JSON.'));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/document/analyze', {
        method: 'POST',
        body: JSON.stringify({ documents: [{ name: 'a.txt', text: 'text' }] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overview).toContain('Plain prose');
      expect(body.keyPoints).toEqual([]);
    } finally {
      restore();
    }
  });

  it('blocks a free user with no key of their own', async () => {
    prismaMock.aISettings.findUnique.mockResolvedValue(null as any);
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/document/analyze', {
      method: 'POST',
      body: JSON.stringify({ documents: [{ name: 'a.txt', text: 'text' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an empty document list', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/ai/document/analyze', {
      method: 'POST',
      body: JSON.stringify({ documents: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ai/tutor — key points', () => {
  beforeEach(() => {
    prismaMock.aISettings.findUnique.mockResolvedValue(OWN_KEY_SETTINGS as any);
  });

  it('returns the key points and hides the raw block from the answer', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const reply = [
      '## Photosynthesis',
      'Plants turn light into chemical energy.',
      KEY_POINTS_OPEN,
      '[{"importance":"must-know","point":"Light becomes glucose","why":"Central idea"}]',
      KEY_POINTS_CLOSE,
    ].join('\n');

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(reply));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'lesson' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toContain('Plants turn light into chemical energy.');
      expect(body.response).not.toContain('KEY_POINTS');
      expect(body.keyPoints).toHaveLength(1);
      expect(body.keyPoints[0].point).toBe('Light becomes glucose');
      expect(body.keyPoints[0].importance).toBe('must-know');
    } finally {
      restore();
    }
  });

  it('asks the model for the key points block', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('A lesson.'));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'lesson' }),
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const system = body.contents[0].parts[0].text;
      expect(system).toContain(KEY_POINTS_OPEN);
    } finally {
      restore();
    }
  });

  it('recovers the key points with a second call when the block is missing', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(geminiReply('A lesson with no block at all.'))
      .mockResolvedValueOnce(geminiReply(JSON.stringify({
        keyPoints: [{ point: 'Recovered point', why: 'Recovered why', importance: 'must-know' }],
      })));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'lesson' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(body.keyPoints).toHaveLength(1);
      expect(body.keyPoints[0].point).toBe('Recovered point');
    } finally {
      restore();
    }
  });

  it('does not ask for key points on a quiz', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('1. What is photosynthesis?'));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({ topic: 'photosynthesis', mode: 'quiz' }),
      });
      const body = await res.json();
      expect(body.keyPoints).toEqual([]);
      const prompt = JSON.parse(fetchMock.mock.calls[0][1].body as string).contents[0].parts[0].text;
      expect(prompt).not.toContain(KEY_POINTS_OPEN);
    } finally {
      restore();
    }
  });

  it('grounds the lesson in uploaded documents', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('A lesson.'));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/tutor', {
        method: 'POST',
        body: JSON.stringify({
          topic: 'photosynthesis',
          mode: 'lesson',
          documents: [{ name: 'chapter3.pdf', text: 'DOCUMENT-BODY-MARKER' }],
          documentBrief: 'Document title: Photosynthesis\nKey points:\n- Light becomes glucose',
        }),
      });
      const prompt = JSON.parse(fetchMock.mock.calls[0][1].body as string).contents[0].parts[0].text;
      expect(prompt).toContain('DOCUMENT-BODY-MARKER');
      expect(prompt).toContain('chapter3.pdf');
      expect(prompt).toContain('Light becomes glucose');
    } finally {
      restore();
    }
  });
});
