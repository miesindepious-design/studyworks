/**
 * ankiApkg — building a real Anki collection (`.apkg`).
 *
 * The text export this replaces produces a file Anki can only read through
 * its own import wizard. A real `.apkg` is a ZIP holding a SQLite database
 * that Anki opens directly, which means the student's scheduling state
 * comes with them — intervals, ease factors, review history — instead of
 * every card landing back in the new queue.
 *
 * The layout of an `.apkg`:
 *
 *   collection.anki2   the SQLite collection
 *   media              a JSON map of media file names to their ids
 *   media/…            the media files themselves (none here)
 *
 * This module owns the *shape* of the collection — the schema, the note
 * model, the deck, and the row values. `buildApkg` puts the bytes together.
 *
 * Field separator inside a note is U+001F, and tags are space-separated.
 */

/** The two characters Anki uses between fields and inside cloze markers. */
export const FIELD_SEPARATOR = '\x1f';

/** The schema version Anki 2.1 expects. */
export const ANKI_SCHEMA_VERSION = 11;

/** The note type this exporter writes: front, back, and a reversed card. */
export const MODEL_ID = 1607392319;

/** The default deck everything lands in. */
export const DEFAULT_DECK_ID = 1;

/** The default deck configuration. */
export const DEFAULT_DCONF_ID = 1;

/** The card types, in Anki's numbering. */
export const CARD_TYPE_NEW = 0;
export const CARD_TYPE_LEARNING = 1;
export const CARD_TYPE_REVIEW = 2;

/** The queues, in Anki's numbering. */
export const QUEUE_NEW = 0;
export const QUEUE_LEARNING = 1;
export const QUEUE_REVIEW = 2;
export const QUEUE_SUSPENDED = -1;

/** One card, as this module sees it. */
export interface ApkgCard {
  question: string;
  answer: string;
  tags?: string[];
  /** The deck this card belongs to. */
  deckName?: string;
  /** Scheduling state, so the card keeps its place. */
  interval?: number;
  /** Ease factor, 1.3–3.5. Anki stores this multiplied by ten. */
  ef?: number;
  /** How many times the card has been reviewed. */
  repetitions?: number;
  /** How many times it has been forgotten. */
  lapses?: number;
  /** When it is next due. */
  nextReview?: Date | string | null;
  /** The review trail, so the card's history is not thrown away. */
  reviewHistory?: Array<{ date: string; quality: number }>;
}

/** Strip the HTML Anki does not want in a sort field. */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Anki's field checksum: the sum of every character's code point, masked to
 * 31 bits. Anki uses it to spot duplicate fields, so it has to match.
 */
export function fieldChecksum(text: string): number {
  let sum = 0;
  const clean = stripHtml(text);
  for (let i = 0; i < clean.length; i++) {
    sum += clean.charCodeAt(i);
  }
  return sum & 0x7fffffff;
}

