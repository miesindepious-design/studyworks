/**
 * /api/ai  — server-side AI proxy + AI settings management.
 *
 * The user's API key is stored encrypted in Postgres (AISettings.encryptedApiKey).
 * The server decrypts it at call-time and proxies requests to the provider.
 * This keeps the key out of the browser after it's been saved server-side.
 *
 * Also tracks monthly usage counters in the User model.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { requirePro } from '../lib/tier.js';
import { rateLimitMiddleware } from '../lib/rateLimit.js';
import { prisma } from '../lib/prisma.js';
import { encryptApiKey, decryptApiKey } from '../lib/encryption.js';

export const aiRouter = new Hono();
aiRouter.use('/*', requireAuth);
// Generous default: 60 calls/min/user. The Pricing page advertises
// "unlimited AI" but no provider is truly unlimited, and a misbehaving
// client (or a leaked token) can burn real money.
aiRouter.use('/*', rateLimitMiddleware(60, 60_000));

// ── AI Settings CRUD ──────────────────────────────────────────────────────────

const AISettingsBody = z.object({
  provider:             z.enum(['gemini', 'openai']),
  model:                z.string().min(1),
  enabled:              z.boolean(),
  apiKey:               z.string().optional(), // only set when key is being changed
  customSummaryPrompt:  z.string().optional().nullable(),
  customFlashcardPrompt: z.string().optional().nullable(),
  customQAPrompt:       z.string().optional().nullable(),
});

aiRouter.get('/settings', async c => {
  const user     = c.get('user');
  const settings = await prisma.aISettings.findUnique({ where: { userId: user.id } });
  if (!settings) {
    return c.json({
      provider:              'gemini',
      model:                 'gemini-1.5-flash',
      enabled:               false,
      hasApiKey:             false,
      customSummaryPrompt:   null,
      customFlashcardPrompt: null,
      customQAPrompt:        null,
    });
  }

  // Never return the actual key — only indicate whether one is set
  return c.json({
    provider:              settings.provider,
    model:                 settings.model,
    enabled:               settings.enabled,
    hasApiKey:             !!settings.encryptedApiKey,
    customSummaryPrompt:   settings.customSummaryPrompt,
    customFlashcardPrompt: settings.customFlashcardPrompt,
    customQAPrompt:        settings.customQAPrompt,
  });
});

aiRouter.put('/settings', requirePro, zValidator('json', AISettingsBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const current = await prisma.aISettings.findUnique({ where: { userId: user.id } });

  // Encrypt new key if provided; keep existing if not
  let encryptedApiKey = current?.encryptedApiKey ?? null;
  if (body.apiKey && body.apiKey.trim().length > 0) {
    encryptedApiKey = encryptApiKey(body.apiKey.trim());
  }

  const settings = await prisma.aISettings.upsert({
    where:  { userId: user.id },
    create: {
      userId:                user.id,
      provider:              body.provider,
      model:                 body.model,
      enabled:               body.enabled,
      encryptedApiKey,
      customSummaryPrompt:   body.customSummaryPrompt  ?? null,
      customFlashcardPrompt: body.customFlashcardPrompt ?? null,
      customQAPrompt:        body.customQAPrompt        ?? null,
    },
    update: {
      provider:              body.provider,
      model:                 body.model,
      enabled:               body.enabled,
      encryptedApiKey,
      customSummaryPrompt:   body.customSummaryPrompt  ?? null,
      customFlashcardPrompt: body.customFlashcardPrompt ?? null,
      customQAPrompt:        body.customQAPrompt        ?? null,
    },
  });

  return c.json({
    provider:              settings.provider,
    model:                 settings.model,
    enabled:               settings.enabled,
    hasApiKey:             !!settings.encryptedApiKey,
    customSummaryPrompt:   settings.customSummaryPrompt,
    customFlashcardPrompt: settings.customFlashcardPrompt,
    customQAPrompt:        settings.customQAPrompt,
  });
});

// ── Helper: load and decrypt user AI config ───────────────────────────────────
async function loadAIConfig(userId: string) {
  const settings = await prisma.aISettings.findUnique({ where: { userId } });
  if (!settings || !settings.enabled || !settings.encryptedApiKey) {
    throw new Error('AI not configured or not enabled');
  }
  const apiKey = decryptApiKey(settings.encryptedApiKey);
  return { ...settings, apiKey };
}

// ── Generic provider proxy ────────────────────────────────────────────────────
async function callProvider(opts: {
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

const SYSTEM_BASE = `You are an expert study assistant embedded in StudyWorks, a learning app.
Be concise, accurate, and focused. Never add disclaimers or meta-commentary.`;

// ── POST /api/ai/summary ──────────────────────────────────────────────────────
aiRouter.post('/summary', requirePro, zValidator('json', z.object({
  title:   z.string(),
  content: z.string(),
})), async c => {
  const user   = c.get('user');
  const { title, content } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const prompt = cfg.customSummaryPrompt ||
    'Summarise the following note in 3-5 concise bullet points.\nStart each bullet with "• ". Keep each bullet under 20 words.';

  try {
    const text = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user',   content: `${prompt}\n\nTitle: ${title}\n\nContent:\n${content}` },
      ],
      temperature: 0.3, maxTokens: 300,
    });
    return c.json({ summary: text.trim() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/flashcards ───────────────────────────────────────────────────
aiRouter.post('/flashcards', requirePro, zValidator('json', z.object({
  title:   z.string(),
  content: z.string(),
  count:   z.number().int().min(1).max(40).default(5),
})), async c => {
  const user = c.get('user');
  const { title, content, count } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const basePrompt = cfg.customFlashcardPrompt ||`Create exactly {{count}} high-yield flashcards from the note below. Focus on exam-relevant facts, definitions, mechanisms, edge cases, and commonly confused concepts. Mark difficulty: easy, medium, or hard. Include a mix of standard and fill-in-the-blank questions to strengthen recall.Return JSON: { "flashcards": [ { "question", "answer", "difficulty": "easy|medium|hard", "type": "standard|fill-in" } ] }`;
  const prompt = basePrompt.replace('{{count}}', String(count));

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user',   content: `${prompt}\n\nTitle: ${title}\n\nContent:\n${content}` },
      ],
      temperature: 0.5, maxTokens: 4096, jsonMode: true,
    });
    const parsed = JSON.parse(raw);
    const cards = (parsed.flashcards ?? parsed.cards ?? []).slice(0, count).map((c: any) => ({
      question:    c.question,
      answer:      c.answer,
      difficulty:  c.difficulty ?? 'medium',
      type:        c.type ?? 'standard',
      tags:        ['ai-generated'],
    }));
    return c.json({ flashcards: cards });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/practice-questions ──────────────────────────────────────────
aiRouter.post('/practice-questions', requirePro, zValidator('json', z.object({
  title:   z.string(),
  content: z.string(),
  count:   z.number().int().min(1).max(20).default(4),
})), async c => {
  const user = c.get('user');
  const { title, content, count } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        {
          role: 'user',
          content: `Create ${count} varied practice questions from the note below.
Mix types: "multiple-choice" (4 options, correct answer included), "true-false", "open".
Return JSON: { "questions": [ { "question", "answer", "type", "options"? } ] }
Title: ${title}\n\nContent:\n${content}`,
        },
      ],
      temperature: 0.6, maxTokens: 1500, jsonMode: true,
    });
    const parsed = JSON.parse(raw);
    const questions = (parsed.questions ?? parsed.practice_questions ?? []).slice(0, count);
    return c.json({ questions });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/qa ───────────────────────────────────────────────────────────
aiRouter.post('/qa', requirePro, zValidator('json', z.object({
  query:    z.string().min(1),
  contexts: z.array(z.object({
    title:   z.string(),
    content: z.string(),
    summary: z.string().optional(),
  })).max(20),
})), async c => {
  const user = c.get('user');
  const { query, contexts } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const qaPrompt = cfg.customQAPrompt ||
    "Answer the user's question strictly based on the provided notes.\nIf the answer isn't in the notes, say so briefly. Cite note titles when referencing them.";

  const kb = contexts
    .map((n, i) => `[Note ${i + 1}] ${n.title}\n${n.summary || n.content.slice(0, 400)}`)
    .join('\n\n---\n\n');

  try {
    const text = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_BASE}\nYou have access to the user's personal knowledge base.\n${qaPrompt}`,
        },
        {
          role: 'user',
          content: `Knowledge base:\n\n${kb || 'No notes available.'}\n\n---\n\nQuestion: ${query}`,
        },
      ],
      temperature: 0.3, maxTokens: 700,
    });
    return c.json({ answer: text.trim() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/rerank ───────────────────────────────────────────────────────
aiRouter.post('/rerank', requirePro, zValidator('json', z.object({
  query:      z.string().min(1),
  candidates: z.array(z.object({
    id:      z.string(),
    title:   z.string(),
    snippet: z.string(),
  })),
})), async c => {
  const user = c.get('user');
  const { query, candidates } = c.req.valid('json');

  if (candidates.length === 0) return c.json({ ranked: [] });

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const list = candidates
    .map((c, i) => `${i}: ${c.title} — ${c.snippet.slice(0, 120)}`)
    .join('\n');

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        {
          role: 'user',
          content: `Rank these search results by relevance to the query "${query}".
Return JSON: { "ranked": [list of indices in order, most relevant first] }
Results:\n${list}`,
        },
      ],
      temperature: 0.1, maxTokens: 200, jsonMode: true,
    });
    const parsed = JSON.parse(raw);
    const ranked: number[] = parsed.ranked ?? [];
    const rankedIds = ranked.map(i => candidates[i]?.id).filter(Boolean);
    return c.json({ ranked: rankedIds });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/insights ─────────────────────────────────────────────────────
aiRouter.post('/insights', requirePro, zValidator('json', z.object({
  notes: z.array(z.object({
    title:     z.string(),
    content:   z.string(),
    tags:      z.array(z.string()),
    createdAt: z.string(),
  })),
  flashcards: z.array(z.object({
    question:    z.string(),
    difficulty:  z.string().optional(),
    repetitions: z.number().optional(),
    nextReview:  z.string().optional(),
  })),
})), async c => {
  const user = c.get('user');
  const { notes, flashcards } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const now        = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentNotes = notes.filter(n => new Date(n.createdAt) >= oneWeekAgo);
  const dueCards    = flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
  const hardCards   = flashcards.filter(c => c.difficulty === 'hard');

  const tagCounts: Record<string, number> = {};
  recentNotes.flatMap(n => n.tags).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const context = `Last 7 days:
- Notes created: ${recentNotes.length}
- Top topics: ${topTags.join(', ') || 'none'}
- Recent note titles: ${recentNotes.slice(0, 5).map(n => n.title).join(', ') || 'none'}

Flashcards:
- Total: ${flashcards.length} | Reviewed: ${flashcards.filter(c => (c.repetitions ?? 0) > 0).length}
- Due for review: ${dueCards.length} | Marked hard: ${hardCards.length}
- Hard cards: ${hardCards.slice(0, 5).map(c => c.question).join(' | ') || 'none'}`;

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_BASE}
You are generating a weekly study insights report.
Return JSON: { "insights": [ { "title", "body", "type" } ] }
Types: "pattern", "suggestion", "streak", "review".
Generate 4-5 insights. Each "body" should be 1-2 sentences, specific and actionable.`,
        },
        { role: 'user', content: `Generate weekly insights:\n\n${context}` },
      ],
      temperature: 0.7, maxTokens: 800, jsonMode: true,
    });
    const parsed = JSON.parse(raw);
    return c.json({ insights: parsed.insights ?? [] });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
