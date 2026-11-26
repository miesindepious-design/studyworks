/**
 * citations — turning a source into a properly formatted reference.
 *
 * Every student writing an essay has the same problem: the reference list.
 * They have the source in front of them and no idea whether it wants an
 * author-date or an author-page form, whether the year goes in brackets,
 * and where the publisher goes for a website.
 *
 * So this asks the student for the facts — who, when, what, where — and
 * does the formatting. Four styles, because a course in one department can
 * want a different one from the next.
 *
 * Everything here is pure. A citation that changes while you type is a
 * citation you cannot trust.
 */

export type CitationStyle = 'apa' | 'mla' | 'harvard' | 'chicago';

export type SourceType =
  | 'book'
  | 'journal'
  | 'website'
  | 'chapter'
  | 'video'
  | 'report'
  | 'thesis';

export interface Source {
  id: string;
  type: SourceType;
  /** Each author as "Last, First" or "First Last". */
  authors: string[];
  /** The editor of a book a chapter sits in. */
  editor?: string;
  year: string;
  /** The title of the work. For a chapter, the chapter's title. */
  title: string;
  /** The containing work: a journal name, a book title, a website name. */
  container?: string;
  publisher?: string;
  place?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  doi?: string;
  /** The date the page was looked at, ISO (YYYY-MM-DD). */
  accessed?: string;
}

export const STYLE_LABEL: Record<CitationStyle, string> = {
  apa:     'APA 7th',
  mla:     'MLA 9th',
  harvard: 'Harvard',
  chicago: 'Chicago',
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  book:    'Book',
  journal: 'Journal article',
  website: 'Website',
  chapter: 'Book chapter',
  video:   'Video',
  report:  'Report',
  thesis:  'Thesis',
};

// ── Author names ───────────────────────────────────────────────────────────────

interface Author { last: string; first: string; initials: string; full: string; }

/**
 * Read an author written either way round.
 *
 * "Toni Morrison" and "Morrison, Toni" both appear in the wild, and the
 * difference decides whether the citation comes out right.
 */
export function parseAuthor(raw: string): Author {
  const text = raw.trim();
  if (!text) return { last: '', first: '', initials: '', full: '' };

  if (text.includes(',')) {
    const [last, ...rest] = text.split(',');
    const first = rest.join(',').trim();
    return {
      last: last.trim(),
      first,
      initials: initialsOf(first),
      full: `${last.trim()}, ${first}`.trim(),
    };
  }

  const parts = text.split(/\s+/);
  if (parts.length === 1) {
    return { last: parts[0], first: '', initials: '', full: parts[0] };
  }
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return {
    last,
    first,
    initials: initialsOf(first),
    full: `${last}, ${first}`,
  };
}

/** "Toni" → "T."; "John Ronald" → "J. R." */
function initialsOf(first: string): string {
  return first
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(part => `${part[0].toUpperCase()}.`)
    .join(' ');
}

/** The authors of a source, parsed. */
export function authorsOf(source: Source): Author[] {
  return (source.authors ?? []).map(parseAuthor).filter(a => a.last || a.first);
}

// ── Style formatters ───────────────────────────────────────────────────────────

/**
 * End a fragment with a full stop — without doubling one that is already
 * there. An author list ends in an initial ("West, C."), and appending a
 * second full stop gives "West, C.." in the finished reference.
 */
