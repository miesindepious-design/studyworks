import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addRoomFile, listRoomFiles, presignRoomFile, removeRoomFile,
  type RoomFileInfo, type RoomFileType,
} from '../api/roomFiles';
import { extractTextFromFile } from '../utils/extractText';
import { formatBytes } from './TutorDocuments';

/**
 * RoomFilesPanel — the study group's shared material.
 *
 * Every member of the lobby can drop a file here: the chapter everyone is
 * revising, the past paper to test each other on, the slides the tutor
 * should read. The browser extracts the text (PDF, DOCX, PPTX, OCR for
 * photos) and posts it with the metadata, because that text is what the AI
 * grounds a lesson, a quiz battle or a duel on.
 *
 * The panel is deliberately the same everywhere it appears — the lobby page,
 * the study room, the quiz waiting room — so "where do I put the file?" has
 * one answer.
 */

const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.json,.html,.htm,image/*';
const MAX_BYTES = 40 * 1024 * 1024;
/** How much text we send along for the AI to read. */
const MAX_TEXT_BYTES = 120 * 1024;

const KIND_ICON: Record<RoomFileType, string> = {
  pdf: '📕', docx: '📘', pptx: '📙', image: '🖼️', html: '🌐', text: '📄', other: '📎',
};

/** Which parser handles this file — decides the icon and the reader. */
function detectType(name: string): RoomFileType {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(lower)) return 'image';
  if (/\.(html?|xml)$/.test(lower)) return 'html';
  if (/\.(txt|md|csv|json|tsv|rtf)$/.test(lower)) return 'text';
  return 'other';
}

interface Props {
  /** The lobby whose material this is. Nothing renders without one. */
  lobbyCode: string | null;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  /** Open the AI tutor with this file as the material to study. */
  onStudyWithTutor?: (lobbyCode: string, file: RoomFileInfo) => void;
  /** Start a live quiz battle from the selected files. */
  onQuizFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
  /** Start an asynchronous duel from the selected files. */
  onDuelFiles?: (lobbyCode: string, files: RoomFileInfo[]) => void;
  /** Small heading above the panel. */
  title?: string;
  /** Extra hint under the heading. */
  hint?: string;
  /** Hide the quiz/duel actions (for screens that cannot start them). */
  hideGameActions?: boolean;
}

