/**
 * Shared AI provider plumbing — used by /api/ai routes AND by other
 * features that need one-off AI calls (e.g. quiz-battle topic questions).
 *
 * The user's API key is stored encrypted in Postgres (AISettings.encryptedApiKey)
 * and decrypted at call-time. A server-managed key (env AI_API_KEY) is the
 * fallback when the user has not configured their own.
 */
import { prisma } from './prisma.js';
import { decryptApiKey } from './encryption.js';
import { buildGenerationConfig, DEFAULT_GEMINI_MODEL, type ThinkingLevel } from './gemini.js';

export const SYSTEM_BASE = `You are an expert study assistant embedded in StudyWorks, a learning app.
Be concise, accurate, and focused. Never add disclaimers or meta-commentary.`;

export function getServerAIFallback() {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  const provider = (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'openai';
  // Gemini 4 Hydrogen is the first Gemini 4 model on the free tier.
  const model = process.env.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return { provider, model, apiKey, serverManaged: true as const };
}

// ── Helper: load and decrypt user AI config ───────────────────────────────────
export async function loadAIConfig(userId: string) {
  const settings = await prisma.aISettings.findUnique({ where: { userId } });
  if (settings && settings.enabled && settings.encryptedApiKey) {
    const apiKey = decryptApiKey(settings.encryptedApiKey);
    return {
      ...settings,
      apiKey,
      serverManaged: false as const,
      customSummaryPrompt:   settings.customSummaryPrompt   ?? null,
      customFlashcardPrompt: settings.customFlashcardPrompt ?? null,
      customQAPrompt:        settings.customQAPrompt        ?? null,
    };
  }

  const fallback = getServerAIFallback();
  if (!fallback) {
    throw new Error('AI not configured or not enabled');
  }

  // Server-managed fallback — reuse the user's custom prompts when they
  // exist so the prompts stay consistent across key sources.
  return {
    ...fallback,
    customSummaryPrompt:   settings?.customSummaryPrompt   ?? null,
    customFlashcardPrompt: settings?.customFlashcardPrompt ?? null,
    customQAPrompt:        settings?.customQAPrompt        ?? null,
  };
}

// ── Generic provider proxy ────────────────────────────────────────────────────
export async function callProvider(opts: {
  provider:    string;
  model:       string;
  apiKey:      string;
  messages:    { role: string; content: string }[];
  temperature?: number;
  maxTokens?:  number;
  jsonMode?:   boolean;
  /**
   * How hard the model should think. Gemini 4 defaults to "high"; cheap
   * calls ask for less. Ignored by models without the dial.
   */
  thinking?:   ThinkingLevel;
}): Promise<string> {
  if (opts.provider === 'gemini') {
    const systemMsg = opts.messages.find(m => m.role === 'system');
    const userMsgs  = opts.messages.filter(m => m.role !== 'system');
    const contents  = userMsgs.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // The system prompt has to reach the model on EVERY call. It used to be
    // folded into the first *user* turn, which silently threw it away
    // whenever the conversation did not start with one — and the tutor
    // sends the previous answers as history, so every follow-up (including
    // "show me a diagram") lost the diagram rules, the mode instructions,
    // the student's level and the key-points contract.
    //
    // Gemini has a native field for this, so use it.
    const request: Record<string, unknown> = { contents };
    if (systemMsg?.content?.trim()) {
      request.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        generationConfig: buildGenerationConfig({
          model:       opts.model,
          temperature: opts.temperature,
          maxTokens:   opts.maxTokens,
          jsonMode:    opts.jsonMode,
          thinking:    opts.thinking,
        }),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
    }
    const data = await res.json();
    // A reply can arrive as several parts (thinking + text, or a text block
    // split across parts). Taking only the first one truncates the answer —
    // and a truncated answer can cut an SVG diagram in half.
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter(p => !p?.thought && typeof p?.text === 'string')
      .map(p => p.text)
      .join('');
    return text;
  }

  if (opts.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model:       opts.model,
        messages:    opts.messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens:  opts.maxTokens   ?? 1024,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OpenAI ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }

  throw new Error(`Unknown provider: ${opts.provider}`);
}
