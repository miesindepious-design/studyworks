/**
 * The AI provider proxy.
 *
 * The tutor's diagrams live or die on one thing here: the system prompt —
 * which carries the "draw one labelled SVG diagram" rules — has to reach
 * the model on every call. It used to be folded into the first *user* turn,
 * so any conversation that started with a model turn (the tutor sends the
 * previous answers as history) silently lost it, and no diagram ever came
 * back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { callProvider } from '../lib/aiProvider.js';

const GEMINI_REPLY = {
  candidates: [{
    content: {
      parts: [{ text: 'Here is the diagram.\n\n```svg\n<svg viewBox="0 0 10 10"/>\n```' }],
    },
  }],
};

/** Stub global fetch and hand back the body Gemini was asked for. */
function stubGemini(reply: unknown = GEMINI_REPLY) {
  const calls: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    calls.push(JSON.parse(String(init.body)));
    return {
      ok: true,
      status: 200,
      json: async () => reply,
    };
  }) as any;
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('callProvider — Gemini', () => {
  it('sends the system prompt when the conversation starts with a user turn', async () => {
    const gemini = stubGemini();
    try {
      await callProvider({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'k',
        messages: [
          { role: 'system', content: 'DIAGRAM RULES: draw one SVG.' },
          { role: 'user', content: 'Topic: photosynthesis' },
        ],
      });
    } finally {
      gemini.restore();
    }
    const body = gemini.calls[0];
    const systemText = JSON.stringify(body.systemInstruction ?? '');
    expect(systemText).toContain('DIAGRAM RULES');
  });

  it('still sends the system prompt when the conversation starts with a model turn', async () => {
    // This is the tutor's shape: the previous answers come first.
    const gemini = stubGemini();
    try {
      await callProvider({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'k',
        messages: [
          { role: 'system', content: 'DIAGRAM RULES: draw one SVG.' },
          { role: 'assistant', content: 'Earlier lesson...' },
          { role: 'assistant', content: 'Another earlier answer...' },
          { role: 'user', content: 'Topic: photosynthesis\n\nShow me a diagram.' },
        ],
      });
    } finally {
      gemini.restore();
    }
    const body = gemini.calls[0];
    const systemText = JSON.stringify(body.systemInstruction ?? '');
    expect(systemText).toContain('DIAGRAM RULES');
    // The rules must not be smuggled into a turn instead — they belong in
    // the system instruction, exactly once.
    const turns = JSON.stringify(body.contents);
    expect(turns).not.toContain('DIAGRAM RULES');
  });

  it('keeps the student ask and the answers in order', async () => {
    const gemini = stubGemini();
    try {
      await callProvider({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'k',
        messages: [
          { role: 'system', content: 'rules' },
          { role: 'user', content: 'Topic: photosynthesis' },
          { role: 'assistant', content: 'The lesson...' },
          { role: 'user', content: 'Topic: photosynthesis\n\nShow me a diagram.' },
        ],
      });
    } finally {
      gemini.restore();
    }
    const body = gemini.calls[0];
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[0].parts[0].text).toContain('Topic: photosynthesis');
    expect(body.contents[2].parts[0].text).toContain('Show me a diagram.');
  });

  it('joins every text part so a reply is never cut short', async () => {
    const gemini = stubGemini({
      candidates: [{
        content: {
          parts: [
            { text: 'First half. ' },
            { text: 'Second half with ```svg\n<svg viewBox="0 0 10 10"/>\n```' },
          ],
        },
      }],
    });
    let out = '';
    try {
      out = await callProvider({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'k',
        messages: [{ role: 'user', content: 'Topic: x' }],
      });
    } finally {
      gemini.restore();
    }
    expect(out).toContain('First half.');
    expect(out).toContain('Second half');
  });

  it('ignores thinking parts', async () => {
    const gemini = stubGemini({
      candidates: [{
        content: {
          parts: [
            { text: 'internal reasoning', thought: true },
            { text: 'The real answer.' },
          ],
        },
      }],
    });
    let out = '';
    try {
      out = await callProvider({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'k',
        messages: [{ role: 'user', content: 'Topic: x' }],
      });
    } finally {
      gemini.restore();
    }
    expect(out).toBe('The real answer.');
  });
});
