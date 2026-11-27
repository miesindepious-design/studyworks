/**
 * ImportPanel — bring cards in from where the student already has them.
 *
 * Quizlet, Notion and Google Docs all hand over a file, and all three
 * formats are different enough that guessing is a bad idea. So the panel
 * reads the file, works out which shape it is, shows exactly what it found
 * and lets the student check it before anything is saved.
 *
 * Nothing is written to the deck until the student confirms — an import
 * that silently adds two hundred half-empty cards is worse than no import.
 */
import { useRef, useState } from 'react';
import type { Flashcard, Folder } from '../types';
import { extractTextFromFile } from '../utils/extractText';
import { FORMAT_LABEL, importCards, type ImportPreview } from '../utils/importers';

export interface ImportPanelProps {
  flashcards: Flashcard[];
  setFlashcards: (next: Flashcard[]) => void;
  folders: Folder[];
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Fired with how many cards were added, so the app can award XP. */
  onImported?: (count: number) => void;
}

export default function ImportPanel({
  flashcards, setFlashcards, folders, onToast, onImported,
}: ImportPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string>('default');
  const [addTags, setAddTags] = useState(true);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setFileName(file.name);
    try {
      // A .docx or .pdf has to be turned into text first; the importers
      // all work on text.
      const isBinary = /\.(docx|doc|pdf|pptx)$/i.test(file.name);
      const text = isBinary
        ? (await extractTextFromFile(file, { maxBytes: 200_000 })).text
        : await file.text();

      if (!text.trim()) {
        setError('That file had no readable text in it.');
        return;
      }

      const result = importCards(file.name, text);
      setPreview(result);
      if (!result.cards.length) {
        setError(result.warnings[0] ?? 'No cards could be read from that file.');
      }
    } catch (err) {
      setError((err as Error).message || 'Could not read that file.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirm = () => {
    if (!preview || !preview.cards.length) return;

    const existing = new Set(flashcards.map(c => c.question.trim().toLowerCase()));
    const now = new Date();
    const fresh: Flashcard[] = preview.cards
      .filter(c => c.question.trim() && !existing.has(c.question.trim().toLowerCase()))
      .map(c => ({
        id: crypto.randomUUID(),
        question: c.question.trim(),
        answer: c.answer.trim() || c.question.trim(),
        tags: addTags ? c.tags : [],
        folderId,
        createdAt: now,
        updatedAt: now,
        difficulty: 'medium' as const,
        repetitions: 0,
        interval: 0,
        ef: 2.5,
        // Where it came from. An imported card was written by somebody else,
        // so the AI rewriter is not offered for it — the student asked for
        // these to be kept as they are.
        source: 'import' as const,
      }));

    if (!fresh.length) {
      onToast?.('Every card in that file is already in your deck.', 'info');
      setPreview(null);
      return;
    }

    setFlashcards([...flashcards, ...fresh]);
    onImported?.(fresh.length);
    onToast?.(`Imported ${fresh.length} card${fresh.length === 1 ? '' : 's'} from ${fileName}.`, 'success');
    setPreview(null);
    setFileName('');
  };

  const shown = preview?.cards.slice(0, 8) ?? [];

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
        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>📥 Import cards</h4>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-2)' }}>
          Bring cards in from Quizlet, Notion or Google Docs. Nothing is saved until you have
          checked what was found.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Reading…' : 'Choose a file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.tsv,.md,.docx,.doc,.pdf,text/plain,text/csv,text/markdown"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <span className="text-xs text-muted">
          Quizlet (.txt) · Notion (.csv, .md) · Docs (.docx, .pdf)
        </span>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
      )}

      {preview && preview.cards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="tag success">
              {FORMAT_LABEL[preview.format]} — {preview.cards.length} card{preview.cards.length === 1 ? '' : 's'}
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span className="text-xs text-muted">Into folder</span>
              <select
                className="select select-sm"
                value={folderId}
                onChange={e => setFolderId(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="default">General</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={addTags}
                onChange={e => setAddTags(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span className="text-xs text-muted">Keep the tags</span>
            </label>
          </div>

          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs" style={{ margin: 0, color: 'var(--warning)' }}>{w}</p>
          ))}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              maxHeight: '15rem',
              overflowY: 'auto',
              padding: '0.6rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--surface-0)',
            }}
          >
            {shown.map((c, i) => (
              <div key={i} style={{ fontSize: '0.8rem' }}>
                <span style={{ fontWeight: 600 }}>{c.question}</span>
                <span style={{ color: 'var(--text-2)' }}> — {c.answer}</span>
                {c.tags.length > 0 && (
                  <span className="text-xs text-muted"> ({c.tags.join(', ')})</span>
                )}
              </div>
            ))}
            {preview.cards.length > shown.length && (
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                …and {preview.cards.length - shown.length} more.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPreview(null); setFileName(''); }}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={confirm}>
              Import {preview.cards.length} card{preview.cards.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
