/**
 * Thinking-level handling.
 *
 * Gemini 4 defaults to "high" thinking. That is wasteful for a summary and
 * wrong for a rerank — it burns tokens and slows the call down. But older
 * models reject `thinkingConfig` outright, so the field must only go to
 * models that understand it.
 */

import { describe, it, expect } from 'vitest';
import {
  supportsThinkingLevel, buildThinkingConfig, GEMINI_DEFAULT_MODEL,
} from './models';

describe('supportsThinkingLevel', () => {
  it('accepts Gemini 4 models', () => {
    expect(supportsThinkingLevel('gemini-4-hydrogen')).toBe(true);
    expect(supportsThinkingLevel('gemini-4-carbon')).toBe(true);
    expect(supportsThinkingLevel('gemini-4-argon')).toBe(true);
  });

  it('rejects older models', () => {
    expect(supportsThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(supportsThinkingLevel('gemini-2.5-pro')).toBe(false);
    expect(supportsThinkingLevel('gemini-2.0-flash')).toBe(false);
  });

  it('ignores case and stray whitespace', () => {
    expect(supportsThinkingLevel('  Gemini-4-Hydrogen ')).toBe(true);
  });

  it('is safe with an empty model', () => {
    expect(supportsThinkingLevel('')).toBe(false);
  });
});

describe('buildThinkingConfig', () => {
  it('adds the thinking block for Gemini 4', () => {
    expect(buildThinkingConfig('gemini-4-hydrogen', 'low')).toEqual({
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });

  it('omits the block for models that do not support it', () => {
    expect(buildThinkingConfig('gemini-2.5-flash', 'low')).toEqual({});
  });

  it('omits the block when no level is given', () => {
    expect(buildThinkingConfig('gemini-4-hydrogen', undefined)).toEqual({});
  });

  it('defaults to Gemini 4 Hydrogen', () => {
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-4-hydrogen');
  });
});
