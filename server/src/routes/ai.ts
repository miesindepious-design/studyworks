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
import { SYSTEM_BASE, loadAIConfig, callProvider, getServerAIFallback } from '../lib/aiProvider.js';
import { studentProfileBits, studentPromptContext } from '../lib/studentProfile.js';

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
  const fallback = getServerAIFallback();

  if (!settings) {
    const serverManaged = !!fallback;
    return c.json({
      provider:              fallback?.provider ?? 'gemini',
      model:                 fallback?.model ?? 'gemini-2.5-flash',
      enabled:               serverManaged,
      hasApiKey:             serverManaged,
      serverManaged,
      customSummaryPrompt:   null,
      customFlashcardPrompt: null,
      customQAPrompt:        null,
    });
  }

  // Never return the actual key — only indicate whether one is set
  const serverManaged = !settings.encryptedApiKey && !!fallback;
  return c.json({
    provider:              settings.provider,
    model:                 settings.model,
    enabled:               settings.enabled || serverManaged,
    hasApiKey:             !!settings.encryptedApiKey || !!fallback,
    serverManaged,
    customSummaryPrompt:   settings.customSummaryPrompt,
    customFlashcardPrompt: settings.customFlashcardPrompt,
    customQAPrompt:        settings.customQAPrompt,
  });
});

aiRouter.put('/settings', requirePro, zValidator('json', AISettingsBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const current = await prisma.aISettings.findUnique({ where: { userId: user.id } });

  // Encrypt new key if provided; keep existing if not; clear if explicitly empty string.
  let encryptedApiKey = current?.encryptedApiKey ?? null;
  if (body.apiKey === '') {
    encryptedApiKey = null;
  } else if (body.apiKey && body.apiKey.trim().length > 0) {
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

  const fallback = getServerAIFallback();
  const serverManaged = !settings.encryptedApiKey && !!fallback;

  return c.json({
    provider:              settings.provider,
    model:                 settings.model,
    enabled:               settings.enabled || serverManaged,
    hasApiKey:             !!settings.encryptedApiKey || !!fallback,
    serverManaged,
    customSummaryPrompt:   settings.customSummaryPrompt,
    customFlashcardPrompt: settings.customFlashcardPrompt,
    customQAPrompt:        settings.customQAPrompt,
  });
});

// ── Helper: server-managed fallback AI config ────────────────────────────────
// AI provider helpers (loadAIConfig / callProvider / SYSTEM_BASE) live in
// ../lib/aiProvider.ts so other features (quiz battles) can reuse them.

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
  count:   z.number().int().min(1).max(60).default(20),
  hard:    z.boolean().default(false),
})), async c => {
  const user = c.get('user');
  const { title, content, count, hard } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const defaultPrompt = hard
    ? `Create exactly {{count}} hard-difficulty flashcards from the note below. Focus on the most complex, commonly misunderstood, and exam-critical areas. Prioritize edge cases, mechanisms, and tricky distinctions. Mark difficulty: mostly hard, some medium. Include a mix of standard and fill-in-the-blank questions to strengthen recall.Return JSON: { "flashcards": [ { "question", "answer", "difficulty": "easy|medium|hard", "type": "standard|fill-in" } ] }`
    : `Create exactly {{count}} high-yield flashcards from the note below. Focus on exam-relevant facts, definitions, mechanisms, edge cases, and commonly confused concepts. Mark difficulty: easy, medium, or hard. Include a mix of standard and fill-in-the-blank questions to strengthen recall.Return JSON: { "flashcards": [ { "question", "answer", "difficulty": "easy|medium|hard", "type": "standard|fill-in" } ] }`;
  const basePrompt = cfg.customFlashcardPrompt || defaultPrompt;
  const prompt = basePrompt.replace('{{count}}', String(count));

  // Education-level awareness — cards match the student's exact class/year.
  const studentCtx = studentPromptContext(studentProfileBits(user));

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
        { role: 'user',   content: `${prompt}\n\nTitle: ${title}\n\nContent:\n${content}` },
      ],
      temperature: 0.5, maxTokens: 8192, jsonMode: true,
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

// ── AI Tutor ──────────────────────────────────────────────────────────────────
type TutorMode = 'lesson' | 'simpler' | 'deeper' | 'quiz';

const TutorRequestBody = z.object({
  topic:       z.string().min(1),
  mode:        z.enum(['lesson', 'simpler', 'deeper', 'quiz']).default('lesson'),
  educationLevel: z.string().optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).default([]),
  lastAnswer: z.string().optional().nullable(),
});