function stop(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** APA author list: "Smith, J. A., & Jones, B." */
function apaAuthors(source: Source): string {
  const authors = authorsOf(source);
  if (!authors.length) return '';

  const names = authors.map(a => {
    const initials = a.initials ? ` ${a.initials}` : '';
    return `${a.last},${initials}`;
  });

  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  if (names.length <= 20) {
    return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  }
  // APA 7: list the first 19, an ellipsis, then the last.
  return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`;
}

/** MLA author list: "Smith, John, and Jane Jones." */
function mlaAuthors(source: Source): string {
  const authors = authorsOf(source);
  if (!authors.length) return '';

  const first = authors[0];
  const firstName = first.first ? `${first.first} ${first.last}` : first.last;

  if (authors.length === 1) return firstName;
  if (authors.length === 2) {
    const second = authors[1];
    const secondName = second.last ? `${second.last}, ${second.first}`.trim() : '';
    return `${firstName}, and ${secondName}`;
  }
  // MLA 9: three or more authors — the first, then "et al."
  return `${firstName}, et al`;
}

/** Harvard author list: "Smith, J. and Jones, B." */
function harvardAuthors(source: Source): string {
  const authors = authorsOf(source);
  if (!authors.length) return '';
  const names = authors.map(a => {
    const initials = a.initials ? ` ${a.initials}` : '';
    return `${a.last},${initials}`;
  });
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]} et al.`;
}

/** Chicago author list: "Smith, John, and Jane Jones." */
function chicagoAuthors(source: Source): string {
  const authors = authorsOf(source);
  if (!authors.length) return '';
  const first = authors[0];
  const firstName = first.first ? `${first.last}, ${first.first}` : first.last;

  if (authors.length === 1) return firstName;
  if (authors.length > 3) return `${firstName} et al.`;

  const rest = authors.slice(1).map(a => (a.first ? `${a.first} ${a.last}` : a.last));
  if (rest.length === 1) return `${firstName}, and ${rest[0]}`;
  return `${firstName}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
}

/** APA title case: only the first word and proper nouns are capitalised. */
export function apaTitleCase(title: string): string {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via', 'yet']);
  const words = title.trim().split(/\s+/);
  return words
    .map((word, i) => {
      if (i > 0 && small.has(word.toLowerCase())) return word.toLowerCase();
      // Leave anything with a capital letter inside it alone — that is
      // probably an acronym or a proper noun.
      if (/[A-Z]/.test(word.slice(1))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** The URL or DOI, whichever the style prefers. */
function locator(source: Source): string {
  if (source.doi) {
    const doi = source.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    return `https://doi.org/${doi}`;
  }
  return source.url ?? '';
}

