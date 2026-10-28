/**
 * useAI — loads AI config (server-first, IDB fallback) and exposes AI features.
 *
 * Behavior:
 *   - On mount, calls `fetchAISettings()` to load config from the server.
 *   - Falls back to the IDB config (if any) when the server is unreachable
 *     or returns an error.
 *   - All feature functions go through the server proxy (`api/ai.ts`) which
 *     holds the encrypted API key. The client never sees the real key.
 *   - If the server has no key, we fall back to the client-side implementation
 *     in `../ai/features` (legacy path) so a user who hasn't paid for Pro can
 *     still use AI by pasting their own key.
 *
 * The "isReady" flag is true when EITHER the server has a key OR the local
 * config has one — same UX as before, but with the server as the source of
 * truth for paying users.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAIConfig } from '../db/aiSettings';
import type { AIConfig } from '../db/aiSettings';
import {
  generateSummary           as aiSummary,
  generateFlashcards        as aiFlashcards,
  generatePracticeQuestions as aiPracticeQs,
  smartQA                   as aiQA,
  semanticRerank,
  generateWeeklyInsights    as aiWeeklyInsights,
} from '../ai/features';
import type { GeneratedFlashcard, WeeklyInsights } from '../ai/features';
import type { Note, Flashcard, PracticeQuestion } from '../types';
import { toPlainText } from '../utils/text';
import * as serverAI from '../api/ai';
import type { ServerAIConfig } from '../api/ai';

export type { GeneratedFlashcard, WeeklyInsights };
// The client-side `generatePracticeQuestions` returns GeneratedPracticeQuestion
// (no id, no createdAt). Map that to the same shape `useAI` exposes — the
// component layer will assign ids and timestamps when persisting.
export type GeneratedPracticeQuestion = ReturnType<typeof serverAI.narrowPracticeQuestion>;

export interface UseAIResult {
  // True when EITHER path (server proxy OR local fallback) is ready.
  isReady:      boolean;
  reloadConfig: () => Promise<void>;
  // The merged config the UI can render in Settings.
  config: {
    provider:              'gemini' | 'openai';
    model:                 string;
    enabled:               boolean;
    // For backwards compat with SettingsView (which expects AIConfig shape).
    // Always a placeholder string when the key lives on the server.
    apiKey:                string;
    customSummaryPrompt?:  string;
    customFlashcardPrompt?: string;
    customQAPrompt?:        string;
  };
  // Source-of-truth badge for Settings: where is the key actually being used?
  source:       'server' | 'client' | 'none';

  generateSummary:           (title: string, content: string) => Promise<string>;
  generateFlashcards:        (title: string, content: string, count?: number, hard?: boolean) => Promise<GeneratedFlashcard[]>;
  generatePracticeQuestions: (title: string, content: string, count?: number) => Promise<GeneratedPracticeQuestion[]>;
  smartQA:                   (query: string, notes: Note[]) => Promise<string>;
  semanticSearch:            (query: string, notes: Note[]) => Promise<Note[]>;
  generateWeeklyInsights:    (notes: Note[], flashcards: Flashcard[]) => Promise<WeeklyInsights>;
  runCustomPrompt:           (prompt: string, context: string) => Promise<string>;
}

/** Map server config → local AIConfig shape (with a placeholder key). */
function serverToLocal(s: ServerAIConfig): AIConfig {
  return {
    provider: s.provider,
    model:    s.model,
    enabled:  s.enabled,
    apiKey:   s.hasApiKey ? '(saved on server)' : '',
    customSummaryPrompt:   s.customSummaryPrompt   ?? undefined,
    customFlashcardPrompt: s.customFlashcardPrompt ?? undefined,
    customQAPrompt:        s.customQAPrompt        ?? undefined,
  };
}

