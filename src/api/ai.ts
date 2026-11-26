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
  /** The user stored their OWN key (not the backend-managed fallback). */
  hasOwnKey:            boolean;
  serverManaged:        boolean;
  /** AI features are available to this user (Pro/trial, own key, or backend key). */
  canUseAI:             boolean;
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

export interface TestAIKeyBody {
  provider?: 'gemini' | 'openai';
  model?:    string;
  /** Omit to test the key already stored on the server. */
  apiKey?:   string;
}

export interface TestAIKeyResult {
  ok:     boolean;
  provider?: string;
  model?:    string;
  reply?:    string;
  error?:    string;
}

/**
 * Validate an AI API key with one tiny provider call — without saving it.
 * Used by the registration-time "connect your AI key" step so the user gets
 * instant feedback before anything is persisted.
 */
export async function testAIKey(body: TestAIKeyBody): Promise<TestAIKeyResult> {
  try {
    return await apiPost<TestAIKeyResult>('/api/ai/test', body);
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection test failed.' };
  }
}

// ── Feature endpoints (server proxy) ──────────────────────────────────────────

export async function serverSummary(title: string, content: string): Promise<string> {
  const res = await apiPost<{ summary: string; error?: string }>('/api/ai/summary', { title, content });
  if (res.error) throw new Error(res.error);
  return res.summary;
}

export async function serverFlashcards(title: string, content: string, count = 15, hard = false) {
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

/** A proposed rewrite of a leech card, straight from the server. */
export interface CardFix {
  question: string;
  answer: string;
  /** One short sentence on what was wrong with the original wording. */
  whatChanged: string;
}

/**
 * Ask the AI to rewrite a card the student keeps failing. Nothing is saved
 * here — the caller shows the rewrite next to the original and only applies
 * it if the student accepts.
 */
export async function serverFixCard(
  question: string,
  answer: string,
  opts: { topic?: string; leechCount?: number } = {},
): Promise<CardFix> {
  const res = await apiPost<CardFix & { error?: string }>('/api/ai/fix-card', {
    question,
    answer,
    topic: opts.topic,
    leechCount: opts.leechCount,
  });
  if (res.error) throw new Error(res.error);
  return { question: res.question, answer: res.answer, whatChanged: res.whatChanged };
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
  mode: 'lesson' | 'simpler' | 'deeper' | 'quiz' | 'socratic';
  educationLevel?: string | null;
  history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  lastAnswer?: string | null;
  /** Free-text rider on the topic — "draw the diagram", "explain this part". */
  instruction?: string | null;
  /** Documents uploaded for this session (text already extracted in the browser). */
  documents?: TutorDocument[];
  /** Compact digest of the uploaded material, produced by the analyzer. */
  documentBrief?: string | null;
}

/** A file the student attached to the tutor. */
export interface TutorDocument {
  name: string;
  text: string;
}

export type KeyPointImportance = 'must-know' | 'should-know' | 'good-to-know';

/** One "you must know this" point, with why it matters. */
export interface KeyPoint {
  point: string;
  why: string;
  importance: KeyPointImportance;
}

export interface TutorResponse {
  topic: string;
  mode: 'lesson' | 'simpler' | 'deeper' | 'quiz';
  educationLevel: string | null;
  response: string;
  /** The important points for this topic — rendered as a revision panel. */
  keyPoints?: KeyPoint[];
}

export async function serverTutor(body: TutorRequest): Promise<TutorResponse> {
  const res = await apiPost<TutorResponse>('/api/ai/tutor', {
    topic: body.topic,
    mode: body.mode,
    educationLevel: body.educationLevel ?? null,
    history: body.history ?? [],
    lastAnswer: body.lastAnswer ?? null,
    instruction: body.instruction ?? null,
    documents: body.documents ?? [],
    documentBrief: body.documentBrief ?? null,
  });
  return res;
}

// ── Document analysis ────────────────────────────────────────────────────────

export interface DocumentOutlineItem {
  heading: string;
  detail: string;
}

export interface GlossaryItem {
  term: string;
  meaning: string;
}

/** The briefing the tutor builds from an uploaded file. */
export interface DocumentAnalysis {
  title: string;
  overview: string;
  keyPoints: KeyPoint[];
  outline: DocumentOutlineItem[];
  glossary: GlossaryItem[];
  questions: string[];
}

/**
 * Turn uploaded files into study material: an explanation of the document,
 * the important points the student must know, its structure, key vocabulary
 * and likely exam questions.
 */
export async function serverAnalyzeDocuments(
  documents: TutorDocument[],
  educationLevel?: string | null,
): Promise<DocumentAnalysis> {
  const res = await apiPost<DocumentAnalysis & { error?: string }>('/api/ai/document/analyze', {
    documents,
    educationLevel: educationLevel ?? null,
  });
  if (res.error) throw new Error(res.error);
  return res;
}

export async function saveUserProfile(educationLevel: string | null) {
  return apiPut<{ user: { id: string; email: string; educationLevel: string | null } }>('/api/ai/profile', {
    educationLevel,
  });
}

export interface StudentProfile {
  schoolStage:    'primary' | 'secondary' | 'university' | null;
  schoolClass:    string | null;
  universityYear: string | null;
  department?:    string | null;
}

export interface StudentProfileResponse {
  user: {
    id: string;
    email: string;
    educationLevel: string | null;
    schoolStage:    string | null;
    schoolClass:    string | null;
    universityYear: string | null;
    department:     string | null;
  };
}

/**
 * Read the student's saved credentials. The Settings page uses this to
 * render the profile card — without it the card always looked empty.
 */
export async function fetchStudentProfile(): Promise<StudentProfileResponse | null> {
  try {
    return await apiGet<StudentProfileResponse>('/api/ai/profile');
  } catch (err) {
    console.warn('[ai] fetchStudentProfile failed:', err);
    return null;
  }
}

/**
 * Persist the student credentials captured at signup (exact class in
 * primary/secondary school, exact year + department at university). The AI
 * tutor reads these server-side to tailor lessons to the student's exact level.
 */
export async function saveStudentProfile(profile: StudentProfile) {
  return apiPut<StudentProfileResponse>('/api/ai/profile', profile);
}

/**
 * Save the full student profile, including the generic study level used by
 * the AI Tutor (high-school → phd).
 */
export async function saveFullStudentProfile(profile: StudentProfile & { educationLevel?: string | null }) {
  return apiPut<StudentProfileResponse>('/api/ai/profile', profile);
}

