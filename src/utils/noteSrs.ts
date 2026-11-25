/**
 * noteSrs.ts — reviewing a note by recalling it.
 *
 * A note is not a flashcard: it has no single question and no short answer.
 * The student's job is to recall *the note's content* from the title. So a
 * note review works like this:
 *
 *   1. The student sees the title and a short cue (the summary, or the first
 *      line of the body).
 *   2. They think, write down or say what they remember.
 *   3. They reveal the note.
 *   4. They rate their recall: Again / Hard / Good / Easy.
 *
 * That rating drives the same SM-2 curve the cards use, so a note that keeps
 * slipping comes back sooner.
 *
 * Two details matter more than the algorithm:
 *
 *   - **A cue is not the answer.** The cue has to be short enough that
 *     recalling the rest is still work. If the note has no summary, the first
 *     sentence is used; if even that is too long, the title alone is the cue.
 *   - **Long notes are harder to recall, so they need more forgiving
 *     scheduling.** A note that is ten paragraphs long cannot be recalled as
 *     reliably as a two-line fact, so the SM-2 rating is softened towards
 *     "Hard" for long notes. Otherwise the student would keep failing notes
 *     they genuinely know.
 */
import type { Note } from '../types';
import { sm2 } from './sm2';

/** How a student rated their recall of a note. Same scale as cards. */
export type NoteRecallQuality = 0 | 1 | 2 | 3;

/**
 * The note bodies are plain text with HTML from the rich-text editor in
 * them. Strip the markup so the cue is readable.
 */
export function notePlainText(note: Note): string {
  return (note.content || '')
    .replace(/<[^>]*>/g, ' ')      // HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A cue is at most this long. A longer cue gives the answer away.
 */
const MAX_CUE_LENGTH = 140;

/**
 * The note body at or below this length is short enough to recall in one go.
 * Longer notes get a softened rating so the schedule stays honest.
 */
const SHORT_NOTE_LENGTH = 400;

/**
 * Build the cue shown before the note is revealed.
 *
 * The summary is preferred because it is the student-facing summary of the
 * note. Failing that, the opening sentence is used. Failing that, there is
 * no cue and the title is all the student gets.
 */
export function buildCue(note: Note): string {
  const summary = (note.summary || '').trim();
  if (summary) {
    return summary.length > MAX_CUE_LENGTH
      ? summary.slice(0, MAX_CUE_LENGTH - 1).trimEnd() + '…'
      : summary;
  }

  const body = notePlainText(note);
  if (!body) return '';

  // The first sentence is the natural cue.
  const firstSentence = body.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || body;
  if (firstSentence.length <= MAX_CUE_LENGTH) return firstSentence;

  // No clean first sentence — cut at a word boundary.
  const cut = body.slice(0, MAX_CUE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** True when the cue would give away too much of the note. */
export function cueLeaksAnswer(note: Note): boolean {
  const body = notePlainText(note);
  const cue = buildCue(note);
  // If the cue is essentially the whole note, there is nothing to recall.
  return body.length > 0 && cue.length >= body.length * 0.9;
}

/**
 * Soften the rating for a long note.
 *
 * A student who can recall the gist of a long note has done the hard part.
 * Rating that as "Good" would push the next review far out and risk the
 * student forgetting it, so long notes are nudged towards "Hard" — which
 * keeps the interval growing but not as fast.
 */
export function adjustQualityForLength(note: Note, quality: NoteRecallQuality): NoteRecallQuality {
  const body = notePlainText(note);
  if (body.length <= SHORT_NOTE_LENGTH) return quality;

  // A long note recalled perfectly is still recalled less perfectly than a
  // short one, so "Easy" becomes "Good".
  if (quality === 3) return 2;
  // A long note fully forgotten is no worse than a short one forgotten.
  return quality;
}

/**
 * Apply a recall rating to a note and return its new scheduling state.
 *
 * Returns the fields to write back onto the note: the SM-2 state, the updated
 * review trail and the leech counter.
 */
export function scheduleNote(
  note: Note,
  quality: NoteRecallQuality,
  now = new Date(),
): Pick<Note, 'repetitions' | 'interval' | 'ef' | 'nextReview' | 'reviewHistory' | 'leechCount' | 'lastRevisited'> {
  const adjusted = adjustQualityForLength(note, quality);
  const srs = sm2(
    {
      repetitions: note.repetitions,
      interval: note.interval,
      ef: note.ef,
      nextReview: note.nextReview,
    },
    adjusted,
    now,
  );

  const history = note.reviewHistory ?? [];
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    ...srs,
    reviewHistory: [...history, { date, quality: adjusted }],
    // "Again" is the only rating that counts as a failure.
    leechCount: adjusted === 0 ? (note.leechCount ?? 0) + 1 : (note.leechCount ?? 0),
    lastRevisited: now,
  };
}

/**
 * True when a note has failed so often that the note itself is the problem.
 *
 * A note that cannot be recalled is usually too long. The fix is to split it,
 * not to keep trying — so the app should say so.
 */
export const NOTE_LEECH_THRESHOLD = 3;

export function isNoteLeech(note: Note): boolean {
  return (note.leechCount ?? 0) >= NOTE_LEECH_THRESHOLD;
}

/**
 * The reason a note is hard, in words. Used to tell the student why a note
 * keeps coming back rather than leaving them to guess.
 */
export function noteDifficultyReason(note: Note): string | null {
  if (isNoteLeech(note)) {
    return 'This note keeps slipping. It may be too long to recall — try splitting it into smaller notes.';
  }
  const body = notePlainText(note);
  if (body.length > SHORT_NOTE_LENGTH * 2) {
    return 'This note is long. Recall is scheduled more gently for long notes.';
  }
  return null;
}
