/**
 * High-level AI feature functions.
 * Each takes user content + AIConfig and returns a typed result.
 * Throws AIError on API failure so callers can show meaningful toasts.
 */

import { chatComplete } from './client';
import type { AIConfig } from '../db/aiSettings';

const SYSTEM_BASE = `You are an expert study assistant embedded in StudyWorks, a learning app.
Be concise, accurate, and focused. Never add disclaimers or meta-commentary.`;

function cfg(config: AIConfig) {
  return { provider: config.provider, apiKey: config.apiKey, model: config.model };
}

// ── 2.1 Summary ───────────────────────────────────────────────────────────────
export async function generateSummary(
  title: string, content: string, config: AIConfig
): Promise<string> {
  const customPrompt = config.customSummaryPrompt;
  const prompt = customPrompt ||
    `Summarise the following note in 3-5 concise bullet points.\nStart each bullet with "• ". Keep each bullet under 20 words.`;

  const text = await chatComplete({
    ...cfg(config),
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      { role: 'user', content: `${prompt}\n\nTitle: ${title}\n\nContent:\n${content}` },
    ],
    temperature: 0.3,
    maxTokens: 300,
  });
  return text.trim();
}

// ── 2.2 Flashcard generation ──────────────────────────────────────────────────
export interface GeneratedFlashcard {
  question:    string;
  answer:      string;
  difficulty?: 'easy' | 'medium' | 'hard';
  type?:       'standard' | 'fill-in';
}

export async function generateFlashcards(
  title: string, content: string, count = 5, config: AIConfig, hard = false
): Promise<GeneratedFlashcard[]> {
  const customPrompt = config.customFlashcardPrompt;
  const defaultPrompt = hard
    ? `Create exactly ${count} hard-difficulty flashcards from the note below. Focus on the most complex, commonly misunderstood, and exam-critical areas. Prioritize edge cases, mechanisms, and tricky distinctions. Mark difficulty: mostly hard, some medium. Include a mix of standard and fill-in-the-blank questions to strengthen recall.Return JSON: { "flashcards": [ { "question", "answer", "difficulty": "easy|medium|hard", "type": "standard|fill-in" } ] }`
    : `Create exactly ${count} high-yield flashcards from the note below. Focus on exam-relevant facts, definitions, mechanisms, edge cases, and commonly confused concepts. Mark difficulty: easy, medium, or hard. Include a mix of standard and fill-in-the-blank questions to strengthen recall.Return JSON: { "flashcards": [ { "question", "answer", "difficulty": "easy|medium|hard", "type": "standard|fill-in" } ] }`;
  const prompt = customPrompt || defaultPrompt;

  const raw = await chatComplete({
    ...cfg(config),
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      { role: 'user', content: `${prompt}\n\nTitle: ${title}\n\nContent:\n${content}` },
    ],
    temperature: 0.5,
    maxTokens: 4096,
  });

  try {
    const parsed = JSON.parse(raw);
    const cards: GeneratedFlashcard[] = (parsed.flashcards ?? parsed.cards ?? []);
    return cards.slice(0, count);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).slice(0, count);
    throw new Error('Could not parse flashcard response from AI.');
  }
}

// ── 2.3 Practice questions ────────────────────────────────────────────────────
export interface GeneratedPracticeQuestion {
  question: string;
  answer:   string;
  type:     'multiple-choice' | 'true-false' | 'open';
  options?: string[];
}

export async function generatePracticeQuestions(
  title: string, content: string, count = 4, config: AIConfig
): Promise<GeneratedPracticeQuestion[]> {
  const raw = await chatComplete({
    ...cfg(config),
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      {
        role: 'user',
        content: `Create ${count} varied practice questions from the note below.
Mix types: "multiple-choice" (4 options, correct answer included), "true-false", "open".

Return JSON: { "questions": [ { "question", "answer", "type", "options"? } ] }
- multiple-choice: "options" = array of 4 strings. "answer" must exactly match one option.
- true-false: "answer" is "True" or "False". No "options" field.
- open: just "question" and "answer". No "options" field.

Title: ${title}

Content:
${content}`,
      },
    ],
    temperature: 0.6,
    maxTokens: 1500,
  });

  try {
    const parsed = JSON.parse(raw);
    const qs: GeneratedPracticeQuestion[] = parsed.questions ?? parsed.practice_questions ?? [];
    return qs.slice(0, count);
  } catch {
    throw new Error('Could not parse practice question response from AI.');
  }
}

