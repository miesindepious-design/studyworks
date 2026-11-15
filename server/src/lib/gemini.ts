/**
 * Gemini model helpers (server side).
 *
 * Gemini 4 changed two things that matter to this app:
 *
 *   1. Its default thinking level is "high" — excellent for hard reasoning,
 *      wasteful for a summary or a flashcard batch, because it burns thinking
 *      tokens and makes the call slower. `generationConfig.thinkingConfig
 *      .thinkingLevel` turns that down, but only Gemini 4 models understand
 *      the field: sending it to an older model fails the request outright.
 *
 *   2. `gemini-4-hydrogen` is the first Gemini 4 model on the Gemini API
 *      free tier (Carbon and Argon are paid only), which makes it the right
 *      default for a server-managed key where many students share one
 *      project quota.
 */

export type ThinkingLevel = 'low' | 'medium' | 'high';

/** The model the server falls back to when the env var is not set. */
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

/** Gemini 4 models accept `thinkingConfig.thinkingLevel`; older ones 400. */
export function supportsThinkingLevel(model: string): boolean {
  return /^gemini-4/i.test((model || '').trim());
}

/**
 * Build the `generationConfig` for a Gemini call.
 *
 * The thinking block is only added for models that understand it, so the
 * same helper works for Gemini 2.5 / 2.0 as well.
 */
export function buildGenerationConfig(opts: {
  model:       string;
  temperature?: number;
  maxTokens?:  number;
  jsonMode?:   boolean;
  thinking?:   ThinkingLevel;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    temperature:     opts.temperature ?? 0.4,
    maxOutputTokens: opts.maxTokens   ?? 1024,
    ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
  };

  if (opts.thinking && supportsThinkingLevel(opts.model)) {
    config.thinkingConfig = { thinkingLevel: opts.thinking };
  }

  return config;
}