/** A GUID that looks like Anki's — random, but from its character set. */
export function makeGuid(seed: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;=?@[]^_`{|}~';
  let value = Math.abs(Math.floor(seed)) || 1;
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[value % chars.length];
    value = Math.floor(value / chars.length) + (value * 31) % 65521;
  }
  return out;
}

/** Tags cannot contain spaces; Anki uses an underscore. */
export function cleanTag(tag: string): string {
  return tag.trim().replace(/\s+/g, '_').replace(/[^\w\-:.]/g, '');
}

/** The note model — "Basic (and reversed card)". */
export function buildNoteModel(createdSeconds: number): string {
  return JSON.stringify({
    [MODEL_ID]: {
      id: MODEL_ID,
      name: 'Basic (and reversed card)',
      type: 0,
      mod: createdSeconds,
      usn: -1,
      sortf: 0,
      did: DEFAULT_DECK_ID,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}',
          did: null,
          bqfmt: '',
          bafmt: '',
        },
        {
          name: 'Card 2',
          ord: 1,
          qfmt: '{{Back}}',
          afmt: '{{BackSide}}\n\n<hr id=answer>\n\n{{Front}}',
          did: null,
          bqfmt: '',
          bafmt: '',
        },
      ],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Back',  ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card {\n  font-family: arial;\n  font-size: 20px;\n  text-align: center;\n  color: black;\n  background-color: white;\n}\n',
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}\n',
      latexsvg: false,
      req: [[0, 'all', [0]], [1, 'all', [1]]],
      tags: [],
      vers: [],
    },
  });
}

/** The deck table. One deck by default; extra decks are added as they appear. */
export function buildDecks(deckNames: string[], createdSeconds: number): string {
  const decks: Record<string, unknown> = {};
  const seen = new Set<string>();

  const add = (id: number, name: string) => {
    decks[String(id)] = {
      id,
      name,
      mod: createdSeconds,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: '',
      dyn: 0,
      conf: DEFAULT_DCONF_ID,
      extendNew: 0,
      extendRev: 0,
    };
    seen.add(name);
  };

  add(DEFAULT_DECK_ID, 'Default');
  let nextId = 2;
  for (const name of deckNames) {
    const clean = name.trim();
    if (!clean || seen.has(clean)) continue;
    add(nextId++, clean);
    seen.add(clean);
  }

  return JSON.stringify(decks);
}

/** The deck configuration — Anki's "Default" preset. */
export function buildDeckConfig(): string {
  return JSON.stringify({
    [DEFAULT_DCONF_ID]: {
      id: DEFAULT_DCONF_ID,
      name: 'Default',
      mod: 0,
      usn: -1,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: {
        bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4],
        order: 1, perDay: 20,
      },
      rev: {
        bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500,
        perDay: 100, hardFactor: 1.2,
      },
      lapse: {
        delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0,
      },
      dyn: false,
      newMix: 0,
      newPerDayMinimum: 0,
      interdayLearningMix: 0,
      reviewOrder: 0,
      newSortOrder: 0,
      newGatherPriority: 0,
      buryInterdayLearning: false,
    },
  });
}

/** The collection configuration. */
export function buildConfig(): string {
  return JSON.stringify({
    nextPos: 1,
    estTimes: true,
    activeDecks: [DEFAULT_DECK_ID],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: DEFAULT_DECK_ID,
    newSpread: 0,
    collapseTime: 1200,
  });
}

/** The SQL that creates Anki's schema. */
export const ANKI_SCHEMA_SQL = `
CREATE TABLE col (
  id integer primary key,
  crt integer not null,
  mod integer not null,
  scm integer not null,
  ver integer not null,
  dty integer not null,
  usn integer not null,
  ls integer not null,
  conf text not null,
  models text not null,
  decks text not null,
  dconf text not null,
  tags text not null
);
CREATE TABLE notes (
  id integer primary key,
  guid text not null,
  mid integer not null,
  mod integer not null,
  usn integer not null,
  tags text not null,
  flds text not null,
  sfld integer not null,
  csum integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE cards (
  id integer primary key,
  nid integer not null,
  did integer not null,
  ord integer not null,
  mod integer not null,
  usn integer not null,
  type integer not null,
  queue integer not null,
  due integer not null,
  ivl integer not null,
  factor integer not null,
  reps integer not null,
  lapses integer not null,
  left integer not null,
  odue integer not null,
  odid integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);
CREATE TABLE graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** One row of the `notes` table. */
export interface NoteRow {
  id: number;
  guid: string;
  mid: number;
  mod: number;
  usn: number;
  tags: string;
  flds: string;
  sfld: string;
  csum: number;
  flags: number;
  data: string;
}

/** One row of the `cards` table. */
export interface CardRow {
  id: number;
  nid: number;
  did: number;
  ord: number;
  mod: number;
  usn: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
  data: string;
}

/** One row of the `revlog` table. */
export interface RevlogRow {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

/**
 * How a card's scheduling state maps onto Anki's.
 *
 * A card that has never been reviewed is new. A card that has an interval
 * is a review card, and its `due` is a number of days from the collection's
 * creation — not a timestamp, which is the detail that breaks most
 * hand-built exporters.
 */
export function scheduleFor(
  card: ApkgCard,
  collectionCreatedMs: number,
  newCardIndex: number,
): { type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number } {
  const reps = Math.max(0, card.repetitions ?? 0);
  const ivl = Math.max(0, Math.round(card.interval ?? 0));
  const factor = Math.round((card.ef ?? 2.5) * 1000);
  const lapses = Math.max(0, card.lapses ?? 0);

  if (reps === 0 && ivl === 0) {
    // New cards are queued by position, not by date.
    return {
      type: CARD_TYPE_NEW,
      queue: QUEUE_NEW,
      due: newCardIndex,
      ivl: 0,
      factor: 2500,
      reps: 0,
      lapses: 0,
    };
  }

  // A review card's due date is days since the collection was created.
  let due = 0;
  if (card.nextReview) {
    const target = new Date(card.nextReview).getTime();
    const days = Math.round((target - collectionCreatedMs) / 86_400_000);
    due = Number.isFinite(days) ? days : 0;
  } else {
    due = ivl;
  }

  return {
    type: CARD_TYPE_REVIEW,
    queue: QUEUE_REVIEW,
    // Not clamped: a negative due is how Anki knows a card is overdue, and
    // clamping it to zero would quietly reschedule it to today.
    due,
    ivl,
    factor: Math.max(1300, factor),
    reps,
    lapses,
  };
}

/**
 * Anki's rating names, from a quality number.
 *
 * StudyWorks uses SM-2's 0–3 scale, which lines up with Anki's buttons:
 * 0 = Again, 1 = Hard, 2 = Good, 3 = Easy.
 */
export function easeForQuality(quality: number): number {
  switch (quality) {
    case 0: return 1;   // Again
    case 1: return 2;   // Hard
    case 3: return 4;   // Easy
    default: return 3;  // Good
  }
}

/** The tag string for a card. */
export function tagsFor(card: ApkgCard): string {
  const tags = (card.tags ?? []).map(cleanTag).filter(Boolean);
  return tags.join(' ');
}
