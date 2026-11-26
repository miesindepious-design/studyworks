/**
 * AnkiPanel — move cards between StudyWorks and Anki.
 *
 * Students often already keep a deck in Anki, and being locked into one app
 * is the fastest way to lose one.
 *
 * Two exports, because they are good for different things:
 *
 *   - `.apkg` is a real Anki collection. Anki opens it directly, and the
 *     cards keep their scheduling state — intervals, ease factors, the
 *     review trail — instead of every card landing back in the new queue.
 *   - the text file is the interchange format. It is what a student pastes
 *     into Anki's own import wizard, and it is the one thing Anki and
 *     every other tool can read.
 *
 * Import reads a text file back (tab or comma separated) and merges the
 * cards in without duplicating what is already there.
 */
import { useRef, useState } from 'react';
import type { Flashcard } from '../types';
import { downloadTextFile, exportToAnki, parseAnkiFile } from '../utils/anki';
import { buildApkg, apkgFileName } from '../utils/ankiApkgBuild';

export interface AnkiPanelProps {
  flashcards: Flashcard[];
  setFlashcards: (next: Flashcard[]) => void;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Fired with how many cards were added, so the app can award XP. */
  onImported?: (count: number) => void;
}

export default function AnkiPanel({ flashcards, setFlashcards, onToast, onImported }: AnkiPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const doExport = () => {
    if (!flashcards.length) {
      onToast?.('There are no cards to export yet.', 'info');
      return;
    }
    const text = exportToAnki(flashcards);
    downloadTextFile(`studyworks-cards-${new Date().toISOString().slice(0, 10)}.txt`, text);
    onToast?.(`Exported ${flashcards.length} cards for Anki.`, 'success');
  };

  /**
   * Export a real Anki collection.
   *
   * The card's own folder becomes the Anki deck, so a student with three
   * courses gets three decks rather than one flat pile.
   */
  const doExportApkg = async () => {
    if (!flashcards.length) {
      onToast?.('There are no cards to export yet.', 'info');
      return;
    }
    setExporting(true);
    try {
      const cards = flashcards.map(c => ({
        question: c.question,
        answer: c.answer,
        tags: c.tags,
        deckName: c.folderId || 'Default',
        interval: c.interval ?? 0,
        ef: c.ef ?? 2.5,
        repetitions: c.repetitions ?? 0,
        lapses: c.leechCount ?? 0,
        nextReview: c.nextReview ?? null,
        reviewHistory: c.reviewHistory,
      }));
      const blob = await buildApkg(cards);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = apkgFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Give the browser a moment to start the download before the URL dies.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast?.(`Exported a real Anki collection with ${flashcards.length} cards.`, 'success');
    } catch (err) {
      onToast?.((err as Error).message || 'Could not build the Anki collection.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseAnkiFile(text);
      if (!parsed.length) {
        onToast?.('No cards found in that file.', 'error');
        return;
      }

      const existing = new Set(flashcards.map(c => c.question.trim().toLowerCase()));
      const now = new Date();
      const fresh: Flashcard[] = parsed
        .filter(c => !existing.has(c.question.trim().toLowerCase()))
        .map(c => ({
          id: crypto.randomUUID(),
          question: c.question,
          answer: c.answer,
          tags: c.tags,
          createdAt: now,
          updatedAt: now,
          difficulty: 'medium' as const,
          repetitions: 0,
          interval: 0,
          ef: 2.5,
        }));

      if (!fresh.length) {
        onToast?.('Every card in that file is already here.', 'info');
        return;
      }

      setFlashcards([...flashcards, ...fresh]);
      onImported?.(fresh.length);
      onToast?.(`Imported ${fresh.length} new card${fresh.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      onToast?.((err as Error).message || 'Could not read that file', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        padding: '1rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
      }}
    >
      <div>
        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>🗂️ Anki import &amp; export</h4>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-2)' }}>
          Move your cards in and out of Anki. The <strong>.apkg</strong> export is a real Anki
          collection — Anki opens it directly and the cards keep their schedule. The text export is
          the interchange format. Import reads tab or comma separated files and skips anything you
          already have.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={doExportApkg} disabled={exporting}>
          {exporting ? 'Building…' : `📦 Export .apkg (${flashcards.length})`}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={doExport}>
          Export text file
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Reading…' : 'Import from a file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.tsv,text/plain,text/csv"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) doImport(file);
          }}
        />
      </div>
    </div>
  );
}