/** APA. */
export function formatApa(source: Source): string {
  const authors = apaAuthors(source);
  const year = source.year ? `(${source.year})` : '(n.d.)';
  const title = apaTitleCase(source.title);
  const parts: string[] = [];
  // The author list may already end in an initial's full stop, so it gets
  // its sentence punctuation from `stop()` rather than a bare ".".
  const who = authors ? `${stop(authors)} ` : '';

  switch (source.type) {
    case 'book':
      parts.push(`${who}${year}. ${title}.`);
      if (source.place || source.publisher) {
        parts.push(`${source.publisher ?? ''}${source.place ? ` (${source.place})` : ''}.`);
      }
      break;
    case 'chapter':
      parts.push(`${who}${year}. ${title}.`);
      if (source.editor) parts.push(`In ${source.editor} (Ed.),`);
      parts.push(`${source.container ?? ''}.`);
      if (source.publisher) parts.push(`${source.publisher}.`);
      break;
    case 'journal':
      parts.push(`${who}${year}. ${title}.`);
      if (source.container) parts.push(`${source.container},`);
      if (source.volume) parts.push(`${source.volume}${source.issue ? `(${source.issue})` : ''},`);
      if (source.pages) parts.push(`${source.pages}.`);
      break;
    case 'thesis':
      parts.push(`${who}${year}. ${title} [Unpublished thesis].`);
      if (source.publisher) parts.push(`${source.publisher}.`);
      break;
    case 'video':
      parts.push(`${who}(${source.year || 'n.d.'}). ${title} [Video].`);
      if (source.container) parts.push(`${source.container}.`);
      break;
    case 'report':
      parts.push(`${who}${year}. ${title}.`);
      if (source.publisher) parts.push(`${source.publisher}.`);
      break;
    default: // website
      parts.push(`${who}${year}. ${title}.`);
      if (source.container) parts.push(`${source.container}.`);
  }

  const link = locator(source);
  if (link) parts.push(link);

  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

/** MLA. */
export function formatMla(source: Source): string {
  const authors = mlaAuthors(source);
  const title = source.title;
  const parts: string[] = [];

  if (authors) parts.push(stop(authors));
  parts.push(`"${title}."`);

  switch (source.type) {
    case 'journal':
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.volume) parts.push(`vol. ${source.volume},`);
      if (source.issue) parts.push(`no. ${source.issue},`);
      if (source.year) parts.push(`${source.year},`);
      if (source.pages) parts.push(`pp. ${source.pages}.`);
      break;
    case 'chapter':
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.publisher) parts.push(`${source.publisher},`);
      if (source.year) parts.push(`${source.year},`);
      if (source.pages) parts.push(`pp. ${source.pages}.`);
      break;
    case 'website':
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.year) parts.push(`${source.year},`);
      break;
    default:
      if (source.publisher) parts.push(`${source.publisher},`);
      if (source.year) parts.push(`${source.year}.`);
  }

  const link = locator(source);
  if (link) parts.push(`${link}.`);

  if (source.accessed && source.type === 'website') {
    parts.push(`Accessed ${formatAccessDate(source.accessed)}.`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

/** Harvard. */
export function formatHarvard(source: Source): string {
  const authors = harvardAuthors(source);
  const year = source.year ? source.year : 'n.d.';
  const parts: string[] = [];

  if (authors) parts.push(`${authors} (${year})`);
  else parts.push(`(${year})`);

  switch (source.type) {
    case 'journal':
      parts.push(`'${source.title}',`);
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.volume) parts.push(`${source.volume}${source.issue ? `(${source.issue})` : ''},`);
      if (source.pages) parts.push(`pp. ${source.pages}.`);
      break;
    case 'chapter':
      parts.push(`'${source.title}' in`);
      if (source.editor) parts.push(`${source.editor} (ed.)`);
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.publisher) parts.push(`${source.publisher},`);
      if (source.pages) parts.push(`pp. ${source.pages}.`);
      break;
    case 'website':
      parts.push(`*${source.title}*.`);
      if (source.container) parts.push(`${source.container}.`);
      break;
    default:
      parts.push(`*${source.title}*.`);
      if (source.publisher) parts.push(`${source.publisher}.`);
  }

  const link = locator(source);
  if (link) parts.push(`Available at: ${link}.`);

  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

/** Chicago (author–date). */
export function formatChicago(source: Source): string {
  const authors = chicagoAuthors(source);
  const year = source.year || 'n.d.';
  const parts: string[] = [];

  if (authors) parts.push(stop(authors));
  parts.push(`${year}.`);

  switch (source.type) {
    case 'journal':
      parts.push(`"${source.title}."`);
      if (source.container) parts.push(`*${source.container}*`);
      if (source.volume) parts.push(`${source.volume}${source.issue ? `, no. ${source.issue}` : ''}`);
      if (source.year) parts.push(`(${source.year})`);
      if (source.pages) parts.push(`: ${source.pages}.`);
      break;
    case 'chapter':
      parts.push(`"${source.title}." In`);
      if (source.container) parts.push(`*${source.container}*,`);
      if (source.publisher) parts.push(`${source.publisher},`);
      if (source.year) parts.push(`${source.year}`);
      if (source.pages) parts.push(`, ${source.pages}.`);
      break;
    case 'website':
      parts.push(`"${source.title}."`);
      if (source.container) parts.push(`${source.container}.`);
      if (source.year) parts.push(`${source.year}.`);
      break;
    default:
      parts.push(`*${source.title}*.`);
      if (source.place || source.publisher) {
        parts.push(`${source.place ? `${source.place}: ` : ''}${source.publisher ?? ''}.`);
      }
      if (source.year) parts.push(`${source.year}.`);
  }

  const link = locator(source);
  if (link) parts.push(`${link}.`);

  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

/** Format one source in the chosen style. */
export function formatCitation(source: Source, style: CitationStyle): string {
  switch (style) {
    case 'mla':     return formatMla(source);
    case 'harvard': return formatHarvard(source);
    case 'chicago': return formatChicago(source);
    default:        return formatApa(source);
  }
}

/** "2026-03-04" → "4 March 2026" (MLA's way). */
function formatAccessDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** The sort key: author, then year, then title. */
export function sortKey(source: Source): string {
  const authors = authorsOf(source);
  const last = authors[0]?.last ?? '';
  return `${last.toLowerCase()} ${source.year} ${source.title.toLowerCase()}`;
}

/** A bibliography, sorted and numbered. */
export function formatBibliography(sources: Source[], style: CitationStyle): string {
  return [...sources]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .map(s => formatCitation(s, style))
    .join('\n\n');
}

/** A short label for a source, used in the list. */
export function sourceLabel(source: Source): string {
  const authors = authorsOf(source);
  const who = authors.length
    ? (authors.length > 1 ? `${authors[0].last} et al.` : authors[0].last)
    : 'Unknown';
  return `${who} (${source.year || 'n.d.'}) — ${source.title}`;
}

// ── Export formats ─────────────────────────────────────────────────────────────

/** A BibTeX entry type for each source type. */
const BIBTEX_TYPE: Record<SourceType, string> = {
  book:    'book',
  journal: 'article',
  website: 'misc',
  chapter: 'incollection',
  video:   'misc',
  report:  'techreport',
  thesis:  'phdthesis',
};

/** A citation key that is unique and readable. */
export function citationKey(source: Source): string {
  const authors = authorsOf(source);
  const last = (authors[0]?.last ?? 'source').toLowerCase().replace(/[^a-z0-9]/g, '');
  const year = source.year || 'nd';
  const word = (source.title.split(/\s+/).find(w => w.length > 3) ?? 'work')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${last}${year}${word}`;
}

/** The whole library as a BibTeX file. */
export function toBibTeX(sources: Source[]): string {
  const entries = sources.map(source => {
    const authors = authorsOf(source);
    const fields: string[] = [];

    fields.push(`  author = {${authors.map(a => a.full).join(' and ')}}`);
    fields.push(`  title = {${source.title}}`);
    if (source.year) fields.push(`  year = {${source.year}}`);
    if (source.container) fields.push(`  booktitle = {${source.container}}`);
    if (source.publisher) fields.push(`  publisher = {${source.publisher}}`);
    if (source.place) fields.push(`  address = {${source.place}}`);
    if (source.volume) fields.push(`  volume = {${source.volume}}`);
    if (source.issue) fields.push(`  number = {${source.issue}}`);
    if (source.pages) fields.push(`  pages = {${source.pages}}`);
    if (source.url) fields.push(`  url = {${source.url}}`);
    if (source.doi) fields.push(`  doi = {${source.doi}}`);
    if (source.editor) fields.push(`  editor = {${source.editor}}`);

    return `@${BIBTEX_TYPE[source.type]}${citationKey(source)} {\n${fields.join(',\n')}\n}`;
  });

  return entries.join('\n\n');
}

/** The RIS type for each source type — the format Zotero, Mendeley and EndNote read. */
const RIS_TYPE: Record<SourceType, string> = {
  book:    'BOOK',
  journal: 'JOUR',
  website: 'ELEC',
  chapter: 'CHAP',
  video:   'VIDEO',
  report:  'RPRT',
  thesis:  'THES',
};

/** The whole library as an RIS file. */
export function toRIS(sources: Source[]): string {
  const entries = sources.map(source => {
    const authors = authorsOf(source);
    const lines: string[] = [];
    lines.push(`TY  - ${RIS_TYPE[source.type]}`);
    for (const a of authors) {
      lines.push(`AU  - ${a.last}${a.first ? `, ${a.first}` : ''}`);
    }
    if (source.editor) lines.push(`ED  - ${source.editor}`);
    lines.push(`TI  - ${source.title}`);
    if (source.container) lines.push(`T2  - ${source.container}`);
    if (source.year) lines.push(`PY  - ${source.year}`);
    if (source.publisher) lines.push(`PB  - ${source.publisher}`);
    if (source.place) lines.push(`CY  - ${source.place}`);
    if (source.volume) lines.push(`VL  - ${source.volume}`);
    if (source.issue) lines.push(`IS  - ${source.issue}`);
    if (source.pages) lines.push(`SP  - ${source.pages}`);
    if (source.url) lines.push(`UR  - ${source.url}`);
    if (source.doi) lines.push(`DO  - ${source.doi}`);
    lines.push('ER  - ');
    return lines.join('\r\n');
  });

  return entries.join('\r\n\r\n');
}

/**
 * The in-text citation — the "(Smith, 2024)" that goes in the essay.
 *
 * APA and Harvard use author-date; MLA and Chicago use an author-page
 * number, which is only known once the student has looked at the source.
 */
export function inTextCitation(source: Source, style: CitationStyle, page?: string): string {
  const authors = authorsOf(source);
  const name = authors.length
    ? (authors.length > 1 ? `${authors[0].last} et al.` : authors[0].last)
    : 'Anon.';
  const year = source.year || 'n.d.';

  switch (style) {
    case 'mla':
    case 'chicago':
      return page ? `(${name} ${page})` : `(${name})`;
    default:
      return `(${name}, ${year})`;
  }
}
