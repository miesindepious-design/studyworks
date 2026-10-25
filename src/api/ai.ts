/**
 * AI client — talks to the server's /api/ai/* proxy.
 *
 * The user's API key is stored encrypted on the server (server/src/routes/ai.ts
 * uses `encryptApiKey`/`decryptApiKey`). The client never holds the real key
 * after the first save — only the public config (provider, model, hasApiKey,
 * custom prompts). This means:
 *   1. Switching devices "just works" — the key follows the user.
 *   2. The server can rate-limit and count usage (see server/src/lib/rateLimit.ts).
 *   3. The provider never sees our users' IPs directly.
 *
 * For users who explicitly want to keep their key 100% local, there's a
 * fallback path: `clientOnly` mode. Default is server proxy.
 */

import { apiGet, apiPost, apiPut } from './client';
import type { Note, Flashcard } from '../types';

export interface ServerAIConfig {
  provider:             'gemini' | 'openai';
  model:                string;
  enabled:              boolean;
  hasApiKey:            boolean;
  customSummaryPrompt:  string | null;
  customFlashcardPrompt: string | null;
  customQAPrompt:       string | null;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function fetchAISettings(): Promise<ServerAIConfig | null> {
  try {
    return await apiGet<ServerAIConfig>('/api/ai/settings');
  } catch (err) {
    // 401/403 expected when not signed in — return null rather than throwing.
    console.warn('[ai] fetchAISettings failed:', err);
    return null;
  }
}

export interface SaveAISettingsBody {
  provider:             'gemini' | 'openai';
  model:                string;
  enabled:              boolean;
  apiKey?:              string;        // optional — only sent when changing the key
  customSummaryPrompt?:  string | null;
  customFlashcardPrompt?: string | null;
  customQAPrompt?:       string | null;
}

export async function saveAISettings(body: SaveAISettingsBody): Promise<ServerAIConfig> {
  return apiPut<ServerAIConfig>('/api/ai/settings', body);
}

// ── Feature endpoints (server proxy) ──────────────────────────────────────────

export async function serverSummary(title: string, content: string): Promise<string> {
  const res = await apiPost<{ summary: string; error?: string }>('/api/ai/summary', { title, content });
  if (res.error) throw new Error(res.error);
  return res.summary;
}

export async function serverFlashcards(title: string, content: string, count = 5, hard = false) {
  const res = await apiPost<{ flashcards: { question: string; answer: string; difficulty?: string; type?: string }[]; error?: string }>(
    '/api/ai/flashcards', { title, content, count, hard }
  );
  if (res.error) throw new Error(res.error);
  return res.flashcards;
}

export async function serverPracticeQuestions(title: string, content: string, count = 4) {
  const res = await apiPost<{ questions: { question: string; answer: string; type: string; options?: string[] }[]; error?: string }>(
    '/api/ai/practice-questions', { title, content, count }
  );
  if (res.error) throw new Error(res.error);
  return res.questions;
}

export async function serverQA(query: string, notes: Note[]): Promise<string> {
  const contexts = notes.map(n => ({
    title:   n.title,
    content: n.content,
    summary: n.summary,
  }));
  const res = await apiPost<{ answer: string; error?: string }>('/api/ai/qa', { query, contexts });
  if (res.error) throw new Error(res.error);
  return res.answer;
}

export async function serverRerank(query: string, notes: Note[]): Promise<string[]> {
  if (notes.length === 0) return [];
  const candidates = notes.map(n => ({
    id:      n.id,
    title:   n.title,
    snippet: (n.summary ?? n.content).slice(0, 150),
  }));
  const res = await apiPost<{ ranked: string[]; error?: string }>('/api/ai/rerank', { query, candidates });
  if (res.error) throw new Error(res.error);
  return res.ranked;
}

export interface WeeklyInsightsServer {
  insights: { title: string; body: string; type: 'pattern' | 'suggestion' | 'streak' | 'review' }[];
}

export async function serverInsights(notes: Note[], flashcards: Flashcard[]): Promise<WeeklyInsightsServer> {
  const body = {
    notes: notes.map(n => ({
      title:     n.title,
      content:   n.content,
      tags:      n.tags,
      createdAt: n.createdAt.toISOString(),
    })),
    flashcards: flashcards.map(c => ({
      question:    c.question,
      difficulty:  c.difficulty,
      repetitions: c.repetitions,
      nextReview:  c.nextReview?.toISOString(),
    })),
  };
  const res = await apiPost<WeeklyInsightsServer & { error?: string }>('/api/ai/insights', body);
  if (res.error) throw new Error(res.error);
  return res;
}

// ── Practice question helper (server returns `type: string`, narrow it) ─────
export type NarrowPracticeType = 'multiple-choice' | 'true-false' | 'open';

export function narrowPracticeQuestion(
  q: { question: string; answer: string; type: string; options?: string[] }
): import('../types').PracticeQuestion & { question: string; answer: string } {
  const t: NarrowPracticeType =
    q.type === 'multiple-choice' || q.type === 'true-false' || q.type === 'open'
      ? q.type
      : 'open';
  return {
    id:       crypto.randomUUID(),
    question: q.question,
    answer:   q.answer,
    type:     t,
    options:  q.options,
    createdAt: new Date(),
  };
}

export interface TutorRequest {
  topic: string;
  mode: 'lesson' | 'simpler' | 'deeper' | 'quiz';
  educationLevel?: string | null;
  history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  lastAnswer?: string | null;
}

export interface TutorResponse {
  topic: string;
  mode: 'lesson' | 'simpler' | 'deeper' | 'quiz';
  educationLevel: string | null;
  response: string;
}

export async function serverTutor(body: TutorRequest): Promise<TutorResponse> {
  const res = await apiPost<TutorResponse>('/api/ai/tutor', {
    topic: body.topic,
    mode: body.mode,
    educationLevel: body.educationLevel ?? null,
    history: body.history ?? [],
    lastAnswer: body.lastAnswer ?? null,
  });
  return res;
}

export async function saveUserProfile(educationLevel: string | null) {
  return apiPut<{ user: { id: string; email: string; educationLevel: string | null } }>('/api/ai/profile', {
    educationLevel,
  });
}
