/**
 * highlightsToCards.ts — turn the passages a student highlighted into cards.
 *
 * A student who highlights a sentence in a note has already decided what
 * matters. That decision is the most valuable signal in the app, and until
 * now it could not be turned into study material — the only route was
 * "generate flashcards from the whole note", which is a different (and much
 * noisier) operation.
 *
 * Two modes, both offline and deterministic:
 *
 *   - `cloze`  hides the most important word in the highlight. The student
 *              recalls a specific term. This is the Anki convention and it
 *              is what most highlights want.
 *   - `recall` hides the whole highlighted passage and asks for it back.
 *              Good for definitions, formulas and lists — anything where
 *              the answer is the passage itself.
 *
 * If a highlight is too short to hold a cloze, the module falls back to
 * `recall` for it rather than producing a broken card.
 */
import type { Flashcard, Highlight } from '../types';
import { makeClozeCards } from './cloze';

export type HighlightCardMode = 'cloze' | 'recall';

/** The result of converting one highlight. */
export interface HighlightCardDraft {
  question: string;
  answer: string;
  /** Which style of card this is. */
  mode: HighlightCardMode;
  /** The highlight this card came from, so the UI can trace it back. */
  sourceHighlightId: string;
}

/** Below this many characters a highlight cannot hold a useful cloze. */
const MIN_CLOZE_LENGTH = 25;

/**
 * The card stem used in recall mode. It names the note so the student knows
 * what they are recalling, and asks for the passage back.
 */
function recallQuestion(noteTitle: string, text: string): string {
  const lead = text.length > 90 ? text.slice(0, 87) + '…' : text;
  return `Recall this from "${noteTitle}":\n\n${lead}`;
}

/**
 * Convert one highlight into a card draft.
 *
 * Returns null when the highlight is too short or empty to be worth a card —
 * a one-word highlight ("important!") is noise, not study material.
 */
export function highlightToCard(
  highlight: Highlight,
  noteTitle: string,
  mode: HighlightCardMode = 'cloze',
): HighlightCardDraft | null {
  const text = (highlight.text || '').trim();
  if (text.length < 12) return null;

  if (mode === 'recall') {
    return {
      question: recallQuestion(noteTitle, text),
      answer: text,
      mode: 'recall',
      sourceHighlightId: highlight.id,
    };
  }

  // Cloze mode needs a passage long enough to hide a word in.
  if (text.length < MIN_CLOZE_LENGTH) {
    return {
      question: recallQuestion(noteTitle, text),
      answer: text,
      mode: 'recall',
      sourceHighlightId: highlight.id,
    };
  }

  const [cloze] = makeClozeCards(text, 1);
  if (!cloze) {
    // No key term found (the passage was all stop words) — fall back.
    return {
      question: recallQuestion(noteTitle, text),
      answer: text,
      mode: 'recall',
      sourceHighlightId: highlight.id,
    };
  }

  return {
    question: cloze.question,
    answer: cloze.answer,
    mode: 'cloze',
    sourceHighlightId: highlight.id,
  };
}

/**
 * Convert every highlight on a note into card drafts.
 *
 * Duplicate questions are dropped — a student who highlighted the same
 * sentence twice should not get two identical cards.
 */
export function highlightsToCards(
  noteTitle: string,
  highlights: Highlight[],
  mode: HighlightCardMode = 'cloze',
): HighlightCardDraft[] {
  const seen = new Set<string>();
  const drafts: HighlightCardDraft[] = [];

  for (const highlight of highlights) {
    const draft = highlightToCard(highlight, noteTitle, mode);
    if (!draft) continue;
    const key = draft.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(draft);
  }

  return drafts;
}

/**
 * Turn card drafts into real flashcards, ready to be added to the collection.
 *
 * The cards are tagged `highlight` so the student can find them later, and
 * they inherit the note's folder and tags so they land in the right place.
 */
export function draftsToFlashcards(
  drafts: HighlightCardDraft[],
  note: { id: string; tags: string[]; folderId?: string },
): Flashcard[] {
  const now = new Date();
  return drafts.map((draft, i) => ({
    id: `${note.id}-hl-${now.getTime()}-${i}`,
    question: draft.question,
    answer: draft.answer,
    tags: [...note.tags, 'highlight'],
    difficulty: 'medium' as const,
    type: draft.mode === 'cloze' ? ('cloze' as const) : ('standard' as const),
    createdAt: now,
    updatedAt: now,
    folderId: note.folderId,
    source: 'note' as const,
    repetitions: 0,
    interval: 0,
    ef: 2.5,
    leechCount: 0,
  }));
}
