/**
 * importers — reading cards out of the formats students actually have.
 *
 * A student with a deck somewhere else does not want to retype it. These
 * parsers read what Quizlet, Notion and Google Docs hand over, and turn it
 * into cards that can be reviewed before anything is saved.
 *
 * Each importer is pure and returns the same shape, so the UI does not care
 * where the cards came from — it only shows a preview and asks.
 *
 * What the sources actually give you:
 *
 *   Quizlet  a tab-separated file: term, definition, image, …
 *   Notion   a CSV (ID, Name, Tags, Created, …) or a Markdown export
 *   Docs     a .docx or .pdf, which the app already turns into plain text
 *
 * The plain-text importer is the fallback that makes a Google Docs export
 * work without knowing anything about where the file came from: it looks
 * for the shapes a human writes questions in.
 */

/** One card that came out of a file. */
export interface ImportedCard {
  question: string;
  answer: string;
  tags: string[];
}

export type ImportFormat = 'quizlet' | 'notion' | 'document' | 'delimited';

export interface ImportPreview {
  format: ImportFormat;
  cards: ImportedCard[];
  /** Things worth telling the student about the file. */
  warnings: string[];
}

/** Trim, collapse runs of spaces, and drop a line that is only punctuation. */
function clean(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A line that carries no information. */
function isBlank(line: string): boolean {
  return clean(line).length === 0;
}

/**
 * Split a delimited line, honouring double quotes.
 *
 * Quizlet and Notion both quote fields that contain a comma, and a naive
 * `split(',')` shreds them.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { out.push(field); field = ''; continue; }
    field += ch;
  }
  out.push(field);
  return out.map(f => f.trim());
}

/** Guess the delimiter of a delimited file. */
export function guessDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find(l => l.trim().length > 0) ?? '';
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis > commas && semis > 0) return ';';
  return ',';
}

/** Is this row a header rather than a card? */
function looksLikeHeader(row: string[]): boolean {
  const joined = row.join(' ').toLowerCase();
  const headerWords = ['term', 'definition', 'front', 'back', 'question', 'answer', 'name', 'content', 'id', 'tags'];
  const hits = headerWords.filter(w => new RegExp(`\\b${w}\\b`).test(joined)).length;
  // A header is short and made of known words — a real card's question is
  // usually a sentence, not two dictionary words.
  return hits >= 2 && row.every(cell => cell.length <= 30);
}

/** Which column holds the question, and which holds the answer? */
function findColumns(header: string[]): { q: number; a: number } | null {
  const lower = header.map(h => h.toLowerCase().trim());
  const q = lower.findIndex(h => /term|question|front|name|word/.test(h));
  const a = lower.findIndex(h => /definition|answer|back|description|content|meaning/.test(h));
  if (q === -1 || a === -1) return null;
  return { q, a };
}

/**
 * Read a tab- or comma-separated file of terms and definitions.
 *
 * This is what Quizlet exports, and it is also what most people have when
 * they say "I have my cards in a spreadsheet".
 */
export function parseDelimited(text: string, format: ImportFormat = 'delimited'): ImportPreview {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter(l => !isBlank(l));
  if (!lines.length) {
    return { format, cards: [], warnings: ['That file looks empty.'] };
  }

  const delimiter = guessDelimiter(text);
  const rows = lines.map(l => splitDelimited(l, delimiter));

  let start = 0;
  let columns: { q: number; a: number } | null = null;

  if (looksLikeHeader(rows[0])) {
    columns = findColumns(rows[0]);
    start = 1;
    if (!columns) {
      warnings.push('The header row was not recognised, so every row was read as a card.');
    }
  }

  // Without a header, fall back to "first column is the term".
  if (!columns) columns = { q: 0, a: 1 };

  const cards: ImportedCard[] = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const question = clean(row[columns.q] ?? '');
    const answer = clean(row[columns.a] ?? '');
    if (!question || !answer) continue;
    cards.push({ question, answer, tags: [] });
  }

  if (!cards.length) {
    warnings.push('No term/definition pairs were found in that file.');
  }

  return { format, cards, warnings };
}

/**
 * Read a Quizlet export.
 *
 * Quizlet's tab-separated export has a "Term,Definition" header and then
 * one row per card. The third column holds the image filename, which is
 * not something the app can use, so it is dropped.
 */
export function parseQuizlet(text: string): ImportPreview {
  const preview = parseDelimited(text, 'quizlet');
  if (preview.cards.length) {
    preview.warnings.push('Quizlet images are not imported — only the terms and definitions.');
  }
  return preview;
}

