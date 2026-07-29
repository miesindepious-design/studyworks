/**
 * Multi-provider AI client — Google Gemini + OpenAI.
 * Pure fetch, no SDKs. Includes automatic retry with exponential backoff
 * for rate-limit (429) and transient server errors (500/503).
 */

import type { AIProvider } from '../db/aiSettings';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  provider:     AIProvider;
  apiKey:       string;
  model:        string;
  messages:     Message[];
  temperature?: number;
  maxTokens?:   number;
  jsonMode?:    boolean;
}

export class AIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'AIError';
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s base, doubles each attempt

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof AIError && !err.retryable) throw err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[AI] Rate limited or server error, retrying in ${delay}ms… (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGeminiOnce(opts: ChatOptions): Promise<string> {
  const systemMsg = opts.messages.find(m => m.role === 'system');
  const userMsgs  = opts.messages.filter(m => m.role !== 'system');

  const contents = userMsgs.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  if (systemMsg && contents.length > 0 && contents[0].role === 'user') {
    contents[0].parts[0].text = `${systemMsg.content}\n\n${contents[0].parts[0].text}`;
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature:     opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens   ?? 1024,
      ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    let retryAfter = 0;
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || detail;
      // Gemini sometimes returns retryDelay in the error body
      retryAfter = errBody?.error?.details?.find((d: any) => d.retryDelay)?.retryDelay || 0;
    } catch {}

    const isRateLimited = res.status === 429;
    const msg = isRateLimited
      ? `Rate limit hit (${res.status}). ${retryAfter ? `Retry after ${retryAfter}s.` : 'Please wait a moment.'}`
      : `Gemini error ${res.status}: ${detail}`;

    throw new AIError(res.status, msg, RETRYABLE_STATUSES.has(res.status));
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function callOpenAIOnce(opts: ChatOptions): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model:       opts.model,
      messages:    opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens:  opts.maxTokens   ?? 1024,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || detail;
    } catch {}
    const msg = res.status === 429
      ? `Rate limit hit. Please wait a moment and try again.`
      : `OpenAI error ${res.status}: ${detail}`;
    throw new AIError(res.status, msg, RETRYABLE_STATUSES.has(res.status));
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// ── Unified entry point with retry ───────────────────────────────────────────
export async function chatComplete(opts: ChatOptions): Promise<string> {
  switch (opts.provider) {
    case 'gemini': return withRetry(() => callGeminiOnce(opts));
    case 'openai': return withRetry(() => callOpenAIOnce(opts));
    default:       throw new AIError(0, `Unknown AI provider: ${opts.provider}`);
  }
}
