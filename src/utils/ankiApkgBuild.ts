/**
 * ankiApkgBuild — assembling a real Anki collection file.
 *
 * The rows are computed by `buildCollectionRows`, which is pure and tested;
 * this module does the part that needs a real SQLite engine and a ZIP
 * writer.
 *
 * sql.js is loaded with a dynamic import so its ~1MB of WebAssembly is a
 * separate chunk: a student who never exports to Anki never downloads it.
 * The "inline" build is used because it carries the WebAssembly inside the
 * JavaScript, so there is no second file to fetch and nothing to configure.
 */
import JSZip from 'jszip';
import {
  ANKI_SCHEMA_SQL,
  ANKI_SCHEMA_VERSION,
  DEFAULT_DECK_ID,
  MODEL_ID,
  buildConfig,
  buildDeckConfig,
  buildDecks,
  buildNoteModel,
  easeForQuality,
  fieldChecksum,
  makeGuid,
  scheduleFor,
  stripHtml,
  tagsFor,
  type ApkgCard,
  type CardRow,
  type NoteRow,
  type RevlogRow,
} from './ankiApkg';

/** Local midnight on the day of `d` — the unit Anki counts days in. */
function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** The rows for one collection. Pure, so it can be tested without SQLite. */
export interface CollectionRows {
  notes: NoteRow[];
  cards: CardRow[];
  revlog: RevlogRow[];
  /** Deck name → deck id. */
  deckIds: Map<string, number>;
  /** The collection's creation time, in seconds. */
  crt: number;
  /** The same, in milliseconds — used for scheduling maths. */
  crtMs: number;
}

/**
 * Turn a list of cards into the rows of an Anki collection.
 *
 * Two notes are harder than they look:
 *
 *   - a card that has been reviewed keeps its schedule, so it does not land
 *     back in the new queue — losing that is what makes most exporters
 *     annoying;
 *   - the note model has two templates, so every card produces two card
 *     rows (front and back). Anki expects both.
 */
export function buildCollectionRows(cards: ApkgCard[], now: Date = new Date()): CollectionRows {
  const crtDate = startOfDay(now);
  const crtMs = crtDate.getTime();
  const crt = Math.floor(crtMs / 1000);
  const mod = now.getTime();

  const notes: NoteRow[] = [];
  const cardRows: CardRow[] = [];
  const revlog: RevlogRow[] = [];
  const deckIds = new Map<string, number>([['Default', DEFAULT_DECK_ID]]);

  let nextDeckId = 2;
  for (const card of cards) {
    const name = (card.deckName ?? 'Default').trim() || 'Default';
    if (!deckIds.has(name)) deckIds.set(name, nextDeckId++);
  }

  let noteId = now.getTime() * 1000;
  let cardId = now.getTime() * 1000;
  let revlogId = now.getTime() * 1000;
  let newCardIndex = 1;

  cards.forEach((card, index) => {
    const id = noteId++;
    const guid = makeGuid(id + index * 7919);
    const deckName = (card.deckName ?? 'Default').trim() || 'Default';
    const did = deckIds.get(deckName) ?? DEFAULT_DECK_ID;

    notes.push({
      id,
      guid,
      mid: MODEL_ID,
      mod,
      usn: -1,
      tags: tagsFor(card),
      flds: `${card.question}\x1f${card.answer}`,
      sfld: stripHtml(card.question),
      csum: fieldChecksum(card.question),
      flags: 0,
      data: '',
    });

    const schedule = scheduleFor(card, crtMs, newCardIndex);
    if (schedule.type === 0) newCardIndex++;

    // The model has two templates: the card and its reverse.
    for (let ord = 0; ord < 2; ord++) {
      const cid = cardId++;
      cardRows.push({
        id: cid,
        nid: id,
        did,
        ord,
        mod,
        usn: -1,
        type: schedule.type,
        queue: schedule.queue,
        due: schedule.due,
        ivl: schedule.ivl,
        factor: schedule.factor,
        reps: schedule.reps,
        lapses: schedule.lapses,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: '',
      });

      // The review trail becomes Anki's review log, so the card's history
      // survives the journey.
      const history = card.reviewHistory ?? [];
      history.forEach((entry, hIndex) => {
        revlog.push({
          id: revlogId++,
          cid,
          usn: -1,
          ease: easeForQuality(entry.quality),
          ivl: schedule.ivl,
          lastIvl: hIndex === 0 ? 0 : schedule.ivl,
          factor: schedule.factor,
          time: 0,
          type: hIndex === 0 ? 0 : 1,
        });
      });
    }
  });

  return { notes, cards: cardRows, revlog, deckIds, crt, crtMs };
}

/** The `col` row — the collection's own metadata. */
export function buildColRow(rows: CollectionRows, now: Date = new Date()): {
  id: number; crt: number; mod: number; scm: number; ver: number;
  dty: number; usn: number; ls: number; conf: string; models: string;
  decks: string; dconf: string; tags: string;
} {
  return {
    id: 1,
    crt: rows.crt,
    mod: now.getTime(),
    scm: now.getTime(),
    ver: ANKI_SCHEMA_VERSION,
    dty: 0,
    usn: -1,
    ls: 0,
    conf: buildConfig(),
    models: buildNoteModel(rows.crt),
    decks: buildDecks(Array.from(rows.deckIds.keys()), rows.crt),
    dconf: buildDeckConfig(),
    tags: '{}',
  };
}

/**
 * Build the `.apkg` file.
 *
 * The collection and the media map are stored uncompressed inside the ZIP,
 * which is what Anki has always expected; the archive itself is deflated.
 */
export async function buildApkg(cards: ApkgCard[], now: Date = new Date()): Promise<Blob> {
  const rows = buildCollectionRows(cards, now);
  const col = buildColRow(rows, now);

  const initSqlJs = (await import('sql.js/dist/sql-wasm-inline.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(ANKI_SCHEMA_SQL);

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [col.id, col.crt, col.mod, col.scm, col.ver, col.dty, col.usn, col.ls,
     col.conf, col.models, col.decks, col.dconf, col.tags],
  );

  for (const n of rows.notes) {
    db.run(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.id, n.guid, n.mid, n.mod, n.usn, n.tags, n.flds, n.sfld, n.csum, n.flags, n.data],
    );
  }

  for (const c of rows.cards) {
    db.run(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.nid, c.did, c.ord, c.mod, c.usn, c.type, c.queue, c.due, c.ivl,
       c.factor, c.reps, c.lapses, c.left, c.odue, c.odid, c.flags, c.data],
    );
  }

  for (const r of rows.revlog) {
    db.run(
      `INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.cid, r.usn, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type],
    );
  }

  const dbBytes = db.export();
  db.close();

  const zip = new JSZip();
  // Stored, not deflated — this is what Anki's reader expects.
  zip.file('collection.anki2', dbBytes, { compression: 'STORE' });
  zip.file('media', JSON.stringify({}), { compression: 'STORE' });

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** The suggested file name for an export. */
export function apkgFileName(now: Date = new Date()): string {
  return `studyworks-${now.toISOString().slice(0, 10)}.apkg`;
}
