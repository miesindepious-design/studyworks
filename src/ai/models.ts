/**
 * Gemini model helpers (client side).
 *
 * Gemini 4 changed two things that matter to this app:
 *
 *   1. Its default thinking level is "high". That is great for hard
 *      reasoning but wasteful for a summary or a flashcard batch — it burns
 *      thinking tokens and makes the call slower. `thinkingConfig.thinkingLevel`
 *      turns that down. Only Gemini 4 models understand the field, though:
 *      sending it to an older model fails the request outright.
 *
 *   2. `gemini-4-hydrogen` is the first Gemini 4 model on the Gemini API
 *      free tier (Carbon and Argon are paid only), which makes it the
 *      sensible default for a study app where many students run on a
 *      free-tier key.
 */

export type ThinkingLevel = 'low' | 'medium' | 'high';

/** The model the app falls back to when nothing else is chosen. */
export const GEMINI_DEFAULT_MODEL = 'gemini-4-hydrogen';

/** Gemini 4 models accept `thinkingConfig.thinkingLevel`; older ones 400. */
export function supportsThinkingLevel(model: string): boolean {
  return /^gemini-4/i.test((model || '').trim());
}

/**
 * The thinking config to merge into `generationConfig`.
 * Empty for models that do not understand it.
 */
export function buildThinkingConfig(
  model: string,
  level?: ThinkingLevel,
): Record<string, unknown> {
  if (!level || !supportsThinkingLevel(model)) return {};
  return { thinkingConfig: { thinkingLevel: level } };
}