// ── 2.4 Smart Q&A ─────────────────────────────────────────────────────────────
export async function smartQA(
  query: string,
  noteContexts: { title: string; content: string; summary?: string }[],
  config: AIConfig
): Promise<string> {
  const sorted = noteContexts
    .map(n => ({
      ...n,
      score: (n.title + ' ' + n.content).toLowerCase().split(/\W+/)
        .filter(w => query.toLowerCase().includes(w) && w.length > 3).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const kb = sorted
    .map((n, i) => `[Note ${i + 1}] ${n.title}\n${n.summary || n.content.slice(0, 400)}`)
    .join('\n\n---\n\n');

  const customQA = config.customQAPrompt ||
    'Answer strictly based on the provided notes. If the answer is not in the notes, say so briefly. Cite note titles when referencing them.';

  const text = await chatComplete({
    ...cfg(config),
    messages: [
      {
        role: 'system',
        content: `${SYSTEM_BASE}\nYou have access to the user's personal knowledge base.\n${customQA}`,
      },
      {
        role: 'user',
        content: `Knowledge base:\n\n${kb || 'No notes available.'}\n\n---\n\nQuestion: ${query}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 700,
  });
  return text.trim();
}

// ── 2.5 Semantic re-rank ──────────────────────────────────────────────────────
export async function semanticRerank(
  query: string,
  candidates: { id: string; title: string; snippet: string }[],
  config: AIConfig
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const list = candidates
    .map((c, i) => `${i}: ${c.title} — ${c.snippet.slice(0, 120)}`)
    .join('\n');

  const raw = await chatComplete({
    ...cfg(config),
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      {
        role: 'user',
        content: `Rank these search results by relevance to the query "${query}".
Return JSON: { "ranked": [list of indices in order, most relevant first] }

Results:
${list}`,
      },
    ],
    temperature: 0.1,
    maxTokens: 200,
  });

  try {
    const parsed = JSON.parse(raw);
    const ranked: number[] = parsed.ranked ?? [];
    return ranked.map(i => candidates[i]?.id).filter(Boolean);
  } catch {
    return candidates.map(c => c.id);
  }
}

// ── Weekly AI Insights ────────────────────────────────────────────────────────
export interface WeeklyInsights {
  summary:        string;
  topTopics:      string[];
  suggestedFocus: string;
  reviewReminder: string;
}

export async function generateWeeklyInsights(
  notes:      { title: string; tags: string[]; updatedAt: Date }[],
  flashcards: { question: string; difficulty?: string; nextReview?: Date }[],
  config:     AIConfig
): Promise<WeeklyInsights> {
  const now     = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentNotes = notes
    .filter(n => new Date(n.updatedAt) > weekAgo)
    .map(n => `- ${n.title} [${n.tags.join(', ')}]`)
    .slice(0, 20)
    .join('\n');

  const dueCards  = flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= now).length;
  const hardCards = flashcards.filter(c => c.difficulty === 'hard').length;

  const raw = await chatComplete({
    ...cfg(config),
    jsonMode: true,
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      {
        role: 'user',
        content: `Generate weekly study insights.
Return JSON: { "summary": string, "topTopics": string[], "suggestedFocus": string, "reviewReminder": string }

Activity (${notes.length} total notes, ${recentNotes.split('\n').filter(Boolean).length} updated this week):
${recentNotes || 'No notes updated this week.'}

Flashcard stats: total ${flashcards.length}, due ${dueCards}, hard ${hardCards}.

Keep each field concise (1-3 sentences). Be specific and actionable.`,
      },
    ],
    temperature: 0.4,
    maxTokens: 500,
  });

  try {
    return JSON.parse(raw);
  } catch {
    return {
      summary:        raw.slice(0, 200),
      topTopics:      [],
      suggestedFocus: 'Review your hardest flashcards.',
      reviewReminder: `You have ${dueCards} card${dueCards !== 1 ? 's' : ''} due for review.`,
    };
  }
}

// ── Custom AI prompt runner ───────────────────────────────────────────────────
export async function runCustomPrompt(
  prompt: string, context: string, config: AIConfig
): Promise<string> {
  const text = await chatComplete({
    ...cfg(config),
    messages: [
      { role: 'system', content: SYSTEM_BASE },
      {
        role: 'user',
        content: `Context (note content):\n${context}\n\n---\n\nInstruction: ${prompt}`,
      },
    ],
    temperature: 0.5,
    maxTokens: 800,
  });
  return text.trim();
}
