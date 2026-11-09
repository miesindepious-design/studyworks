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

export const SYSTEM_BASE = `You are an expert study assistant embedded in StudyWorks, a learning app.
Be concise, accurate, and focused. Never add disclaimers or meta-commentary.`;

export function getServerAIFallback() {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  const provider = (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'openai';
  const model = process.env.AI_MODEL?.trim() || 'gemini-2.5-flash';
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
  maxTokens?:   number;
  jsonMode?:    boolean;
}): Promise<string> {
  if (opts.provider === 'gemini') {
    const systemMsg = opts.messages.find(m => m.role === 'system');
    const userMsgs  = opts.messages.filter(m => m.role !== 'system');
    const contents  = userMsgs.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    if (systemMsg && contents.length > 0 && contents[0].role === 'user') {
      contents[0].parts[0].text = `${systemMsg.content}\n\n${contents[0].parts[0].text}`;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature:     opts.temperature ?? 0.4,
          maxOutputTokens: opts.maxTokens   ?? 1024,
          ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
