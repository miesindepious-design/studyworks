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
import { requireAI } from '../lib/tier.js';
import { rateLimitMiddleware } from '../lib/rateLimit.js';
import { prisma } from '../lib/prisma.js';
import { encryptApiKey, decryptApiKey } from '../lib/encryption.js';
import { SYSTEM_BASE, loadAIConfig, callProvider, getServerAIFallback } from '../lib/aiProvider.js';
import { DEFAULT_GEMINI_MODEL } from '../lib/gemini.js';
import {
  KEY_POINTS_INSTRUCTION, extractKeyPointsBlock, parseKeyPoints,
  type KeyPoint,
} from '../lib/keyPoints.js';
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

/**
 * Shape every settings response. `canUseAI` tells the client whether AI
 * features are available to this user right now (Pro/trial, their own stored
 * key, or a backend-managed key) — the client uses it to decide whether to
 * show AI actions or the "connect your key" prompt.
 */
function settingsResponse(
  user: { effectiveTier: 'FREE' | 'PRO' },
  settings: { provider: string; model: string; enabled: boolean; encryptedApiKey: string | null,
              customSummaryPrompt: string | null; customFlashcardPrompt: string | null; customQAPrompt: string | null } | null,
) {
  const fallback = getServerAIFallback();
  const hasOwnKey = !!settings?.encryptedApiKey;
  const serverManaged = !hasOwnKey && !!fallback;
  const canUseAI = user.effectiveTier === 'PRO' || hasOwnKey || serverManaged;
  return {
    provider:              settings?.provider ?? fallback?.provider ?? 'gemini',
    model:                 settings?.model ?? fallback?.model ?? DEFAULT_GEMINI_MODEL,
    enabled:               (settings?.enabled ?? false) || serverManaged,
    hasApiKey:             hasOwnKey || !!fallback,
    hasOwnKey,
    serverManaged,
    canUseAI,
    customSummaryPrompt:   settings?.customSummaryPrompt ?? null,
    customFlashcardPrompt: settings?.customFlashcardPrompt ?? null,
    customQAPrompt:        settings?.customQAPrompt ?? null,
  };
}

aiRouter.get('/settings', async c => {
  const user     = c.get('user');
  const settings = await prisma.aISettings.findUnique({ where: { userId: user.id } });

  // Never return the actual key — only indicate whether one is set
  return c.json(settingsResponse(user, settings));
});

// Any authenticated user may store their own provider key (BYOK) — that is
// the whole point of the registration-time "connect your AI key" flow. The
// key is encrypted at rest; the user's own quota pays for their calls.
aiRouter.put('/settings', zValidator('json', AISettingsBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const current = await prisma.aISettings.findUnique({ where: { userId: user.id } });

  // Encrypt new key if provided; keep existing if not.
  // (An empty string means "I didn't type anything" — keep what's stored.)
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

  return c.json(settingsResponse(user, settings));
});

// ── POST /api/ai/test — validate an API key BEFORE saving it ─────────────────
// The onboarding "connect your AI" step uses this so the user gets instant
// feedback on whether the key they pasted works. The key is never persisted
// here — only a single tiny provider call is made.
const TestKeyBody = z.object({
  provider: z.enum(['gemini', 'openai']).optional(),
  model:    z.string().optional(),
  apiKey:   z.string().optional(),
});

aiRouter.post('/test', zValidator('json', TestKeyBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  let provider: string | undefined = body.provider;
  let model: string | undefined    = body.model;
  let apiKey: string | undefined   = body.apiKey?.trim();

  // No key supplied → validate whatever is already configured (own stored
  // key or the backend-managed fallback).
  if (!apiKey) {
    try {
      const cfg = await loadAIConfig(user.id);
      provider = cfg.provider;
      model    = cfg.model;
      apiKey   = cfg.apiKey;
    } catch {
      return c.json({ ok: false, error: 'No API key configured yet.' }, 400);
    }
  }

  provider = provider ?? 'gemini';
  model    = model ?? (provider === 'gemini' ? DEFAULT_GEMINI_MODEL : 'gpt-4o-mini');

  try {
    const reply = await callProvider({
      provider, model, apiKey,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0, maxTokens: 16, thinking: 'low',
    });
    return c.json({ ok: true, provider, model, reply: reply.trim().slice(0, 64) });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message });
  }
});

// ── Helper: server-managed fallback AI config ────────────────────────────────
// AI provider helpers (loadAIConfig / callProvider / SYSTEM_BASE) live in
// ../lib/aiProvider.ts so other features (quiz battles) can reuse them.