export default function RoomFilesPanel({
  lobbyCode, addToast, onStudyWithTutor, onQuizFiles, onDuelFiles,
  title = 'Shared material', hint, hideGameActions,
}: Props) {
  const [files, setFiles] = useState<RoomFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (code: string) => {
    try {
      const res = await listRoomFiles(code);
      setFiles(res.files);
    } catch {
      // Transient — the next poll retries.
    }
  }, []);

  useEffect(() => {
    if (!lobbyCode) { setFiles([]); return; }
    setLoading(true);
    refresh(lobbyCode).finally(() => setLoading(false));
  }, [lobbyCode, refresh]);

  // Keep the list fresh: a group adds files while somebody is looking at it.
  useEffect(() => {
    if (!lobbyCode) return;
    const timer = setInterval(() => refresh(lobbyCode), 10_000);
    const onFocus = () => refresh(lobbyCode);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [lobbyCode, refresh]);

  // ── Add a file ─────────────────────────────────────────────────────────────
  const upload = useCallback(async (incoming: File[]) => {
    if (!lobbyCode) return;
    const accepted = incoming.filter(f => f.size <= MAX_BYTES);
    if (accepted.length !== incoming.length) {
      addToast('Files larger than 40 MB were skipped.', 'info');
    }
    if (accepted.length === 0) return;

    setUploading(prev => ({ ...prev, ...Object.fromEntries(accepted.map(f => [f.name, 'reading…'])) }));

    for (const file of accepted) {
      try {
        setUploading(prev => ({ ...prev, [file.name]: 'uploading…' }));

        // Read the text and prepare the storage upload at the same time —
        // the text is what the AI uses, the upload is the original file.
        const [extracted, presigned] = await Promise.all([
          extractTextFromFile(file, { maxBytes: MAX_TEXT_BYTES }).catch(() => ({ text: '', truncated: true })),
          presignRoomFile(lobbyCode, {
            name: file.name,
            size: file.size,
            contentType: file.type || 'application/octet-stream',
          }).catch(() => null),
        ]);

        let storageKey: string | undefined;
        let url: string | undefined;
        if (presigned?.storageEnabled && presigned.uploadUrl && presigned.storageKey) {
          setUploading(prev => ({ ...prev, [file.name]: 'uploading…' }));
          const put = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          });
          if (!put.ok) throw new Error('The file could not be stored.');
          storageKey = presigned.storageKey;
          url = presigned.publicUrl ?? undefined;
        }

        await addRoomFile(lobbyCode, {
          name: file.name,
          type: detectType(file.name),
          size: file.size,
          text: extracted.text,
          storageKey,
          url,
        });

        await refresh(lobbyCode);
        addToast(
          extracted.text?.trim()
            ? `${file.name} shared with the group.`
            : `${file.name} shared — no text could be read from it.`,
          extracted.text?.trim() ? 'success' : 'info',
        );
      } catch (err: any) {
        addToast(err?.message || `Could not share ${file.name}.`, 'error');
      } finally {
        setUploading(prev => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
      }
    }
  }, [lobbyCode, addToast, refresh]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) void upload(files);
  };

  const remove = async (file: RoomFileInfo) => {
    if (!lobbyCode) return;
    try {
      await removeRoomFile(lobbyCode, file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
      setSelected(prev => prev.filter(id => id !== file.id));
      addToast(`${file.name} removed from the lobby.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not remove that file.', 'error');
    }
  };

  const selectedFiles = useMemo(
    () => files.filter(f => selected.includes(f.id)),
    [files, selected],
  );

  const toggle = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  if (!lobbyCode) return null;

  const readableCount = files.filter(f => f.hasText).length;

  return (
    <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
          📚 {title}
          {files.length > 0 && (
            <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8125rem', marginLeft: '0.4rem' }}>
              ({files.length})
            </span>
          )}
        </h3>
        <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
          + Add file
        </button>
      </div>

      <p className="text-xs text-muted" style={{ margin: '0.5rem 0 0.75rem' }}>
        {hint ?? 'Drop in the material your group is studying — everyone here can read it, quiz each other on it, or hand it to the AI tutor.'}
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={e => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) void upload(files);
        }}
      />

      {/* Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          background: dragging ? 'var(--accent-soft)' : 'var(--surface-1)',
          borderRadius: 'var(--radius)',
          padding: '1rem',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
      >
        <p className="text-sm" style={{ margin: 0, fontWeight: 600 }}>
          {dragging ? 'Drop to share with the group' : 'Drop a file here, or click to browse'}
        </p>
        <p className="text-xs text-muted" style={{ margin: '0.25rem 0 0' }}>
          PDF, DOCX, PPTX, images, text — up to 40 MB each
        </p>
      </div>

      {/* Uploads in flight */}
      {Object.keys(uploading).length > 0 && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {Object.entries(uploading).map(([name, status]) => (
            <p key={name} className="text-xs text-muted" style={{ margin: 0 }}>
              ⏳ {name} — {status}
            </p>
          ))}
        </div>
      )}

      {/* The shared files */}
      {loading && files.length === 0 ? (
        <p className="text-sm text-muted" style={{ marginTop: '0.75rem' }}>Loading shared files…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted" style={{ marginTop: '0.75rem' }}>
          Nothing shared yet. The first file you add becomes the material for the group's quiz.
        </p>
      ) : (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {files.map(f => (
            <div
              key={f.id}
              style={{
                display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                padding: '0.6rem 0.7rem',
                background: 'var(--surface-1)',
                border: `1px solid ${selected.includes(f.id) ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(f.id)}
                onChange={() => toggle(f.id)}
                title="Use this file for a quiz or a duel"
                style={{ marginTop: '0.2rem' }}
              />
              <span style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>{KIND_ICON[f.type] ?? '📎'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, wordBreak: 'break-word' }}>
                  {f.name}
                </p>
                <p className="text-xs text-muted" style={{ margin: '0.15rem 0 0' }}>
                  {formatBytes(f.size)}
                  {f.uploadedBy.name ? ` · ${f.uploadedBy.name}` : ''}
                  {f.hasText ? ` · ${f.textLength.toLocaleString()} chars of text` : ' · no text (image only)'}
                </p>
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                  {onStudyWithTutor && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onStudyWithTutor(lobbyCode, f)}>
                      🧠 Study with AI
                    </button>
                  )}
                  {f.url && (
                    <a className="btn btn-ghost btn-sm" href={f.url} target="_blank" rel="noreferrer">
                      ⬇ Original
                    </a>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(f)}>
                    🗑 Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Turn the shared material into a game */}
      {!hideGameActions && (onQuizFiles || onDuelFiles) && (
        <div style={{ marginTop: '0.9rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <p className="text-xs text-muted" style={{ margin: '0 0 0.5rem' }}>
            {selectedFiles.length > 0
              ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected`
              : 'Tick the files you want to play with.'}
            {readableCount > 0 && ` ${readableCount} of them can be read by the AI.`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {onQuizFiles && (
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedFiles.length === 0}
                onClick={() => onQuizFiles(lobbyCode, selectedFiles)}
              >
                🏆 Start a quiz battle from these
              </button>
            )}
            {onDuelFiles && (
              <button
                className="btn btn-outline btn-sm"
                disabled={selectedFiles.length === 0}
                onClick={() => onDuelFiles(lobbyCode, selectedFiles)}
              >
                ⚔️ Set a duel from these
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
