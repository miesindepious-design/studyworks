/**
 * AnkiPanel — move cards between StudyWorks and Anki.
 *
 * Students often already keep a deck in Anki, and being locked into one app
 * is the fastest way to lose one. Export writes a standard Anki text file;
 * import reads one back (tab or comma separated) and merges the cards in
 * without duplicating what is already there.
 */
import { useRef, useState } from 'react';
import type { Flashcard } from '../types';
import { downloadTextFile, exportToAnki, parseAnkiFile } from '../utils/anki';

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

  const doExport = () => {
    if (!flashcards.length) {
      onToast?.('There are no cards to export yet.', 'info');
      return;
    }
    const text = exportToAnki(flashcards);
    downloadTextFile(`studyworks-cards-${new Date().toISOString().slice(0, 10)}.txt`, text);
    onToast?.(`Exported ${flashcards.length} cards for Anki.`, 'success');
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
          Move your cards in and out of Anki. Export writes a standard Anki text file; import reads
          tab or comma separated files and skips anything you already have.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={doExport}>
          Export {flashcards.length} cards
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