/**
 * Read a Notion export.
 *
 * A Notion CSV export has an "ID, Name, Tags, Created, Last edited" header.
 * The content lives in the "Name" column, and the properties in the other
 * columns are metadata rather than a question and an answer — so the
 * content is split into a title and a body.
 *
 * A Notion Markdown export is a list of headings with content under them,
 * which the document importer already understands.
 */
export function parseNotion(text: string): ImportPreview {
  const firstLine = text.split(/\r?\n/)[0] ?? '';

  // A Markdown export has no comma-separated header — it is prose.
  if (!/,/i.test(firstLine) || !/name|content/i.test(firstLine)) {
    return parseDocument(text, 'notion');
  }

  const delimiter = guessDelimiter(text);
  const rows = text.split(/\r?\n/).filter(l => !isBlank(l)).map(l => splitDelimited(l, delimiter));
  if (!rows.length) return { format: 'notion', cards: [], warnings: ['That file looks empty.'] };

  const header = rows[0].map(h => h.trim());
  const nameIdx = header.findIndex(h => /^(name|title|content)$/i.test(h));
  const tagsIdx = header.findIndex(h => /^tags?$/i.test(h));
  const contentIdx = header.findIndex((h, i) => i !== nameIdx && /content|body|text|description/i.test(h));

  const cards: ImportedCard[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = clean(row[nameIdx] ?? '');
    if (!name) continue;

    const body = contentIdx === -1 ? '' : clean(row[contentIdx] ?? '');
    const tags = tagsIdx === -1
      ? []
      : (row[tagsIdx] ?? '').split(',').map(t => clean(t)).filter(Boolean);

    // A page whose body starts with the title again is a title, not a pair.
    const answer = body.startsWith(name) ? clean(body.slice(name.length)) : body;

    cards.push({
      question: name,
      answer: answer || name,
      tags,
    });
  }

  if (!cards.length) {
    warnings.push('No pages with content were found in that Notion export.');
  }

  return { format: 'notion', cards, warnings };
}

/**
 * Read a plain document — a Google Docs export, a .docx, a .pdf.
 *
 * There is no standard for "a list of questions", so this looks for the
 * shapes people actually write:
 *
 *   - "Q:" / "A:" on their own lines
 *   - "Term: …" / "Definition: …"
 *   - a markdown heading followed by the answer beneath it
 *   - a table row: | question | answer |
 *   - otherwise, blocks separated by blank lines, alternating question and
 *     answer
 */
export function parseDocument(text: string, format: ImportFormat = 'document'): ImportPreview {
  const warnings: string[] = [];
  const source = clean(text);
  if (!source) {
    return { format, cards: [], warnings: ['That document is empty.'] };
  }

  const lines = source.split('\n');

  // ── 1. Q: / A: pairs ────────────────────────────────────────────────────
  const qa = tryLabeledPairs(lines, /^\s*(?:q|question)\s*[:.\-]\s*(.+)$/i, /^\s*(?:a|answer)\s*[:.\-]\s*(.+)$/i);
  if (qa.length) return { format, cards: qa, warnings };

  // ── 2. Term: / Definition: pairs ───────────────────────────────────────
  const term = tryLabeledPairs(lines, /^\s*(?:term|front)\s*[:.\-]\s*(.+)$/i, /^\s*(?:definition|back|meaning)\s*[:.\-]\s*(.+)$/i);
  if (term.length) return { format, cards: term, warnings };

  // ── 3. Markdown headings followed by their content ──────────────────────
  const heading = tryHeadingPairs(lines);
  if (heading.length) return { format, cards: heading, warnings };

  // ── 4. Markdown tables ──────────────────────────────────────────────────
  const table = tryTablePairs(lines);
  if (table.length) return { format, cards: table, warnings };

  // ── 5. Blank-line separated blocks, alternating ─────────────────────────
  const blocks = source.split(/\n\s*\n/).map(b => clean(b)).filter(b => b.length > 0);
  if (blocks.length >= 2) {
    const cards: ImportedCard[] = [];
    for (let i = 0; i + 1 < blocks.length; i += 2) {
      cards.push({
        question: singleLine(blocks[i]),
        answer: blocks[i + 1],
        tags: [],
      });
    }
    if (cards.length) {
      warnings.push('No question/answer markers were found, so blocks were paired in order. Check the preview.');
      return { format, cards, warnings };
    }
  }

  warnings.push('No questions and answers could be found in that document.');
  return { format, cards: [], warnings };
}

