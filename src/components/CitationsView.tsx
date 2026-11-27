/**
 * CitationsView — the bibliography, and the reference list it builds.
 *
 * The hard part of an essay is not the argument, it is the reference list.
 * A student with the source in front of them still has to know whether the
 * year goes in brackets, whether the publisher goes before or after the
 * place, and whether three authors become "et al." or three names.
 *
 * So this asks for the facts — who, when, what, where — and formats them.
 * Four styles, because a course in one department can want a different one
 * from the next, and the switch is instant because only the facts are
 * stored. The formatting itself lives in `src/utils/citations.ts`, which is
 * pure and unit-tested.
 *
 * Sources live on the server so they follow the student between devices;
 * when nobody is signed in they are kept in localStorage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCitation,
  deleteCitation,
  listCitations,
  updateCitation,
  type CitationDTO,
} from '../api/citations';
import {
  SOURCE_TYPE_LABEL,
  STYLE_LABEL,
  citationKey,
  formatBibliography,
  formatCitation,
  inTextCitation,
  sortKey,
  sourceLabel,
  toBibTeX,
  toRIS,
  type CitationStyle,
  type SourceType,
} from '../utils/citations';

const LOCAL_KEY = 'sw-citations';

const STYLES: CitationStyle[] = ['apa', 'mla', 'harvard', 'chicago', 'ieee'];

const TYPES: SourceType[] = [
  'book', 'journal', 'website', 'chapter', 'video', 'report', 'thesis',
];

export interface CitationsViewProps {
  authenticated: boolean;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** The student's notes — a source can say which note it was used in. */
  notes?: Array<{ id: string; title: string }>;
}

const EMPTY_FORM = {
  type: 'book' as SourceType,
  /** The note this source was used in. */
  noteId: '',
  /** One author per line — the easiest way to type several. */
  authors: '',
  editor: '',
  year: '',
  title: '',
  container: '',
  publisher: '',
  place: '',
  volume: '',
  issue: '',
  pages: '',
  url: '',
  doi: '',
  accessed: '',
};

/** The editable fields — every one of them a string, so the form is uniform. */
type FormState = typeof EMPTY_FORM;

/**
 * The fields that are plain text boxes — everything except the type, and
 * except the note picker, which is a select rather than a box.
 */
type TextField = Exclude<keyof FormState, 'type' | 'noteId'>;

/** Which extra fields each source type actually uses. */
function fieldsFor(type: SourceType): TextField[] {
  switch (type) {
    case 'book':    return ['publisher', 'place'];
    case 'chapter': return ['container', 'editor', 'publisher', 'place', 'pages'];
    case 'journal': return ['container', 'volume', 'issue', 'pages', 'doi', 'url'];
    case 'website': return ['container', 'publisher', 'url', 'accessed'];
    case 'video':   return ['container', 'url'];
    case 'report':  return ['publisher', 'place', 'url'];
    case 'thesis':  return ['publisher', 'place', 'url'];
  }
}

const FIELD_LABEL: Record<TextField, string> = {
  authors: 'Author(s) — one per line',
  editor: 'Editor',
  year: 'Year',
  title: 'Title',
  container: 'Journal / book / website',
  publisher: 'Publisher',
  place: 'Place of publication',
  volume: 'Volume',
  issue: 'Issue',
  pages: 'Pages',
  url: 'URL',
  doi: 'DOI',
  accessed: 'Date accessed',
};

function toSource(dto: CitationDTO) {
  return {
    id: dto.id,
    type: dto.type,
    authors: dto.authors,
    editor: dto.editor ?? undefined,
    year: dto.year,
    title: dto.title,
    container: dto.container ?? undefined,
    publisher: dto.publisher ?? undefined,
    place: dto.place ?? undefined,
    volume: dto.volume ?? undefined,
    issue: dto.issue ?? undefined,
    pages: dto.pages ?? undefined,
    url: dto.url ?? undefined,
    doi: dto.doi ?? undefined,
    accessed: dto.accessed ?? undefined,
  };
}

