/**
 * Shared AI provider plumbing — used by /api/ai routes AND by other
 * features that need one-off AI calls (e.g. quiz-battle topic questions).
 *
 * The user's API key is stored encrypted in Postgres (AISettings.encryptedApiKey)
 * and decrypted at call-time. A server-managed key (env AI_API_KEY) is the
 * fallback when the user has not configured their own.
 *
 * Server-managed keys come from a pool (see aiKeyPool.ts): several keys, one
 * per Google Cloud project, so a crowded model or an exhausted daily quota on
 * one key is stepped over instead of taking every AI feature down with it.
 */
import { prisma } from './prisma.js';
import { decryptApiKey } from './encryption.js';
import { buildGenerationConfig, DEFAULT_GEMINI_MODEL, type ThinkingLevel } from './gemini.js';
import { getServerKeyPool, type FailureKind } from './aiKeyPool.js';

export const SYSTEM_BASE = `You are an expert study assistant embedded in StudyWorks, a learning app.
Be concise, accurate, and focused. Never add disclaimers or meta-commentary.`;

/**
 * A provider call that failed, with enough structure to decide whether
 * another key could do better. The message stays in the shape the UI has
 * always shown ("Gemini 503: The model is overloaded…").
 */
export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly kind: FailureKind,
    public readonly retryDelayMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Gemini sends retryDelay as "27s"; turn it into milliseconds. */
function parseRetryDelay(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * 1000);
}

/**
 * Decide what a failure means for the key that produced it.
 *
 * The distinction that matters: "this request was wrong" (another key will
 * fail the same way — stop trying) versus "this key or project is in
 * trouble" (another key may well work — keep going).
 */
function classify(status: number, message: string, retryDelay?: unknown): { kind: FailureKind; retryDelayMs?: number } {
  const lower = (message || '').toLowerCase();
  const retryDelayMs = parseRetryDelay(retryDelay);

  if (status === 429) return { kind: 'rate-limited', retryDelayMs };
  if (status === 503) return { kind: 'overloaded', retryDelayMs };
  if (status === 500 || status === 502 || status === 504) return { kind: 'transient', retryDelayMs };
  if (status === 401 || status === 403) return { kind: 'auth' };
  if (status === 400) {
    // "API key not valid" is the key's fault, not the request's.
    if (lower.includes('api key') || lower.includes('api_key_invalid')) return { kind: 'auth' };
    return { kind: 'invalid-request' };
  }
  // "The model is overloaded" sometimes arrives with a 429 and no status
  // hint, and "overloaded" is what the user actually sees.
  if (lower.includes('overloaded')) return { kind: 'overloaded', retryDelayMs };
  return { kind: 'transient', retryDelayMs };
}

export function getServerAIFallback() {
  const pool = getServerKeyPool();
  // preferred() rotates through the pool so the day's quota is spread over
  // every key rather than draining the first one.
  const apiKey = pool.preferred() ?? pool.fallbackKey();
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

/** One attempt against one key. Throws ProviderError on failure. */
async function callProviderOnce(opts: {
  provider:    string;
  model:       string;
  apiKey:      string;
  messages:    { role: string; content: string }[];
  temperature?: number;
  maxTokens?:  number;
  jsonMode?:   boolean;
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
      const message = (err as any)?.error?.message ?? res.statusText;
      // Gemini puts its own advice in the error details: "27s".
      const retryDelay = (err as any)?.error?.details?.find?.((d: any) => d?.retryDelay)?.retryDelay;
      const { kind, retryDelayMs } = classify(res.status, message, retryDelay);
      throw new ProviderError(res.status, `Gemini ${res.status}: ${message}`, kind, retryDelayMs);
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
      const message = (err as any)?.error?.message ?? res.statusText;
      const { kind, retryDelayMs } = classify(res.status, message);
      throw new ProviderError(res.status, `OpenAI ${res.status}: ${message}`, kind, retryDelayMs);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }

  throw new Error(`Unknown provider: ${opts.provider}`);
}

/**
 * Models to try when every key has failed for the current one.
 *
 * A second key does not help when the model itself is out of capacity for
 * everyone — that condition is model-side, not key-side. Dropping to a
 * different model does. Free-tier Gemini models that are safe to fall back
 * to are listed in AI_FALLBACK_MODELS.
 */
function fallbackModels(provider: string): string[] {
  if (provider !== 'gemini') return [];
  const raw = process.env.AI_FALLBACK_MODELS || '';
  return raw
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Call the provider, stepping over keys that are busy.
 *
 * A server-managed key belongs to a pool, so a crowded model or an
 * exhausted quota on one key is retried on the next one instead of failing
 * the request. A key the user brought themselves is used alone — their
 * quota is theirs — but if it fails in a way another key could survive,
 * the server pool can still cover the request (set AI_POOL_FALLBACK=0 to
 * turn that off).
 *
 * When every key has failed for a model, the fallback models get a turn.
 */
export async function callProvider(opts: {
  provider:    string;
  model:       string;
  apiKey:      string;
  messages:    { role: string; content: string }[];
  temperature?: number;
  maxTokens?:  number;
  jsonMode?:   boolean;
  thinking?:   ThinkingLevel;
}): Promise<string> {
  const pool    = getServerKeyPool();
  const pooled  = pool.has(opts.apiKey);
  const fallBackAllowed = (process.env.AI_POOL_FALLBACK ?? '1') !== '0';

  const models = [opts.model, ...fallbackModels(opts.provider).filter(m => m !== opts.model)];

  let lastError: unknown;

  for (let m = 0; m < models.length; m++) {
    const model = models[m];

    // Recomputed per model: a key that just failed should not be the first
    // one tried again on the fallback model.
    const primary   = pooled ? pool.candidates(opts.apiKey) : [opts.apiKey];
    const borrowed  = (!pooled && fallBackAllowed && pool.size > 0)
      ? pool.candidates().filter(k => k !== opts.apiKey)
      : [];
    const chain = [...primary, ...borrowed];

    let requestRejected = false;

    for (let i = 0; i < chain.length; i++) {
      const key = chain[i];
      try {
        const text = await callProviderOnce({ ...opts, model, apiKey: key });
        pool.reportSuccess(key);
        return text;
      } catch (err) {
        lastError = err;
        const pe = err instanceof ProviderError ? err : null;
        const kind: FailureKind = pe?.kind ?? 'transient';
        pool.reportFailure(key, kind, pe?.retryDelayMs);

        if (kind === 'invalid-request') {
          // The request itself is wrong — another key, another model, same
          // outcome. Stop.
          requestRejected = true;
          break;
        }
        if (i < chain.length - 1) {
          // Fingerprint only — the key itself never reaches a log.
          const label = pool.has(key) ? pool.fingerprintOf(key) : 'user key';
          console.warn(
            `[ai] ${opts.provider} key ${label} failed (${kind}) — trying another key.`,
          );
        }
        // Otherwise keep going: the next key may well work.
      }
    }

    if (requestRejected) break;
    if (m < models.length - 1) {
      console.warn(
        `[ai] ${opts.provider} model ${model} failed on every key — trying ${models[m + 1]}.`,
      );
    }
  }

  throw lastError;
}
