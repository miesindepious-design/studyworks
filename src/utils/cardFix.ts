/**
 * cardFix — the offer/apply logic for the AI leech fixer.
 *
 * A leech is usually a badly-worded card, so the fix is rewriting it, not
 * re-memorising it. This module owns the two decisions the UI must not get
 * wrong on its own:
 *
 *   - which cards are offered a fix (leeches and AI-made cards, and never a
 *     card that has already been fixed once — otherwise one stubborn leech
 *     could burn AI calls and farm the `leech_fixed` XP forever);
 *   - what accepting a rewrite does to the card (the wording changes, the
 *     learning history does not, and the fix is recorded with a timestamp).
 */
import { Flashcard } from '../types';
import { isLeech } from '../game/rules';

/** A proposed rewrite, as returned by POST /api/ai/fix-card. */
export interface CardFixProposal {
  question: string;
  answer: string;
  /** One short sentence on what was wrong with the original wording. */
  whatChanged: string;
}

/**
 * Whether the "Fix this card" button should be offered for this card:
 * leeches (the card keeps failing) and AI-made cards (the wording was never
 * written by a human), as long as it has not already been fixed.
 */
export function canOfferCardFix(card: Flashcard): boolean {
  if (card.fixedAt) return false;
  return isLeech(card) || card.source === 'ai' || card.source === 'tutor';
}

/**
 * Apply an accepted rewrite. Only the wording and the fix stamp change —
 * repetitions, ease factor, review trail and the rest of the SRS state are
 * preserved, because the student still has to learn the fact either way.
 */
export function applyCardFix(
  card: Flashcard,
  fix: CardFixProposal,
  fixedAt: string = new Date().toISOString(),
): Flashcard {
  return {
    ...card,
    question: fix.question,
    answer: fix.answer,
    fixedAt,
  };
}
