/**
 * utils/cloze.ts — build cloze-deletion cards from a note, without an AI.
 *
 * The server has an AI route that writes better cloze cards, but a student
 * should not need an API key to make them. This picks the most important word
 * in each sentence — the longest word that is not a stop word — and hides it.
 *
 * The card format matches Anki's cloze convention: the hidden term is
 * written as {{c1}} in the question.
 */

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'also', 'and', 'any',
  'are', 'because', 'been', 'being', 'but', 'can', 'could', 'did', 'does',
  'doing', 'done', 'each', 'even', 'every', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'her', 'here', 'hers', 'him', 'his', 'how',
  'however', 'if', 'into', 'its', 'itself', 'just', 'may', 'might', 'more',
  'most', 'much', 'must', 'not', 'now', 'off', 'once', 'only', 'other',
  'ought', 'our', 'out', 'over', 'own', 'same', 'shall', 'she', 'should',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'too', 'under', 'until', 'up',
  'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'their', 'these',
  'using', 'used', 'often', 'usually', 'within', 'between', 'through',
]);

const MIN_WORD_LENGTH = 5;
const MAX_SENTENCE_LENGTH = 220;

export interface ClozeCard {
  question: string;
  answer: string;
}

/** Split a passage into sentences that are worth turning into cards. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < MAX_SENTENCE_LENGTH);
}

/**
 * The most promising word in a sentence: long, not a stop word, and not just
 * a number. Capitalised words mid-sentence score higher — in a technical
 * note they are usually the term being defined.
 */
function keyTerm(sentence: string): { term: string; index: number } | null {
  const words = sentence.split(/\s+/);
  let best: { term: string; index: number } | null = null;
  let bestScore = 0;

  words.forEach((word, index) => {
    const clean = word.replace(/[^\w'-]/g, '');
    if (clean.length < MIN_WORD_LENGTH) return;
    if (STOP_WORDS.has(clean.toLowerCase())) return;
    if (/^\d+$/.test(clean)) return;

    // Mid-sentence capitalisation is a strong hint that this is a term.
    const isMidCaps = index > 0 && /^[A-Z]/.test(clean) && /^[A-Z][a-z]/.test(clean);
    const score = clean.length + (isMidCaps ? 4 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { term: clean, index };
    }
  });

  return best;
}

/**
 * Build up to `count` cloze cards from a passage. Sentences without a usable
 * key term are skipped, so the result can be shorter than requested.
 */
export function makeClozeCards(text: string, count = 5): ClozeCard[] {
  const plain = text
    .replace(/<[^>]+>/g, ' ')      // strip HTML
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // keep wikilink text
    .replace(/[#*_`>]/g, ' ');

  const cards: ClozeCard[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences(plain)) {
    if (cards.length >= count) break;
    const key = keyTerm(sentence);
    if (!key) continue;

    const lower = key.term.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    const words = sentence.split(/\s+/);
    const question = words
      .map(w => (w.replace(/[^\w'-]/g, '') === key.term ? '{{c1}}' : w))
      .join(' ')
      .trim();

    cards.push({ question, answer: key.term });
  }

  return cards;
}

/**
 * Render a cloze question for display: the hidden term becomes a blank on the
 * front and the answer on the back.
 */
export function renderCloze(question: string, answer: string, revealed: boolean): string {
  return revealed
    ? question.replace(/\{\{c\d+\}\}/g, answer)
    : question.replace(/\{\{c\d+\}\}/g, '_____');
}
