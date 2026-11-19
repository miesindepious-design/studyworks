/**
 * utils/anki.ts — move flashcards in and out of Anki.
 *
 * Students usually already have a deck somewhere, and being able to take
 * cards into Anki (or pull them back) removes the biggest reason to stay
 * locked into one app.
 *
 * Anki's text format is tab-separated with a small header:
 *
 *   #separator:tab
 *   #html:true
 *   #columns:Front<TAB>Back<TAB>Tags
 *   question<TAB>answer<TAB>tag1 tag2
 *
 * We also accept comma-separated files, because that is what people actually
 * export from spreadsheets.
 */
import type { Flashcard } from '../types';

export interface AnkiCard {
  question: string;
  answer: string;
  tags: string[];
}

const SEPARATOR = '\t';

/** Tags cannot contain spaces in Anki — they use an underscore instead. */
function cleanTag(tag: string): string {
  return tag.trim().replace(/\s+/g, '_').replace(/[^\w\-:]/g, '');
}

/** Build an Anki-compatible text file from flashcards. */
export function exportToAnki(cards: Flashcard[]): string {
  const lines = [
    '#separator:tab',
    '#html:true',
    `#columns:Front${SEPARATOR}Back${SEPARATOR}Tags`,
  ];
  for (const card of cards) {
    const tags = (card.tags ?? []).map(cleanTag).filter(Boolean).join(' ');
    const topic = card.topic ? cleanTag(card.topic) : '';
    const allTags = [tags, topic].filter(Boolean).join(' ');
    lines.push(
      [card.question.replace(/\t/g, ' '), card.answer.replace(/\t/g, ' '), allTags].join(SEPARATOR),
    );
  }
  return lines.join('\n');
}

/** Guess the delimiter of an imported file: tab, comma or semicolon. */
function detectSeparator(sample: string): string {
  const line = sample.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#')) ?? '';
  const counts: Array<[string, number]> = [
    ['\t', (line.match(/\t/g) ?? []).length],
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : SEPARATOR;
}

/**
 * Parse an Anki export (or a simple two/three column file) into cards.
 * Comment lines and the column header are skipped.
 */
export function parseAnkiFile(text: string): AnkiCard[] {
  const rawLines = text.split(/\r?\n/);
  const separator = detectSeparator(text);
  const cards: AnkiCard[] = [];

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;

    const parts = line.split(separator).map(p => p.trim());

    // Skip the column header row ("Front", "Back", "Tags").
    if (parts.length >= 2 && /^front$/i.test(parts[0]) && /^back$/i.test(parts[1])) continue;

    const question = parts[0];
    const answer = parts[1];
    if (!question || !answer) continue;

    const tags = (parts[2] ?? '')
      .split(/[\s,]+/)
      .map(t => t.trim())
      .filter(Boolean);

    cards.push({ question, answer, tags });
  }

  return cards;
}

/** Trigger a browser download for generated text. */
export function downloadTextFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