// ── POST /api/ai/summary ──────────────────────────────────────────────────────
aiRouter.post('/summary', requireAI, zValidator('json', z.object({
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
      temperature: 0.3, maxTokens: 300, thinking: 'low',
    });
    return c.json({ summary: text.trim() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/flashcards ───────────────────────────────────────────────────
aiRouter.post('/flashcards', requireAI, zValidator('json', z.object({
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
      temperature: 0.5, maxTokens: 8192, jsonMode: true, thinking: 'low',
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
aiRouter.post('/practice-questions', requireAI, zValidator('json', z.object({
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
      temperature: 0.6, maxTokens: 1500, jsonMode: true, thinking: 'low',
    });
    const parsed = JSON.parse(raw);
    const questions = (parsed.questions ?? parsed.practice_questions ?? []).slice(0, count);
    return c.json({ questions });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/qa ───────────────────────────────────────────────────────────
aiRouter.post('/qa', requireAI, zValidator('json', z.object({
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
      temperature: 0.3, maxTokens: 700, thinking: 'medium',
    });
    return c.json({ answer: text.trim() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/rerank ───────────────────────────────────────────────────────
aiRouter.post('/rerank', requireAI, zValidator('json', z.object({
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
      temperature: 0.1, maxTokens: 200, jsonMode: true, thinking: 'low',
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
aiRouter.post('/insights', requireAI, zValidator('json', z.object({
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
      temperature: 0.7, maxTokens: 800, jsonMode: true, thinking: 'low',
    });
    const parsed = JSON.parse(raw);
    return c.json({ insights: parsed.insights ?? [] });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── AI Tutor ──────────────────────────────────────────────────────────────────
type TutorMode = 'lesson' | 'simpler' | 'deeper' | 'quiz' | 'socratic';

const TutorRequestBody = z.object({
  topic:       z.string().min(1),
  mode:        z.enum(['lesson', 'simpler', 'deeper', 'quiz', 'socratic']).default('lesson'),
  educationLevel: z.string().optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).default([]),
  lastAnswer: z.string().optional().nullable(),
  // A free-text instruction that rides along with the topic — powers the
  // "show me a diagram" and "I don't understand this part" interactions.
  instruction: z.string().max(4000).optional().nullable(),
  // Documents the student uploaded for this session. The text was extracted
  // in the browser (PDF/DOCX/PPTX/OCR); the server only proxies it.
  documents: z.array(z.object({
    name: z.string(),
    text: z.string(),
  })).max(10).default([]),
  // The briefing produced by /api/ai/document/analyze — a compact digest of
  // the uploaded material (overview + key points) that is cheap to send with
  // every follow-up question.
  documentBrief: z.string().optional().nullable(),
});

/**
 * Ask the model for the key points of a passage it has just written.
 *
 * This is the fallback for the rare reply that forgot the machine-readable
 * block — a second, cheap call (low thinking, JSON mode) recovers the points
 * so the "Key points" panel is never silently empty.
 */
async function fallbackKeyPoints(
  cfg: { provider: string; model: string; apiKey: string },
  passage: string,
  audience: string,
): Promise<KeyPoint[]> {
  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        {
          role: 'user',
          content: `Extract the 4-8 most important points a ${audience} student must know from the study material below.
Return JSON: { "keyPoints": [ { "point": string, "why": string, "importance": "must-know" | "should-know" | "good-to-know" } ] }

Material:
${passage.slice(0, 12000)}`,
        },
      ],
      temperature: 0.2, maxTokens: 900, jsonMode: true, thinking: 'low',
    });
    return parseKeyPoints(raw);
  } catch {
    return [];
  }
}

aiRouter.post('/tutor', requireAI, zValidator('json', TutorRequestBody), async c => {
  const user = c.get('user');
  const { topic, mode, educationLevel, history, lastAnswer, documents, documentBrief, instruction } = c.req.valid('json');

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
    socratic: `You are running a Socratic session on "${topic}" for a ${audience} student. You do not tell the student the answer — you lead them to it by asking questions.

Rules for every reply:
- Ask EXACTLY ONE question per reply. Never two questions in the same reply.
- Never state the answer, the definition or the conclusion yourself. If the student asks you to "just tell them", do not lecture: ask the one question that lets them work it out, and offer to reveal the answer if they ask a second time.
- Build up from what the student already knows. Ask about a prerequisite before you ask about the hard part.
- If the student's answer is wrong, say which part of it is off and ask a narrower question that lets them spot the mistake themselves. Do not restate the correct answer.
- If the student is stuck, give a smaller hint — then, if they are still stuck, a smaller hint still. Only give the answer after they have genuinely tried, and then say plainly what the answer was and why.
- Keep the reply short: at most four short sentences plus the question.
- When the student has shown they understand, say so plainly, summarise in one line what they worked out, and ask one deeper question to stretch them further.
- Never use headings, tables or diagrams in a Socratic reply — a wall of notes is exactly the thing the student is being asked not to read.`,
  };

  // Output contract. The client renders the reply as markdown, so a little
  // structure helps — but raw LaTeX ("$x$", "\frac{a}{b}") and symbol soup
  // ("##", "**", "|---|") made the answers unreadable, so the model is told
  // to write maths in plain text instead.
  const FORMAT_RULES = `Formatting rules for every reply:
- Use short markdown headings (##), bullet lists (-), and markdown tables for comparisons.
- Never use LaTeX or LaTeX delimiters. No "$", no "\\(", no "\\frac", no "\\sum", no "\\alpha".
- Write formulas as plain readable text: "E = mc^2", "x squared", "a/b", "sqrt(x)", "sum of n = 1 to 10".
- Use ordinary words for symbols: "less than or equal to", "approximately", "therefore".
- Never repeat a heading marker, never output raw table pipe rows without a header row.

Diagram rules — a picture costs far more tokens than a sentence, so use the cheapest form that works:
- Most replies need NO diagram. Never draw one for a definition, a summary, a list of facts, or a comparison (use a markdown table for comparisons).
- Simple flow, sequence or cycle (5 or fewer steps, no branching, nothing to label): draw a plain-text diagram in a \`\`\`diagram block using box-drawing characters (┌ ─ ┐ │ └ ┘ ├ ┤ and → ↓), one line per box, 3-10 lines in total. This is cheap and students read it fine.
- Use an SVG (a \`\`\`svg block) ONLY when the concept is genuinely spatial: geometry, anatomy, a labelled structure, a branching process, or a timeline with scale. Keep it minimal — one <svg> element with viewBox="0 0 680 H", font-size 13-16 for labels, at most about 12 shapes and 8 short labels, flat fills, no gradients, shadows or decoration.
- Absolutely no <script>, no <foreignObject>, no <image>, no external references, no event handler attributes. Everything must live inside the SVG itself.
- At most ONE diagram per reply, and never redraw a diagram you already drew — refer back to it instead.
- Follow the diagram with one line on how to read it, then continue the normal explanation.`;

  // ── Uploaded document context ───────────────────────────────────────────────
  // When the student attached files, the lesson must be grounded in them
  // rather than in general knowledge.
  const docs = documents ?? [];
  let documentContext = '';
  if (docs.length > 0) {
    const budget = 60_000; // ~15k tokens of source material per request
    let used = 0;
    const excerpts: string[] = [];
    for (const doc of docs) {
      if (used >= budget) break;
      const room = budget - used;
      const slice = doc.text.slice(0, room);
      used += slice.length;
      excerpts.push(`--- ${doc.name} ---\n${slice}`);
    }
    const brief = documentBrief ? `\n\nBriefing from the document analysis:\n${documentBrief.slice(0, 6000)}` : '';
    documentContext = `\n\nThe student uploaded the following document(s). Ground your answer in them and refer to them by name.\n${brief}\n\n${excerpts.join('\n\n')}`;
  }

  // The key-points block is what powers the "Key points to remember" panel.
  // A quiz doesn't need one — it produces questions, not revision notes. A
  // Socratic reply doesn't either: it is one question, and a list of key
  // points under it would hand the student the very thing we are asking them
  // to work out for themselves.
  const wantsKeyPoints = mode !== 'quiz' && mode !== 'socratic';

  const messages = [
    {
      role: 'system',
      content: `${SYSTEM_BASE}\nYou are an expert AI tutor. ${modeInstructions[mode]}${studentContext}\n${FORMAT_RULES}${wantsKeyPoints ? `\n${KEY_POINTS_INSTRUCTION}` : ''}`,
    },
    ...history,
    {
      role: 'user',
      // The student's own ask rides along with the topic. `instruction` is
      // how "show me a diagram" and "explain this part" reach the model, so
      // it must never be dropped — not even when a quiz answer is present.
      // The uploaded material rides here too: it is source material to
      // ground the answer on, not an instruction.
      //
      // A Socratic session is different: the student's reply to the tutor's
      // previous question arrives as `lastAnswer`, and the topic has to stay
      // in view every time or the model loses what it is leading them to.
      content: mode === 'socratic'
        ? [
            `Topic: ${topic}`,
            lastAnswer
              ? `Student answer: ${lastAnswer}`
              : 'The student has just asked to work through this topic Socratically. Open with your first question.',
            instruction ?? '',
            documentContext.trim(),
          ].filter(Boolean).join('\n\n')
        : [
            lastAnswer ? `Student answer: ${lastAnswer}` : `Topic: ${topic}`,
            instruction ?? '',
            documentContext.trim(),
          ].filter(Boolean).join('\n\n'),
    },
  ];

  try {
    const raw = await callProvider({
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      messages,
      temperature: mode === 'quiz' ? 0.4 : mode === 'socratic' ? 0.6 : 0.7,
      // A lesson is long: exam-ready notes *plus* a labelled SVG diagram.
      // At 4000 tokens the reply was sometimes cut off mid-diagram, which
      // left the student staring at raw SVG markup instead of a picture.
      //
      // A Socratic reply is one question — a few sentences at most. Letting
      // the model write 8000 tokens of it would break the whole point of the
      // mode, so it gets a tight budget and it has to fit in one.
      maxTokens: mode === 'quiz' ? 1200 : mode === 'socratic' ? 700 : 8000,
      // A lesson is the one place where thinking pays off; a quiz just
      // needs recall. A Socratic question needs thought but not deep
      // reasoning — the model is asking, not solving.
      thinking: mode === 'quiz' ? 'low' : mode === 'socratic' ? 'low' : 'medium',
    });

    // Split the machine-readable key-points block out of the reply so the
    // user never sees the raw markers, and so the UI can render the points
    // as a structured panel.
    const extracted = extractKeyPointsBlock(raw);
    let keyPoints = extracted.keyPoints;

    // Rare fallback: the model forgot the block — ask again, cheaply.
    if (wantsKeyPoints && keyPoints.length === 0) {
      keyPoints = await fallbackKeyPoints(cfg, extracted.text || raw, audience);
    }

    return c.json({
      topic,
      mode,
      educationLevel: effectiveLevel,
      response: extracted.text,
      keyPoints,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/document/analyze — turn an uploaded file into study material ──
// The browser extracts the text (PDF/DOCX/PPTX/OCR); the server asks the
// model to turn it into a briefing: an explanation, the important points the
// student must know, the structure of the document, key vocabulary and likely
// exam questions.
const DocumentBody = z.object({
  documents: z.array(z.object({
    name: z.string().min(1),
    text: z.string().min(1),
  })).min(1).max(10),
  educationLevel: z.string().optional().nullable(),
});

aiRouter.post('/document/analyze', requireAI, zValidator('json', DocumentBody), async c => {
  const user = c.get('user');
  const { documents, educationLevel } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const profileBits = studentProfileBits(user);
  const audience = profileBits.length > 0
    ? profileBits.join(', ')
    : (educationLevel ?? 'college level');

  // Keep the request under control — a long chapter still fits comfortably.
  const budget = 120_000;
  let used = 0;
  const sources: string[] = [];
  for (const doc of documents) {
    if (used >= budget) break;
    const room = budget - used;
    const slice = doc.text.slice(0, room);
    used += slice.length;
    sources.push(`--- ${doc.name} ---\n${slice}`);
  }

  const prompt = `Analyse the study material a student uploaded and turn it into revision notes.
Return JSON only, with this exact shape:
{
  "title": string,
  "overview": string,
  "keyPoints": [ { "point": string, "why": string, "importance": "must-know" | "should-know" | "good-to-know" } ],
  "outline": [ { "heading": string, "detail": string } ],
  "glossary": [ { "term": string, "meaning": string } ],
  "questions": [ string ]
}

Rules:
- "title": a short, specific title for the material (max 8 words).
- "overview": 3-6 paragraphs of markdown explaining what the material covers, how it is organised, and how a student should revise it. Use "##" headings and bullet lists. Write formulas as plain readable text ("E = mc^2", "a/b"), never LaTeX.
- "keyPoints": 5-12 points, ordered most important first. Each "point" is one sentence a student can memorise; "why" explains what it unlocks or what breaks if they get it wrong. Mark the core examinable ideas "must-know", supporting detail "should-know", and extras "good-to-know".
- "outline": the document's structure, 3-10 entries, each with a one-line detail.
- "glossary": 0-12 terms that a student at this level would need defined. Omit the section's entries if the document has no specialist vocabulary.
- "questions": 5-8 likely exam questions on this material.
- Never invent content that is not in the material. If the material is incomplete, say so in the overview.
- Never use LaTeX, "$", or symbol soup.

Student level: ${audience}.`;

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user', content: `${prompt}\n\nMaterial:\n\n${sources.join('\n\n')}` },
      ],
      temperature: 0.4, maxTokens: 6000, jsonMode: true, thinking: 'medium',
    });

    const parsed = parseDocumentAnalysis(raw);
    return c.json(parsed);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * Normalise the document-analysis JSON. The model occasionally wraps the
 * payload in a code fence or returns a string where an array was asked for,
 * so every field is coerced rather than trusted.
 */
function parseDocumentAnalysis(raw: string): {
  title: string;
  overview: string;
  keyPoints: KeyPoint[];
  outline: { heading: string; detail: string }[];
  glossary: { term: string; meaning: string }[];
  questions: string[];
} {
  let obj: any = null;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    obj = JSON.parse(candidate);
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      obj = match ? JSON.parse(match[0]) : null;
    } catch {
      obj = null;
    }
  }

  if (!obj || typeof obj !== 'object') {
    // Not JSON at all — hand the raw text back as the overview so the
    // student still gets something useful.
    return {
      title: 'Uploaded material',
      overview: raw.trim(),
      keyPoints: [],
      outline: [],
      glossary: [],
      questions: [],
    };
  }

  const asArray = (v: any): any[] => (Array.isArray(v) ? v : []);

  return {
    title: typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Uploaded material',
    overview: typeof obj.overview === 'string' ? obj.overview.trim() : '',
    keyPoints: parseKeyPoints(obj.keyPoints ?? obj.key_points ?? obj.points),
    outline: asArray(obj.outline).map((o: any) => ({
      heading: String(o?.heading ?? o?.title ?? o?.section ?? '').trim(),
      detail: String(o?.detail ?? o?.summary ?? o?.description ?? '').trim(),
    })).filter((o: any) => o.heading || o.detail),
    glossary: asArray(obj.glossary).map((g: any) => ({
      term: String(g?.term ?? g?.word ?? '').trim(),
      meaning: String(g?.meaning ?? g?.definition ?? '').trim(),
    })).filter((g: any) => g.term),
    questions: asArray(obj.questions).map((q: any) => String(q?.question ?? q ?? '').trim()).filter(Boolean),
  };
}

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

// ── POST /api/ai/mnemonic ─────────────────────────────────────────────────────
// A card the student keeps failing gets a memory hook: a short, weird story
// or rhyme that encodes the answer. Deliberately simple to generate so the
// model does not wander into essays.
aiRouter.post('/mnemonic', requireAI, zValidator('json', z.object({
  question: z.string().min(1).max(500),
  answer:   z.string().min(1).max(500),
  topic:    z.string().max(120).optional(),
})), async c => {
  const user = c.get('user');
  const { question, answer, topic } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const studentCtx = studentPromptContext(studentProfileBits(user));

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
        {
          role: 'user',
          content: `Write a memory hook for this flashcard.
${topic ? `Topic: ${topic}\n` : ''}Question: ${question}
Answer: ${answer}

Rules:
- One vivid image, story, acronym or rhyme that encodes the answer.
- Under 30 words. One or two sentences.
- No preamble, no explanation of the technique, no quotes.
- It must actually make the answer memorable, not just restate it.
Return JSON: { "mnemonic": "..." }`,
        },
      ],
      temperature: 0.8, maxTokens: 300, jsonMode: true, thinking: 'low',
    });
    const parsed = JSON.parse(raw);
    const mnemonic = String(parsed.mnemonic ?? '').trim();
    if (!mnemonic) return c.json({ error: 'The model did not return a mnemonic' }, 502);
    return c.json({ mnemonic });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/cloze ────────────────────────────────────────────────────────
// Turn a passage into cloze-deletion cards: the answer is hidden inside the
// sentence, which is a much stronger memory exercise than question/answer.
aiRouter.post('/cloze', requireAI, zValidator('json', z.object({
  title:   z.string().max(300).default(''),
  content: z.string().min(20).max(20000),
  count:   z.number().int().min(1).max(20).default(5),
})), async c => {
  const user = c.get('user');
  const { title, content, count } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const studentCtx = studentPromptContext(studentProfileBits(user));

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
        {
          role: 'user',
          content: `Turn this passage into exactly ${count} cloze-deletion flashcards.
${title ? `Title: ${title}\n` : ''}Passage:
${content}

Rules:
- Each card's "question" is a sentence from the passage with exactly one key term replaced by {{c1}}.
- The key term must be the single most exam-worthy word or phrase in that sentence.
- The card's "answer" is the missing term only.
- Keep the surrounding sentence short (under 30 words) and self-contained.
- No numbering, no commentary.
Return JSON: { "cards": [ { "question": "... {{c1}} ...", "answer": "..." } ] }`,
        },
      ],
      temperature: 0.4, maxTokens: 4096, jsonMode: true, thinking: 'low',
    });
    const parsed = JSON.parse(raw);
    const cards = (parsed.cards ?? [])
      .filter((x: any) => typeof x?.question === 'string' && typeof x?.answer === 'string' && x.question.includes('{{c1}}'))
      .slice(0, count)
      .map((x: any) => ({ question: x.question.trim(), answer: x.answer.trim() }));
    if (cards.length === 0) return c.json({ error: 'No usable cloze cards were produced' }, 502);
    return c.json({ cards });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ── POST /api/ai/fix-card — rewrite a leech card so it sticks ─────────────────
// A card rated "Again" again and again is usually badly worded, not badly
// studied: two facts in one question, an ambiguous answer, a negation nobody
// parses. The rewrite keeps the same fact but says it cleanly. The client
// shows the rewrite side by side with the original and nothing is saved until
// the student accepts — the server never touches the card itself.
const FixCardBody = z.object({
  question: z.string().min(1).max(2000),
  answer:   z.string().min(1).max(4000),
  topic:    z.string().max(120).optional(),
  // How many times the card has been rated "Again" — a hint for how much the
  // wording is the problem (a 12-times leech needs surgery, not a polish).
  leechCount: z.number().int().min(0).max(10_000).optional(),
});

aiRouter.post('/fix-card', requireAI, zValidator('json', FixCardBody), async c => {
  const user = c.get('user');
  const { question, answer, topic, leechCount } = c.req.valid('json');

  let cfg;
  try { cfg = await loadAIConfig(user.id); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }

  const studentCtx = studentPromptContext(studentProfileBits(user));

  try {
    const raw = await callProvider({
      provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
      messages: [
        { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
        {
          role: 'user',
          content: `Rewrite this flashcard so a student can actually remember it.${topic ? ` Subject: ${topic}.` : ''}${leechCount ? ` It has been rated "Again" ${leechCount} times, so the wording is almost certainly the problem.` : ''}

Question: ${question}
Answer: ${answer}

Rules:
- Keep the exact same fact — never answer a different question.
- One idea per card. If the question smuggles in two, split out the one that makes the answer long, and keep the question answerable in a word or a sentence.
- Make the question precise: no "what about", no vagueness, no double negatives.
- Make the answer short and unambiguous — the shortest thing that is still complete.
- Never use LaTeX or symbol soup; write formulas as plain text ("E = mc^2", "a/b").
- Preserve cloze markers ({{c1}}) if the question has one.
Return JSON: { "question": "...", "answer": "...", "whatChanged": "one short sentence on what was wrong" }`,
        },
      ],
      temperature: 0.4, maxTokens: 800, jsonMode: true, thinking: 'low',
    });

    const fix = parseFixCardReply(raw);
    if (!fix) return c.json({ error: 'The model did not return a usable rewrite' }, 502);
    return c.json(fix);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * Normalise the fix-card reply. The model occasionally wraps the JSON in a
 * code fence, so the fence is stripped before parsing — and if the result is
 * not a usable card, nothing is returned rather than a half-rewrite.
 */
function parseFixCardReply(raw: string): { question: string; answer: string; whatChanged: string } | null {
  let obj: any = null;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    obj = JSON.parse(fenced ? fenced[1].trim() : trimmed);
  } catch {
    return null;
  }

  const question = typeof obj?.question === 'string' ? obj.question.trim() : '';
  const answer   = typeof obj?.answer   === 'string' ? obj.answer.trim()   : '';
  if (!question || !answer) return null;

  return {
    question,
    answer,
    whatChanged: typeof obj?.whatChanged === 'string' ? obj.whatChanged.trim() : '',
  };
}
