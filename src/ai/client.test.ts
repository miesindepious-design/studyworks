/**
 * The actual Gemini request body.
 *
 * `buildThinkingConfig` is unit-tested on its own, but the thing that
 * actually matters is what goes over the wire: a Gemini 4 model must
 * receive the thinking level, an older model must NOT receive it (it 400s),
 * and JSON mode must still be set.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { chatComplete } from './client';

interface Captured {
  url: string;
  body: any;
}

function stubGemini(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }),
    };
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

const MESSAGES = [{ role: 'user' as const, content: 'hello' }];

describe('Gemini request body', () => {
  it('sends the thinking level to Gemini 4', async () => {
    const calls = stubGemini();
    await chatComplete({
      provider: 'gemini', apiKey: 'k', model: 'gemini-4-hydrogen',
      messages: MESSAGES, thinking: 'low',
    });
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('never sends the thinking level to an older model', async () => {
    const calls = stubGemini();
    await chatComplete({
      provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash',
      messages: MESSAGES, thinking: 'low',
    });
    expect(calls[0].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('omits the thinking level when the caller did not pick one', async () => {
    const calls = stubGemini();
    await chatComplete({
      provider: 'gemini', apiKey: 'k', model: 'gemini-4-hydrogen', messages: MESSAGES,
    });
    expect(calls[0].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('keeps JSON mode and the token budget', async () => {
    const calls = stubGemini();
    await chatComplete({
      provider: 'gemini', apiKey: 'k', model: 'gemini-4-hydrogen',
      messages: MESSAGES, jsonMode: true, maxTokens: 8192, thinking: 'medium',
    });
    expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[0].body.generationConfig.maxOutputTokens).toBe(8192);
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
  });

  it('calls the model that was asked for', async () => {
    const calls = stubGemini();
    await chatComplete({
      provider: 'gemini', apiKey: 'k', model: 'gemini-4-hydrogen', messages: MESSAGES,
    });
    expect(calls[0].url).toContain('/models/gemini-4-hydrogen:generateContent');
  });
});
