/**
 * deckProgress.ts — how far along each deck is.
 *
 * `DeckProgress` was declared in `src/types.ts` and used nowhere. The shape
 * was already right — a folder, some counts and a percentage — it just
 * needed filling in.
 *
 * A "deck" here is a folder of cards. Students think in decks ("Biology",
 * "Quadratics"), and the Mastery Map answers "which *topic* do I know",
 * but nothing answered "how far through my Biology deck am I". This module
 * does.
 *
 * The counts come from the same spaced-repetition state the review uses:
 *
 *   - **new**      — never reviewed.
 *   - **learning** — reviewed, but not yet easy enough to count as known.
 *   - **mastered** — reviewed several times *and* the ease factor says the
 *                    student finds it easy.
 *   - **due**      — scheduled to come back now.
 *
 * `progress` is the share that is mastered or well on the way, so a deck
 * that is half learned does not read as half done.
 */
import type { DeckProgress, Flashcard, Folder } from '../types';

/** A card is mastered after this many successful repetitions... */
const MASTERED_REPETITIONS = 3;
/** ...and an ease factor this high. */
const MASTERED_EF = 2.3;
/** Learning credit for a card that is progressing but not yet mastered. */
const LEARNING_CREDIT = 0.4;

function isDue(card: Flashcard, now: Date): boolean {
  if (!card.nextReview) return true;
  return new Date(card.nextReview).getTime() <= now.getTime();
}

/**
 * Compute the progress of every deck.
 *
 * Cards in no folder at all are reported under the default folder, so a
 * student who has not filed their cards still sees a deck rather than
 * nothing at all.
 */
export function computeDeckProgress(
  flashcards: Flashcard[],
  folders: Folder[],
  now = new Date(),
): DeckProgress[] {
  const byFolder = new Map<string, Flashcard[]>();
  for (const card of flashcards) {
    const key = card.folderId ?? 'default';
    const list = byFolder.get(key);
    if (list) list.push(card);
    else byFolder.set(key, [card]);
  }

  // Every folder gets a row, even an empty one — a student with an empty
  // "Exam prep" folder should see that it is empty, not that it is missing.
  const folderIds = new Set(folders.map(f => f.id));
  for (const key of byFolder.keys()) folderIds.add(key);

  const out: DeckProgress[] = [];

  for (const folderId of folderIds) {
    const cards = byFolder.get(folderId) ?? [];
    const folder = folders.find(f => f.id === folderId);
    const name = folder?.name ?? (folderId === 'default' ? 'Unfiled' : 'Unfiled');

    let n = 0, learning = 0, mastered = 0, due = 0;
    for (const card of cards) {
      const reps = card.repetitions ?? 0;
      const ef = card.ef ?? 2.5;

      if (reps === 0) n += 1;
      else if (reps >= MASTERED_REPETITIONS && ef >= MASTERED_EF) mastered += 1;
      else learning += 1;

      if (isDue(card, now)) due += 1;
    }

    const total = cards.length;
    // Mastered counts fully; learning counts partially. A deck that is a
    // third mastered and a third learning should not read as a third done.
    const raw = total > 0 ? (mastered / total) * 100 : 0;
    const learningShare = total > 0 ? (learning / total) * LEARNING_CREDIT * 100 : 0;

    out.push({
      folderId,
      name,
      total,
      mastered,
      learning,
      new: n,
      due,
      progress: Math.round(Math.min(100, raw + learningShare)),
    });
  }

  // The deck with the most work waiting goes first, then by size.
  out.sort((a, b) => (b.due - a.due) || (b.total - a.total) || a.name.localeCompare(b.name));
  return out;
}

/**
 * The overall progress across every deck, as a single number.
 */
export function overallProgress(decks: DeckProgress[]): number {
  const total = decks.reduce((s, d) => s + d.total, 0);
  if (total === 0) return 0;
  const weighted = decks.reduce((s, d) => s + d.progress * d.total, 0);
  return Math.round(weighted / total);
}

/**
 * A one-line description of a deck's state, in words.
 */
export function deckSummary(deck: DeckProgress): string {
  if (deck.total === 0) return 'Empty deck';
  const parts: string[] = [`${deck.mastered} of ${deck.total} mastered`];
  if (deck.due > 0) parts.push(`${deck.due} due`);
  if (deck.new > 0) parts.push(`${deck.new} new`);
  return parts.join(' · ');
}
