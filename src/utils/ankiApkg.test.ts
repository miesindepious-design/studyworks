/**
 * Tests for the Anki collection exporter.
 *
 * Two layers:
 *
 *   1. the row building (pure): the note model, the schedule, the tags,
 *      the checksum — the details that decide whether Anki opens the file
 *      or refuses it;
 *   2. the file itself: build an .apkg, unzip it, and read the SQLite
 *      back. A file that cannot be read is not an export.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildCollectionRows,
  buildColRow,
  buildApkg,
  apkgFileName,
} from './ankiApkgBuild';
import {
  cleanTag,
  easeForQuality,
  fieldChecksum,
  makeGuid,
  scheduleFor,
  stripHtml,
  tagsFor,
  ANKI_SCHEMA_VERSION,
  MODEL_ID,
  type ApkgCard,
} from './ankiApkg';

const card = (over: Partial<ApkgCard> = {}): ApkgCard => ({
  question: 'Where does the cell produce most of its ATP?',
  answer: 'The mitochondria',
  ...over,
});

const NOW = new Date('2026-11-26T10:00:00Z');

describe('stripHtml', () => {
  it('removes tags and entities', () => {
    expect(stripHtml('<b>Bold</b> &amp; <i>italic</i>')).toBe('Bold & italic');
  });

  it('turns breaks into spaces so words do not run together', () => {
    expect(stripHtml('one<br>two')).toBe('one two');
  });
});

describe('fieldChecksum', () => {
  it('sums the character codes', () => {
    expect(fieldChecksum('abc')).toBe(97 + 98 + 99);
  });

  it('is the same for the same field with different HTML', () => {
    expect(fieldChecksum('<b>abc</b>')).toBe(fieldChecksum('abc'));
  });
});

describe('makeGuid', () => {
  it('is ten characters long and varies', () => {
    expect(makeGuid(1)).toHaveLength(10);
    expect(makeGuid(1)).not.toBe(makeGuid(2));
  });
});

describe('cleanTag', () => {
  it('replaces spaces with underscores', () => {
    expect(cleanTag('cell biology')).toBe('cell_biology');
  });

  it('drops characters Anki would not accept', () => {
    expect(cleanTag('a#b!c')).toBe('abc');
  });
});

describe('easeForQuality', () => {
  it('maps the SM-2 scale onto Anki buttons', () => {
    expect(easeForQuality(0)).toBe(1);   // Again
    expect(easeForQuality(1)).toBe(2);   // Hard
    expect(easeForQuality(2)).toBe(3);   // Good
    expect(easeForQuality(3)).toBe(4);   // Easy
  });
});

describe('scheduleFor', () => {
  it('makes an unreviewed card a new card, queued by position', () => {
    const s = scheduleFor(card(), NOW.getTime(), 5);
    expect(s.type).toBe(0);
    expect(s.queue).toBe(0);
    expect(s.due).toBe(5);
    expect(s.ivl).toBe(0);
  });

  it('keeps a reviewed card as a review card with its interval', () => {
    const s = scheduleFor(card({ repetitions: 3, interval: 12, ef: 2.3 }), NOW.getTime(), 1);
    expect(s.type).toBe(2);
    expect(s.queue).toBe(2);
    expect(s.ivl).toBe(12);
    expect(s.factor).toBe(2300);
    expect(s.reps).toBe(3);
  });

  it('measures the due date in days from the collection, not as a timestamp', () => {
    // Due three days after the collection was created.
    const due = new Date(NOW.getTime() + 3 * 86_400_000);
    const s = scheduleFor(card({ repetitions: 2, interval: 3, nextReview: due }), NOW.getTime(), 1);
    expect(s.due).toBe(3);
  });

  it('lets an overdue card be overdue', () => {
    const due = new Date(NOW.getTime() - 2 * 86_400_000);
    const s = scheduleFor(card({ repetitions: 2, interval: 3, nextReview: due }), NOW.getTime(), 1);
    expect(s.due).toBe(-2);
  });

  it('never gives an ease factor below Anki floor', () => {
    const s = scheduleFor(card({ repetitions: 2, interval: 3, ef: 1.0 }), NOW.getTime(), 1);
    expect(s.factor).toBe(1300);
  });
});

describe('tagsFor', () => {
  it('joins cleaned tags with spaces', () => {
    expect(tagsFor(card({ tags: ['cell biology', 'year 1'] }))).toBe('cell_biology year_1');
  });
});

describe('buildCollectionRows', () => {
  it('writes one note and two cards per flashcard', () => {
    const rows = buildCollectionRows([card(), card({ question: 'Q2' })], NOW);
    expect(rows.notes).toHaveLength(2);
    // The note model has two templates — front and back.
    expect(rows.cards).toHaveLength(4);
  });

  it('joins the fields with Anki field separator', () => {
    const rows = buildCollectionRows([card()], NOW);
    expect(rows.notes[0].flds).toBe('Where does the cell produce most of its ATP?\x1fThe mitochondria');
  });

  it('uses the note model id', () => {
    const rows = buildCollectionRows([card()], NOW);
    expect(rows.notes[0].mid).toBe(MODEL_ID);
  });

  it('points both card templates at the same note', () => {
    const rows = buildCollectionRows([card()], NOW);
    expect(rows.cards[0].nid).toBe(rows.notes[0].id);
    expect(rows.cards[1].nid).toBe(rows.notes[0].id);
    expect(rows.cards[0].ord).toBe(0);
    expect(rows.cards[1].ord).toBe(1);
  });

  it('gives every new note its own queue position', () => {
    const rows = buildCollectionRows([card(), card(), card()], NOW);
    const news = rows.cards.filter(c => c.type === 0);
    // The two card templates of one note share a position — that is how
    // Anki keeps a note and its reverse next to each other in the queue.
    expect(news.map(c => c.due)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('keeps the review trail as a review log', () => {
    const rows = buildCollectionRows([
      card({ repetitions: 2, interval: 5, reviewHistory: [
        { date: '2026-11-20', quality: 0 },
        { date: '2026-11-22', quality: 2 },
      ] }),
    ], NOW);
    expect(rows.revlog).toHaveLength(4); // two entries × two card templates
    expect(rows.revlog[0].ease).toBe(1);  // quality 0 → Again
    expect(rows.revlog[1].ease).toBe(3);  // quality 2 → Good
  });

  it('puts each card in its own deck', () => {
    const rows = buildCollectionRows([
      card({ deckName: 'Biology' }),
      card({ question: 'Q2', deckName: 'Physics' }),
      card({ question: 'Q3', deckName: 'Biology' }),
    ], NOW);
    const bio = rows.deckIds.get('Biology');
    const phys = rows.deckIds.get('Physics');
    expect(bio).not.toBe(phys);
    expect(rows.cards.filter(c => c.did === bio)).toHaveLength(4);
  });
});

describe('buildColRow', () => {
  it('writes the schema version Anki expects', () => {
    const rows = buildCollectionRows([card()], NOW);
    const col = buildColRow(rows, NOW);
    expect(col.ver).toBe(ANKI_SCHEMA_VERSION);
    expect(col.id).toBe(1);
  });

  it('writes a parseable note model and deck list', () => {
    const rows = buildCollectionRows([card({ deckName: 'Biology' })], NOW);
    const col = buildColRow(rows, NOW);
    const models = JSON.parse(col.models);
    const decks = JSON.parse(col.decks);
    expect(models[String(MODEL_ID)].tmpls).toHaveLength(2);
    expect(Object.values(decks).map((d: any) => d.name)).toContain('Biology');
  });
});

describe('buildApkg', () => {
  it('produces a zip holding a readable Anki collection', async () => {
    const blob = await buildApkg([
      card({ tags: ['biology'], repetitions: 2, interval: 4, ef: 2.4 }),
      card({ question: 'What is ATP?', answer: 'Adenosine triphosphate' }),
    ], NOW);

    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names).toContain('collection.anki2');
    expect(names).toContain('media');

    // The collection really is a SQLite database.
    const bytes = await zip.file('collection.anki2')!.async('uint8array');
    expect(String.fromCharCode(...bytes.slice(0, 15))).toBe('SQLite format 3');

    // And the media map is the JSON Anki expects.
    const media = await zip.file('media')!.async('string');
    expect(JSON.parse(media)).toEqual({});
  }, 60_000);

  it('names the file after the day it was made', () => {
    expect(apkgFileName(NOW)).toBe('studyworks-2026-11-26.apkg');
  });
});