aiRouter.post('/tutor', requirePro, zValidator('json', TutorRequestBody), async c => {
  const user = c.get('user');
  const { topic, mode, educationLevel, history, lastAnswer } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  let effectiveLevel = educationLevel ?? user.educationLevel ?? 'college';
  const levelLabel: Record<string, string> = {
    'high-school':        'high school',
    'college-freshman':   'first-year college',
    'college-sophomore':  'second-year college',
    'college-junior':     'third-year college / upper-division',
    'college-senior':     'final-year college',
    'university':         'university level',
    'graduate':           'graduate level',
    'phd':                'PhD / research level',
    'college':            'college level',
  };
  let audience = levelLabel[effectiveLevel] ?? 'college level';

  // The exact student profile captured at signup (school stage + exact class
  // or university year) takes precedence over the generic level dropdown —
  // it is more specific, so the tutor tailors depth and curriculum to it.
  const profileBits = studentProfileBits(user);
  if (profileBits.length > 0) {
    audience = profileBits.join(', ');
  }
  const studentContext = studentPromptContext(profileBits);

  const modeInstructions: Record<TutorMode, string> = {
    lesson: `Teach the requested topic from scratch as exam-ready study notes for a ${audience} student. Write comprehensive, well-explained notes the student can use to revise for exams: motivation, clear section headings, formal definitions, key formulas with explanations, worked examples, comparison tables where useful, common misconceptions and exam traps, and end with a "likely exam questions" section including model answers. Do not keep explanations brief — cover the topic's important sub-topics, prerequisites, and applications at a depth matching the student's level (foundational but precise for beginners; thorough and rigorous for university/graduate levels).`,
    simpler: `The student found the previous explanation too hard. Re-explain the same topic at a simpler level for ${audience}. Use more everyday analogies, shorter sentences, and explicit step-by-step reasoning. Avoid jargon where possible, or define every term you use.`,
    deeper: `The student wants to go beyond the standard curriculum. Extend the lesson into a more advanced, research-oriented treatment suitable for ${audience}. Include stronger formalism, edge cases, modern interpretations, and references to deeper ideas. Frame it as exam-grade advanced notes: likely exam topics, derivations, comparison tables, and common pitfalls.`,
    quiz: `Generate a short mastery quiz for the topic so far. Mix recall, conceptual, and application questions. After each question, give brief feedback. Finish with a short assessment of whether the student seems ready to move on.`,
  };

  const messages = [
    { role: 'system', content: `${SYSTEM_BASE}\nYou are an expert AI tutor. ${modeInstructions[mode]}${studentContext}` },
    ...history,
    { role: 'user', content: lastAnswer ? `Student answer: ${lastAnswer}\nContinue the tutoring session appropriately.` : `Topic: ${topic}` },
  ];

  try {
    const raw = await callProvider({
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      messages,
      temperature: mode === 'quiz' ? 0.4 : 0.7,
      maxTokens: mode === 'quiz' ? 1200 : 4000,
    });

    return c.json({
      topic,
      mode,
      educationLevel: effectiveLevel,
      response: raw.trim(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

const ProfileBody = z.object({
  educationLevel: z.string().optional().nullable(),
  schoolStage:    z.enum(['primary', 'secondary', 'university']).optional().nullable(),
  schoolClass:    z.string().max(60).optional().nullable(),
  universityYear: z.string().max(60).optional().nullable(),
  department:     z.string().max(80).optional().nullable(),
});

// ── GET /api/ai/profile ──────────────────────────────────────────────────────
// The Settings page needs the saved student credentials to render the
// profile card. The session middleware already carries every field, so this
// is a straight read — no extra database round-trip.
aiRouter.get('/profile', async c => {
  const user = c.get('user');
  return c.json({
    user: {
      id:             user.id,
      email:          user.email,
      educationLevel: user.educationLevel ?? null,
      schoolStage:    user.schoolStage    ?? null,
      schoolClass:    user.schoolClass    ?? null,
      universityYear: user.universityYear ?? null,
      department:     user.department     ?? null,
    },
  });
});

aiRouter.put('/profile', zValidator('json', ProfileBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // Keep the generic educationLevel in sync so the tutor dropdown stays
  // consistent with the structured profile captured at signup.
  //
  // An explicitly supplied educationLevel always wins — the Settings page
  // lets a student say "Graduate" or "PhD", which the stage alone can't
  // express. When no level is sent (the signup flow), it is derived from
  // the stage as before.
  const derivedFromStage =
    body.schoolStage === 'primary'   ? 'high-school' :
    body.schoolStage === 'secondary' ? 'high-school' :
    body.schoolStage === 'university' ? 'university' : null;

  const explicitLevel =
    typeof body.educationLevel === 'string' && body.educationLevel.trim()
      ? body.educationLevel
      : null;

  const derivedLevel = explicitLevel ?? derivedFromStage;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      educationLevel: derivedLevel,
      // Only overwrite profile fields that were actually sent — the tutor's
      // level dropdown PUTs educationLevel alone and must not wipe the
      // student profile captured at signup.
      ...(body.schoolStage    !== undefined ? { schoolStage:    body.schoolStage }    : {}),
      ...(body.schoolClass    !== undefined ? { schoolClass:    body.schoolClass }    : {}),
      ...(body.universityYear !== undefined ? { universityYear: body.universityYear } : {}),
      ...(body.department     !== undefined ? { department:     body.department }     : {}),
    },
    select: {
      id: true,
      email: true,
      educationLevel: true,
      schoolStage: true,
      schoolClass: true,
      universityYear: true,
      department: true,
    },
  });

  return c.json({ user: updated });
});
