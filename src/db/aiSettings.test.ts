/**
 * Gemini model selection.
 *
 * Two things have to stay true:
 *   1. `gemini-4-hydrogen` is selectable — it is the first Gemini 4 model on
 *      the Gemini API free tier, and the whole point of the switch.
 *   2. A model the browser does not know about is never sent to the provider.
 *      `normalizeModel` quietly rewrites it to the default, because Gemini
 *      404s on retired models (1.5 Flash was dropped and now fails).
 */

import { describe, it, expect } from 'vitest';
import { MODELS_BY_PROVIDER, normalizeModel } from './aiSettings';

describe('MODELS_BY_PROVIDER', () => {
  it('offers Gemini 4 Hydrogen', () => {
    const ids = MODELS_BY_PROVIDER.gemini.map(m => m.id);
    expect(ids).toContain('gemini-4-hydrogen');
  });

  it('defaults Gemini to Hydrogen', () => {
    expect(MODELS_BY_PROVIDER.gemini[0].id).toBe('gemini-4-hydrogen');
  });

  it('keeps Gemini 2.5 Flash as a stable fallback', () => {
    const ids = MODELS_BY_PROVIDER.gemini.map(m => m.id);
    expect(ids).toContain('gemini-2.5-flash');
    expect(ids).toContain('gemini-2.5-pro');
  });

  it('leaves the OpenAI list alone', () => {
    expect(MODELS_BY_PROVIDER.openai[0].id).toBe('gpt-4o-mini');
  });
});

describe('normalizeModel', () => {
  it('keeps a model that is still known', () => {
    expect(normalizeModel('gemini', 'gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(normalizeModel('gemini', 'gemini-4-hydrogen')).toBe('gemini-4-hydrogen');
  });

  it('falls back to Hydrogen for an unknown model', () => {
    expect(normalizeModel('gemini', 'gemini-1.5-flash')).toBe('gemini-4-hydrogen');
    expect(normalizeModel('gemini', '')).toBe('gemini-4-hydrogen');
    expect(normalizeModel('gemini', null)).toBe('gemini-4-hydrogen');
  });

  it('falls back to the OpenAI default for OpenAI', () => {
    expect(normalizeModel('openai', 'gpt-9-imaginary')).toBe('gpt-4o-mini');
    expect(normalizeModel('openai', 'gpt-4o')).toBe('gpt-4o');
  });

  it('does not confuse providers', () => {
    // A Gemini model id saved under OpenAI must not survive.
    expect(normalizeModel('openai', 'gemini-4-hydrogen')).toBe('gpt-4o-mini');
  });
});