export function useAI(): UseAIResult {
  const [local,  setLocal]  = useState<AIConfig | null>(null);
  const [server, setServer] = useState<ServerAIConfig | null>(null);

  const reloadConfig = useCallback(async () => {
    const [localCfg, serverCfg] = await Promise.all([
      getAIConfig().catch(() => null),
      serverAI.fetchAISettings(),
    ]);
    setLocal(localCfg);
    setServer(serverCfg);
  }, []);

  useEffect(() => { reloadConfig(); }, [reloadConfig]);

  // ── Effective config & source-of-truth ────────────────────────────────────
  // Prefer server. Fall back to local if the server has nothing.
  const effective: AIConfig = server?.hasApiKey
    ? serverToLocal(server)
    : (local ?? { provider: 'gemini', model: 'gemini-2.5-flash', enabled: false, apiKey: '' });

  const source: 'server' | 'client' | 'none' =
    server?.hasApiKey ? 'server' :
    (local?.apiKey && local.enabled ? 'client' : 'none');

  const isReady = source !== 'none';

  // ── AI feature wrappers — use server proxy when key is on server, else fallback to client-side ─
  const generateSummary = useCallback(async (title: string, content: string) => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') return serverAI.serverSummary(title, toPlainText(content));
    return aiSummary(title, toPlainText(content), effective);
  }, [source, effective, isReady]);

  const generateFlashcards = useCallback(async (title: string, content: string, count = 5, hard = false) => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') {
      const cards = await serverAI.serverFlashcards(title, toPlainText(content), count, hard);
      return cards.map(c => ({ question: c.question, answer: c.answer, difficulty: c.difficulty as any, type: c.type as any }));
    }
    return aiFlashcards(title, toPlainText(content), count, effective, hard);
  }, [source, effective, isReady]);

  const generatePracticeQuestions = useCallback(async (title: string, content: string, count = 4): Promise<PracticeQuestion[]> => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') {
      const qs = await serverAI.serverPracticeQuestions(title, toPlainText(content), count);
      return qs.map(serverAI.narrowPracticeQuestion);
    }
    // Client-side fallback returns GeneratedPracticeQuestion[] (no id/timestamps).
    // Narrow to the persisted shape with a fresh id and timestamp.
    const generated = await aiPracticeQs(title, toPlainText(content), count, effective);
    return generated.map(g => ({
      id:        crypto.randomUUID(),
      question:  g.question,
      answer:    g.answer,
      type:      g.type,
      options:   g.options,
      createdAt: new Date(),
    }));
  }, [source, effective, isReady]);

  const smartQA = useCallback(async (query: string, notes: Note[]) => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') return serverAI.serverQA(query, notes);
    const contexts = notes.map(n => ({
      title:   n.title,
      content: toPlainText(n.content),
      summary: n.summary,
    }));
    return aiQA(query, contexts, effective);
  }, [source, effective, isReady]);

  const semanticSearch = useCallback(async (query: string, notes: Note[]): Promise<Note[]> => {
    if (!isReady || notes.length === 0) return notes;
    // Server-side rerank when available
    if (source === 'server') {
      const rankedIds = await serverAI.serverRerank(query, notes);
      const idSet     = new Map(notes.map(n => [n.id, n]));
      const ranked    = rankedIds.map(id => idSet.get(id)).filter((n): n is Note => !!n);
      const rankedSet = new Set(rankedIds);
      notes.forEach(n => { if (!rankedSet.has(n.id)) ranked.push(n); });
      return ranked;
    }
    // Client-side fallback (legacy)
    const lower = query.toLowerCase();
    const preFiltered = notes
      .map(n => ({
        note: n,
        score: [n.title, toPlainText(n.content), ...n.tags].join(' ').toLowerCase()
          .split(/\W+/).filter(w => w.length > 2 && lower.includes(w)).length,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(x => x.note);

    const candidates = preFiltered.map(n => ({
      id:      n.id,
      title:   n.title,
      snippet: toPlainText(n.content).slice(0, 150),
    }));

    const rankedIds = await semanticRerank(query, candidates, effective);
    const idSet     = new Map(preFiltered.map(n => [n.id, n]));
    const ranked    = rankedIds.map(id => idSet.get(id)).filter((n): n is Note => !!n);
    const rankedSet = new Set(rankedIds);
    preFiltered.forEach(n => { if (!rankedSet.has(n.id)) ranked.push(n); });
    return ranked;
  }, [source, effective, isReady]);

  const generateWeeklyInsights = useCallback(async (notes: Note[], flashcards: Flashcard[]): Promise<WeeklyInsights> => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') {
      // Server returns `{ insights: [{title, body, type}] }`. The legacy
      // client-side `WeeklyInsights` shape is `{ summary, topTopics, ... }`.
      // Adapt: summarise the server's insights into a single text body and
      // pick the first 3 titles as "topTopics". A future server route can
      // return the legacy shape directly; this adapter keeps the UI
      // working with the existing dashboard component.
      const r = await serverAI.serverInsights(notes, flashcards);
      const summary = r.insights.map(i => `• ${i.title}: ${i.body}`).join('\n');
      return {
        summary,
        topTopics:      r.insights.slice(0, 3).map(i => i.title),
        suggestedFocus: r.insights.find(i => i.type === 'suggestion')?.body ?? 'Keep up your study rhythm.',
        reviewReminder: r.insights.find(i => i.type === 'review')?.body ?? 'Time to review your flashcards.',
      };
    }
    return aiWeeklyInsights(
      notes.map(n => ({ title: n.title, tags: n.tags, updatedAt: n.updatedAt })),
      flashcards.map(c => ({ question: c.question, difficulty: c.difficulty, nextReview: c.nextReview })),
      effective
    );
  }, [source, effective, isReady]);

  const runCustomPrompt = useCallback(async (prompt: string, context: string) => {
    if (!isReady) throw new Error('AI not configured');
    if (source === 'server') {
      // The server's /api/ai/summary endpoint is the closest thing we have
      // to a free-form prompt. Send the user prompt as the title and the
      // context as the content. (Future: a dedicated /api/ai/custom route.)
      return serverAI.serverSummary(prompt, toPlainText(context));
    }
    return aiSummary(prompt, toPlainText(context), effective);
  }, [source, effective, isReady]);

  return {
    config: {
      provider:              effective.provider,
      model:                 effective.model,
      enabled:               effective.enabled,
      apiKey:                effective.apiKey,
      customSummaryPrompt:   effective.customSummaryPrompt,
      customFlashcardPrompt: effective.customFlashcardPrompt,
      customQAPrompt:        effective.customQAPrompt,
    },
    isReady,
    reloadConfig,
    source,
    generateSummary,
    generateFlashcards,
    generatePracticeQuestions,
    smartQA,
    semanticSearch,
    generateWeeklyInsights,
    runCustomPrompt,
  };
}
