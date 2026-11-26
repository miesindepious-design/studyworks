/**
 * Tests for the citation formatter.
 *
 * The styles are the fiddly part: the same source has to come out right in
 * APA, MLA, Harvard and Chicago, and the differences are exactly where
 * hand-typing goes wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCitation,
  formatBibliography,
  formatApa,
  formatMla,
  formatHarvard,
  formatChicago,
  parseAuthor,
  apaTitleCase,
  toBibTeX,
  toRIS,
  inTextCitation,
  citationKey,
  sourceLabel,
  type Source,
} from './citations';

const BOOK: Source = {
  id: '1',
  type: 'book',
  authors: ['Toni Morrison'],
  year: '1987',
  title: 'Beloved',
  publisher: 'Alfred A. Knopf',
  place: 'New York',
};

const CHAPTER: Source = {
  id: '2',
  type: 'chapter',
  authors: ['bell hooks', 'Cornel West'],
  editor: 'Henry Louis Gates Jr.',
  year: '2020',
  title: 'Keeping the Faith',
  container: 'The Blackwell Companion to Gender and Philosophy',
  publisher: 'Wiley',
  pages: '123-140',
};

const ARTICLE: Source = {
  id: '3',
  type: 'journal',
  authors: ['Smith, John A.'],
  year: '2024',
  title: 'The structure of scientific revolutions',
  container: 'Journal of Examples',
  volume: '12',
  issue: '3',
  pages: '45-67',
  doi: '10.1234/joe.2024.001',
};

const WEBSITE: Source = {
  id: '4',
  type: 'website',
  authors: ['Margaret Atwood'],
  year: '2023',
  title: 'A year of reading',
  container: 'The Example Review',
  url: 'https://example.com/a-year-of-reading',
  accessed: '2026-03-04',
};

describe('parseAuthor', () => {
  it('reads "Last, First"', () => {
    const a = parseAuthor('Morrison, Toni');
    expect(a.last).toBe('Morrison');
    expect(a.first).toBe('Toni');
    expect(a.initials).toBe('T.');
  });

  it('reads "First Last"', () => {
    const a = parseAuthor('Toni Morrison');
    expect(a.last).toBe('Morrison');
    expect(a.first).toBe('Toni');
  });

  it('makes initials for a middle name', () => {
    expect(parseAuthor('John Ronald Tolkien').initials).toBe('J. R.');
  });
});

describe('apaTitleCase', () => {
  it('lowercases the small words', () => {
    expect(apaTitleCase('The structure of scientific revolutions'))
      .toBe('The Structure of Scientific Revolutions');
  });

  it('leaves an acronym alone', () => {
    expect(apaTitleCase('Understanding DNA replication')).toBe('Understanding DNA Replication');
  });
});

describe('APA', () => {
  it('formats a book', () => {
    const out = formatApa(BOOK);
    expect(out).toContain('Morrison, T.');
    expect(out).toContain('(1987).');
    expect(out).toContain('Beloved');
    expect(out).toContain('Alfred A. Knopf');
  });

  it('formats a journal article with the DOI as a link', () => {
    const out = formatApa(ARTICLE);
    expect(out).toContain('Smith, J. A.');
    expect(out).toContain('(2024).');
    expect(out).toContain('Journal of Examples');
    expect(out).toContain('12(3)');
    expect(out).toContain('https://doi.org/10.1234/joe.2024.001');
  });

  it('joins two authors with an ampersand', () => {
    const out = formatApa(CHAPTER);
    expect(out).toContain('hooks, B., & West, C.');
  });

  it('says n.d. when there is no year', () => {
    expect(formatApa({ ...BOOK, year: '' })).toContain('(n.d.)');
  });
});

describe('MLA', () => {
  it('puts the title in quotes and the container in italics markers', () => {
    const out = formatMla(ARTICLE);
    expect(out).toContain('"The structure of scientific revolutions."');
    expect(out).toContain('*Journal of Examples*');
    expect(out).toContain('vol. 12');
    expect(out).toContain('no. 3');
  });

  it('uses et al. for three or more authors', () => {
    const out = formatMla({
      ...CHAPTER,
      authors: ['A One', 'B Two', 'C Three'],
    });
    expect(out).toContain('et al');
  });

  it('records when a page was looked at', () => {
    expect(formatMla(WEBSITE)).toContain('Accessed 4 March 2026');
  });
});

describe('Harvard', () => {
  it('puts the year in brackets', () => {
    const out = formatHarvard(BOOK);
    expect(out).toContain('Morrison, T. (1987)');
    expect(out).toContain('*Beloved*');
  });

  it('joins two authors with and', () => {
    expect(formatHarvard(CHAPTER)).toContain('hooks, B. and West, C.');
  });
});

describe('Chicago', () => {
  it('formats a book with the place of publication', () => {
    const out = formatChicago(BOOK);
    expect(out).toContain('Morrison, Toni.');
    expect(out).toContain('1987.');
    expect(out).toContain('New York: Alfred A. Knopf');
  });
});

describe('formatCitation', () => {
  it('routes to the right formatter', () => {
    expect(formatCitation(BOOK, 'apa')).toContain('(1987)');
    expect(formatCitation(BOOK, 'mla')).toContain('"Beloved."');
    expect(formatCitation(BOOK, 'harvard')).toContain('(1987)');
    expect(formatCitation(BOOK, 'chicago')).toContain('New York:');
  });
});

describe('formatBibliography', () => {
  it('sorts by author', () => {
    const bib = formatBibliography([WEBSITE, BOOK], 'apa');
    const morrison = bib.indexOf('Morrison');
    const atwood = bib.indexOf('Atwood');
    expect(atwood).toBeGreaterThanOrEqual(0);
    expect(morrison).toBeGreaterThan(atwood);
  });

  it('separates entries with a blank line', () => {
    const bib = formatBibliography([BOOK, ARTICLE], 'apa');
    expect(bib.split('\n\n')).toHaveLength(2);
  });
});

describe('toBibTeX', () => {
  it('writes an entry per source', () => {
    const bib = toBibTeX([BOOK, ARTICLE]);
    expect(bib).toContain('@book');
    expect(bib).toContain('@article');
    expect(bib).toContain('publisher = {Alfred A. Knopf}');
  });

  it('writes an author list joined with and', () => {
    expect(toBibTeX([CHAPTER])).toContain('author = {hooks, bell and West, Cornel}');
  });
});

describe('toRIS', () => {
  it('writes RIS tags with CRLF line endings', () => {
    const ris = toRIS([ARTICLE]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('AU  - Smith, John A.');
    expect(ris).toContain('TI  - The structure of scientific revolutions');
    expect(ris).toContain('ER  - ');
    expect(ris).toContain('\r\n');
  });
});

describe('inTextCitation', () => {
  it('is author-date in APA', () => {
    expect(inTextCitation(BOOK, 'apa')).toBe('(Morrison, 1987)');
  });

  it('is author-page in MLA', () => {
    expect(inTextCitation(ARTICLE, 'mla', '45')).toBe('(Smith 45)');
  });
});

describe('citationKey', () => {
  it('is readable and unique-ish', () => {
    expect(citationKey(BOOK)).toBe('morrison1987beloved');
  });
});

describe('sourceLabel', () => {
  it('says who and when', () => {
    expect(sourceLabel(ARTICLE)).toBe('Smith (2024) — The structure of scientific revolutions');
  });
});