function loadLocal(): CitationDTO[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as CitationDTO[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(items: CitationDTO[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Copy to the clipboard, with a fallback for browsers that refuse it. */
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function CitationsView({ authenticated, addToast, notes = [] }: CitationsViewProps) {
  const [items, setItems] = useState<CitationDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [style, setStyle] = useState<CitationStyle>('apa');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (authenticated) {
      try {
        const remote = await listCitations();
        setItems(remote);
        saveLocal(remote);
        return;
      } catch {
        /* fall through to the local copy */
      }
    }
    setItems(loadLocal());
  }, [authenticated]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const sources = useMemo(() => items.map(toSource), [items]);

  /**
   * IEEE numbers its references, so the in-text mark is a number in square
   * brackets. The number is the source's place in the reference list — which
   * is the list in sorted order, not the order the sources happen to be in.
   */
  const ieeeNumber = useMemo(() => {
    const order = new Map<string, number>();
    [...sources]
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .forEach((s, i) => order.set(s.id, i + 1));
    return order;
  }, [sources]);
  const bibliography = useMemo(
    () => (sources.length ? formatBibliography(sources, style) : ''),
    [sources, style],
  );

  const visibleFields = useMemo(() => fieldsFor(form.type), [form.type]);

  const reset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      addToast?.('Every source needs a title.', 'info');
      return;
    }
    const authors = form.authors
      .split('\n')
      .map(a => a.trim())
      .filter(Boolean);

    const payload = {
      noteId: form.noteId || null,
      type: form.type,
      authors,
      editor: form.editor.trim() || null,
      year: form.year.trim(),
      title: form.title.trim(),
      container: form.container.trim() || null,
      publisher: form.publisher.trim() || null,
      place: form.place.trim() || null,
      volume: form.volume.trim() || null,
      issue: form.issue.trim() || null,
      pages: form.pages.trim() || null,
      url: form.url.trim() || null,
      doi: form.doi.trim() || null,
      accessed: form.accessed.trim() || null,
    };

    try {
      if (authenticated) {
        const saved = await createCitation(payload);
        setItems(prev => [...prev, saved]);
        saveLocal([...items, saved]);
      } else {
        const local: CitationDTO = {
          ...payload,
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setItems(prev => [...prev, local]);
        saveLocal([...items, local]);
      }
      reset();
      setAdding(false);
      addToast?.('Source added.', 'success');
    } catch (err: any) {
      addToast?.(err.message || 'Could not add the source.', 'error');
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const authors = form.authors
      .split('\n')
      .map(a => a.trim())
      .filter(Boolean);
    const payload = {
      noteId: form.noteId || null,
      type: form.type,
      authors,
      editor: form.editor.trim() || null,
      year: form.year.trim(),
      title: form.title.trim(),
      container: form.container.trim() || null,
      publisher: form.publisher.trim() || null,
      place: form.place.trim() || null,
      volume: form.volume.trim() || null,
      issue: form.issue.trim() || null,
      pages: form.pages.trim() || null,
      url: form.url.trim() || null,
      doi: form.doi.trim() || null,
      accessed: form.accessed.trim() || null,
    };
    try {
      if (authenticated) {
        const saved = await updateCitation(editingId, payload);
        setItems(prev => prev.map(i => i.id === editingId ? saved : i));
      } else {
        setItems(prev => prev.map(i => i.id === editingId
          ? { ...i, ...payload, updatedAt: new Date().toISOString() }
          : i));
      }
      reset();
      setAdding(false);
      addToast?.('Source updated.', 'success');
    } catch (err: any) {
      addToast?.(err.message || 'Could not save the source.', 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this source?')) return;
    const previous = items;
    const next = items.filter(i => i.id !== id);
    setItems(next);
    saveLocal(next);
    if (!authenticated) return;
    try {
      await deleteCitation(id);
    } catch (err: any) {
      setItems(previous);
      addToast?.(err.message || 'Could not remove the source.', 'error');
    }
  };

  const startEdit = (s: CitationDTO) => {
    setEditingId(s.id);
    setAdding(true);
    setForm({
      noteId: s.noteId ?? '',
      type: s.type,
      authors: s.authors.join('\n'),
      editor: s.editor ?? '',
      year: s.year ?? '',
      title: s.title ?? '',
      container: s.container ?? '',
      publisher: s.publisher ?? '',
      place: s.place ?? '',
      volume: s.volume ?? '',
      issue: s.issue ?? '',
      pages: s.pages ?? '',
      url: s.url ?? '',
      doi: s.doi ?? '',
      accessed: s.accessed ?? '',
    });
  };

  const copyBibliography = async () => {
    const ok = await copy(bibliography);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      addToast?.('Reference list copied.', 'success');
    } else {
      addToast?.('Could not copy — select the list and copy it manually.', 'error');
    }
  };

  const exportFile = (kind: 'bib' | 'ris' | 'txt') => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'bib') {
      download(`bibliography-${stamp}.bib`, toBibTeX(sources), 'application/x-bibtex');
    } else if (kind === 'ris') {
      download(`bibliography-${stamp}.ris`, toRIS(sources), 'application/x-research-info-systems');
    } else {
      download(`bibliography-${stamp}.txt`, bibliography, 'text/plain');
    }
    addToast?.('Bibliography exported.', 'success');
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <span className="sw-label">Study</span>
          <h2>Citations</h2>
          <p className="text-sm text-muted">
            Your bibliography, and the reference list it builds — in the style your course wants.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setAdding(v => !v); reset(); }}>
          {adding ? 'Close' : '+ Add source'}
        </button>
      </div>

      {/* ── Style picker + export ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header">
          <span className="card-title">Reference list</span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select select-sm"
              value={style}
              onChange={e => setStyle(e.target.value as CitationStyle)}
              style={{ width: 'auto' }}
              aria-label="Citation style"
            >
              {STYLES.map(s => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
            </select>
            <button className="btn btn-secondary btn-xs" onClick={copyBibliography} disabled={!bibliography}>
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={() => exportFile('txt')} disabled={!bibliography}>
              ⬇ .txt
            </button>
            <button className="btn btn-secondary btn-xs" onClick={() => exportFile('bib')} disabled={!sources.length}>
              ⬇ .bib
            </button>
            <button className="btn btn-secondary btn-xs" onClick={() => exportFile('ris')} disabled={!sources.length}>
              ⬇ .ris
            </button>
          </div>
        </div>

        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && sources.length === 0 && (
          <div className="empty-state" style={{ padding: '2rem 1rem' }}>
            <div className="empty-state-icon">📚</div>
            <h3>No sources yet</h3>
            <p>
              Add the book, article or page you are citing. Pick a style and the
              reference list writes itself.
            </p>
          </div>
        )}

        {!loading && sources.length > 0 && (
          <pre className="sw-cite-output">{bibliography}</pre>
        )}
      </div>

      {/* ── Add / edit form ─────────────────────────────────────────────── */}
      {adding && (
        <form className="card" style={{ marginBottom: '1rem' }} onSubmit={editingId ? submitEdit : save}>
          <div className="card-header">
            <span className="card-title">{editingId ? 'Edit source' : 'New source'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); reset(); }}>✕</button>
          </div>

          <div className="sw-cite-form">
            <label>
              <span className="text-xs text-muted">Type</span>
              <select
                className="select"
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as SourceType })}
              >
                {TYPES.map(t => <option key={t} value={t}>{SOURCE_TYPE_LABEL[t]}</option>)}
              </select>
            </label>

            {/*
              Which note the source was used in. A source is often just a
              book on the student's shelf, so this is optional — but an
              essay needs to know which note said what, and which source
              backs it.
            */}
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="text-xs text-muted">Used in note</span>
              <select
                className="select"
                value={form.noteId}
                onChange={e => setForm({ ...form, noteId: e.target.value })}
              >
                <option value="">Not tied to a note</option>
                {notes.map(n => <option key={n.id} value={n.id}>{n.title || 'Untitled'}</option>)}
              </select>
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <span className="text-xs text-muted">{FIELD_LABEL.authors}</span>
              <textarea
                className="textarea"
                rows={2}
                value={form.authors}
                onChange={e => setForm({ ...form, authors: e.target.value })}
                placeholder={'Morrison, Toni\nSmith, Jane A.'}
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <span className="text-xs text-muted">{FIELD_LABEL.title}</span>
              <input
                className="input"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Beloved"
              />
            </label>

            <label>
              <span className="text-xs text-muted">{FIELD_LABEL.year}</span>
              <input
                className="input"
                value={form.year}
                onChange={e => setForm({ ...form, year: e.target.value })}
                placeholder="1987"
              />
            </label>

            {visibleFields.map(field => (
              <label key={field}>
                <span className="text-xs text-muted">{FIELD_LABEL[field]}</span>
                <input
                  className="input"
                  value={form[field]}
                  onChange={e => setForm({ ...form, [field]: e.target.value })}
                />
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{editingId ? 'Save changes' : 'Add source'}</button>
          </div>
        </form>
      )}

      {/* ── The library ─────────────────────────────────────────────────── */}
      {sources.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Your sources ({sources.length})</span>
          </div>
          <div className="sw-cite-list">
            {sources.map(s => {
              const dto = items.find(i => i.id === s.id);
              return (
                <div key={s.id} className="sw-cite-row">
                  <div className="sw-cite-row-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{s.title}</span>
                      <span className="tag">{SOURCE_TYPE_LABEL[s.type]}</span>
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>
                      {sourceLabel(s)}
                      {dto?.noteId && (
                        <>
                          {' · '}
                          <span className="sw-cite-note">
                            📓 {notes.find(n => n.id === dto.noteId)?.title ?? 'a note'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="sw-cite-preview">{formatCitation(s, style)}</div>
                    <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                      in-text: <code>{inTextCitation(s, style, undefined, ieeeNumber.get(s.id))}</code>
                      {' · '}key: <code>{citationKey(s)}</code>
                    </div>
                  </div>
                  <div className="sw-cite-row-actions">
                    <button className="btn btn-ghost btn-xs" onClick={() => startEdit(dto as CitationDTO)} title="Edit">✏️</button>
                    <button className="btn btn-danger btn-xs" onClick={() => remove(s.id)} title="Remove">🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
