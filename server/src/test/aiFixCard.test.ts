/**
 * Tests for the AI leech fixer (POST /api/ai/fix-card).
 *
 * The route never touches stored cards — it only proposes a rewrite. What is
 * proven here:
 *
 *   1. a normal reply comes back as { question, answer, whatChanged };
 *   2. a reply wrapped in a code fence is unwrapped;
 *   3. a reply that is not a usable card is a 502, never a half-rewrite;
 *   4. the leech count and topic are passed to the provider as context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { encryptApiKey } from '../lib/encryption.js';

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

const FIX_JSON = JSON.stringify({
  question: 'Where does the cell produce most of its ATP?',
  answer: 'The mitochondria',
  whatChanged: 'The original asked two things at once and the answer rambled.',
});

const LEECH_REQUEST = {
  question: 'What about the mitochondria and how does it make energy and DNA?',
  answer: 'It makes ATP through respiration and also contains its own DNA',
  topic: 'Biology',
  leechCount: 7,
};

describe('POST /api/ai/fix-card', () => {
  beforeEach(() => {
    prismaMock.aISettings.findUnique.mockResolvedValue(OWN_KEY_SETTINGS as any);
  });

  it('returns the proposed rewrite', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(FIX_JSON));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/fix-card', {
        method: 'POST',
        body: JSON.stringify(LEECH_REQUEST),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.question).toBe('Where does the cell produce most of its ATP?');
      expect(body.answer).toBe('The mitochondria');
      expect(body.whatChanged).toContain('two things at once');
    } finally {
      restore();
    }
  });

  it('unwraps a reply fenced in a code block', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fenced = '```json\n' + FIX_JSON + '\n```';
    const fetchMock = vi.fn().mockResolvedValue(geminiReply(fenced));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/fix-card', {
        method: 'POST',
        body: JSON.stringify(LEECH_REQUEST),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.answer).toBe('The mitochondria');
    } finally {
      restore();
    }
  });

  it('rejects a reply that is not a usable card', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply('Sorry, I cannot help with that.'));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/fix-card', {
        method: 'POST',
        body: JSON.stringify(LEECH_REQUEST),
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('rejects a rewrite that lost the answer entirely', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(JSON.stringify({ question: 'A fine question' })));
    const restore = withFetch(fetchMock);
    try {
      const res = await request('/api/ai/fix-card', {
        method: 'POST',
        body: JSON.stringify(LEECH_REQUEST),
      });
      expect(res.status).toBe(502);
    } finally {
      restore();
    }
  });

  it('sends the wording, subject and leech count to the provider', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const fetchMock = vi.fn().mockResolvedValue(geminiReply(FIX_JSON));
    const restore = withFetch(fetchMock);
    try {
      await request('/api/ai/fix-card', {
        method: 'POST',
        body: JSON.stringify(LEECH_REQUEST),
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const prompt = body.contents[0].parts[0].text;
      expect(prompt).toContain('mitochondria');
      expect(prompt).toContain('Biology');
      expect(prompt).toContain('7 times');
    } finally {
      restore();
    }
  });
});