/** Collect lines matching a question label and the answer label after it. */
function tryLabeledPairs(
  lines: string[],
  qPattern: RegExp,
  aPattern: RegExp,
): ImportedCard[] {
  const cards: ImportedCard[] = [];
  let question: string | null = null;
  const answerLines: string[] = [];

  const flush = () => {
    if (question && answerLines.length) {
      cards.push({ question, answer: clean(answerLines.join('\n')), tags: [] });
    }
    question = null;
    answerLines.length = 0;
  };

  for (const line of lines) {
    const q = line.match(qPattern);
    if (q) {
      flush();
      question = clean(q[1]);
      continue;
    }
    const a = line.match(aPattern);
    if (a) {
      if (question === null) {
        // An answer with no question: treat the answer as the question and
        // leave the answer empty — the student can fill it in.
        question = clean(a[1]);
      } else {
        answerLines.push(clean(a[1]));
      }
      continue;
    }
    if (question !== null && !isBlank(line)) {
      // Continuation of the answer.
      answerLines.push(line);
    }
  }
  flush();

  return cards;
}

/** A markdown heading, then the lines under it, become a question and answer. */
function tryHeadingPairs(lines: string[]): ImportedCard[] {
  const cards: ImportedCard[] = [];
  let heading: string | null = null;
  const body: string[] = [];

  const flush = () => {
    if (heading && body.length) {
      cards.push({ question: singleLine(heading), answer: clean(body.join('\n')), tags: [] });
    }
    heading = null;
    body.length = 0;
  };

  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (m) {
      flush();
      heading = clean(m[1]);
      continue;
    }
    if (heading !== null) {
      if (isBlank(line)) {
        // A blank line ends the answer unless more text follows.
        body.push('');
      } else {
        body.push(line);
      }
    }
  }
  flush();

  return cards.filter(c => c.answer.trim().length > 0);
}

/** A markdown table with a header row: | Question | Answer | */
function tryTablePairs(lines: string[]): ImportedCard[] {
  const tableLines = lines.filter(l => /^\s*\|.*\|\s*$/.test(l));
  if (tableLines.length < 3) return [];

  const parseRow = (line: string) =>
    line.trim().replace(/^\||\|$/g, '').split('|').map(c => clean(c));

  const header = parseRow(tableLines[0]);
  const columns = findColumns(header);
  if (!columns) return [];

  const cards: ImportedCard[] = [];
  for (const line of tableLines.slice(2)) {
    // The separator row (|---|---|) is skipped by the slice above.
    const cells = parseRow(line);
    const question = clean(cells[columns.q] ?? '');
    const answer = clean(cells[columns.a] ?? '');
    if (!question || !answer) continue;
    cards.push({ question, answer, tags: [] });
  }
  return cards;
}

/** Collapse a block to a single line, so a question is never a paragraph. */
function singleLine(text: string): string {
  return clean(text).replace(/\n+/g, ' ').trim();
}

/**
 * Work out which importer a file needs.
 *
 * The file name is the strongest signal — a Google Docs export is called
 * "Something.docx" — but the content decides when the name says nothing.
 */
export function detectFormat(filename: string, text: string): ImportFormat {
  const name = filename.toLowerCase();

  if (name.endsWith('.csv')) {
    // A Notion CSV has a Name column; a spreadsheet of cards does not.
    const header = (text.split(/\r?\n/)[0] ?? '').toLowerCase();
    if (/\bname\b|\bcontent\b/.test(header) && /created|edited|\bid\b/.test(header)) {
      return 'notion';
    }
    return 'delimited';
  }
  if (name.endsWith('.tsv')) return 'quizlet';
  if (name.endsWith('.docx') || name.endsWith('.pdf') || name.endsWith('.doc')) return 'document';

  const header = (text.split(/\r?\n/)[0] ?? '').toLowerCase();
  if (/\bterm\b.*\bdefinition\b/.test(header)) return 'quizlet';
  if (/\bname\b.*\b(created|edited|tags)\b/.test(header)) return 'notion';

  return 'document';
}

/** The name shown to the student for each format. */
export const FORMAT_LABEL: Record<ImportFormat, string> = {
  quizlet:   'Quizlet export',
  notion:    'Notion export',
  document:  'Document',
  delimited: 'Spreadsheet',
};

/**
 * Run the right importer for a file.
 */
export function importCards(filename: string, text: string): ImportPreview {
  const format = detectFormat(filename, text);
  switch (format) {
    case 'quizlet':   return parseQuizlet(text);
    case 'notion':    return parseNotion(text);
    case 'delimited': return parseDelimited(text, 'delimited');
    default:          return parseDocument(text, 'document');
  }
}
