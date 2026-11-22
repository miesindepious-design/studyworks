import { useEffect, useState } from 'react';
import type { Note } from '../types';
import { generatedDocsDB } from '../db/generatedDocs';
import { downloadBlob } from '../utils/docBuilders';

/**
 * NoteDocumentCard — the card that replaces the wall of text.
 *
 * When the AI tutor saves a lesson, it saves it as a document: a Word
 * handout, a PDF worksheet or a slide deck. The note keeps a reference to
 * that file, and this card is what the student sees — the format, the file
 * name, and a button to open it again.
 */

const FORMAT_ICON = { docx: '📘', pdf: '📕', pptx: '📙' } as const;
const FORMAT_NAME = { docx: 'Word document', pdf: 'PDF worksheet', pptx: 'Slide deck' } as const;

interface Props {
  note: Note;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  /** Remove the document from the note (the file is deleted too). */
  onDetach?: (noteId: string) => void;
}

export default function NoteDocumentCard({ note, addToast, onDetach }: Props) {
  const meta = note.document;
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!meta) { setPresent(null); return; }
    generatedDocsDB.get(meta.id)
      .then(doc => { if (!cancelled) setPresent(Boolean(doc)); })
      .catch(() => { if (!cancelled) setPresent(false); });
    return () => { cancelled = true; };
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return null;

  const open = async () => {
    setBusy(true);
    try {
      const doc = await generatedDocsDB.get(meta.id);
      if (!doc) {
        addToast('That document is no longer stored on this device.', 'error');
        setPresent(false);
        return;
      }
      downloadBlob(doc.blob, doc.fileName || meta.fileName);
      addToast(`${FORMAT_NAME[meta.format] || 'Document'} downloaded.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not open that document.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    setBusy(true);
    try {
      await generatedDocsDB.delete(meta.id);
      onDetach?.(note.id);
      addToast('Document removed from the note.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not remove that document.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        padding: '0.6rem 0.75rem', marginBottom: '0.75rem',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <span style={{ fontSize: '1.25rem' }}>{FORMAT_ICON[meta.format] ?? '📄'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700 }}>
          {FORMAT_NAME[meta.format] ?? meta.format}
        </p>
        <p className="text-xs text-muted" style={{ margin: '0.1rem 0 0', wordBreak: 'break-all' }}>
          {meta.fileName}
          {meta.size ? ` · ${(meta.size / 1024).toFixed(0)} KB` : ''}
          {present === false && ' · not stored on this device'}
        </p>
        {meta.reason && (
          <p className="text-xs text-muted" style={{ margin: '0.15rem 0 0' }}>{meta.reason}</p>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        <button className="btn btn-primary btn-xs" onClick={open} disabled={busy || present === false}>
          {busy ? '…' : '⬇ Open'}
        </button>
        {onDetach && (
          <button className="btn btn-ghost btn-xs" onClick={detach} disabled={busy} title="Remove this document">
            🗑
          </button>
        )}
      </div>
    </div>
  );
}
