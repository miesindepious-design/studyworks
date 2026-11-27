/**
 * NoteSources — the sources behind one note.
 *
 * A note that paraphrases a book should say where it came from. The
 * bibliography on the Citations page holds the full reference; this shows
 * the handful that back *this* note, right where the student is reading.
 *
 * It is deliberately small: the title, the author and the year. The full
 * reference is one click away in the bibliography, and the point here is to
 * answer "where did this come from" without leaving the note.
 */
import { useCallback, useEffect, useState } from 'react';
import { listCitations, type CitationDTO } from '../api/citations';

const LOCAL_KEY = 'sw-citations';

export interface NoteSourcesProps {
  noteId: string;
  authenticated: boolean;
  /** Sends the student to the bibliography. */
  onOpenCitations?: () => void;
}

/** "Smith (2024)" — enough to recognise the source. */
function shortLabel(c: CitationDTO): string {
  const first = c.authors[0] ?? '';
  const last = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).pop() ?? '';
  const who = last || 'Unknown';
  return c.year ? `${who} (${c.year})` : who;
}

function loadLocal(noteId: string): CitationDTO[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const all = raw ? (JSON.parse(raw) as CitationDTO[]) : [];
    return all.filter(c => c.noteId === noteId);
  } catch {
    return [];
  }
}

export default function NoteSources({ noteId, authenticated, onOpenCitations }: NoteSourcesProps) {
  const [items, setItems] = useState<CitationDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (authenticated) {
      try {
        setItems(await listCitations(noteId));
        setLoading(false);
        return;
      } catch {
        /* fall through to the local copy */
      }
    }
    setItems(loadLocal(noteId));
    setLoading(false);
  }, [authenticated, noteId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading || items.length === 0) return null;

  return (
    <div className="sw-note-sources">
      <div className="sw-note-sources-head">
        <span>Sources</span>
        {onOpenCitations && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={onOpenCitations}>
            Bibliography →
          </button>
        )}
      </div>
      <ul className="sw-note-sources-list">
        {items.map(c => (
          <li key={c.id}>
            <span className="sw-note-source-title">{c.title}</span>
            <span className="sw-note-source-who">{shortLabel(c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
