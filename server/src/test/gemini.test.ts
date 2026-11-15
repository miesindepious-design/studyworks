/**
 * Server-side Gemini helpers.
 *
 * The server shares one Google Cloud project when it falls back to the
 * server-managed key, so every call shares one free-tier quota. Two rules
 * keep that quota healthy:
 *
 *   1. Gemini 4 Hydrogen is the default — it is the first Gemini 4 model
 *      available on the free tier.
 *   2. The thinking level is dialled down for cheap calls. Gemini 4 thinks
 *      "high" by default, which wastes quota on a summary. Older models
 *      reject the field, so it is only sent where it is understood.
 */
import { describe, it, expect } from 'vitest';
import {
  supportsThinkingLevel, buildGenerationConfig, DEFAULT_GEMINI_MODEL,
} from '../lib/gemini.js';

describe('supportsThinkingLevel', () => {
  it('accepts Gemini 4 models', () => {
    expect(supportsThinkingLevel('gemini-4-hydrogen')).toBe(true);
  });

  it('rejects older models', () => {
    expect(supportsThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(supportsThinkingLevel('gemini-2.0-flash')).toBe(false);
  });
});

describe('buildGenerationConfig', () => {
  it('keeps the default temperature and token budget', () => {
    const cfg = buildGenerationConfig({ model: 'gemini-2.5-flash' });
    expect(cfg.temperature).toBe(0.4);
    expect(cfg.maxOutputTokens).toBe(1024);
  });

  it('adds JSON mode when asked', () => {
    const cfg = buildGenerationConfig({ model: 'gemini-4-hydrogen', jsonMode: true });
    expect(cfg.responseMimeType).toBe('application/json');
  });

  it('adds the thinking block for Gemini 4', () => {
    const cfg = buildGenerationConfig({ model: 'gemini-4-hydrogen', thinking: 'medium' });
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
  });

  it('never sends the thinking block to an older model', () => {
    const cfg = buildGenerationConfig({ model: 'gemini-2.5-flash', thinking: 'medium' });
    expect(cfg.thinkingConfig).toBeUndefined();
  });

  it('never sends a thinking block when no level was chosen', () => {
    const cfg = buildGenerationConfig({ model: 'gemini-4-hydrogen' });
    expect(cfg.thinkingConfig).toBeUndefined();
  });
});

describe('DEFAULT_GEMINI_MODEL', () => {
  it('is the free-tier Gemini 4 model', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-4-hydrogen');
  });
});
