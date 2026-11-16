/**
 * TutorDocuments — the upload panel for the AI Tutor.
 *
 * The student drops a file (or browses for one), the browser extracts the
 * text locally — PDF, DOCX, PPTX, images via OCR, HTML, plain text — and the
 * text is then sent to the tutor for analysis. Nothing is uploaded to a
 * third-party storage bucket; the file itself never leaves the browser.
 */

import { useRef, useState } from 'react';

export interface AttachedDoc {
  id: string;
  name: string;
  size: number;
  /** Extracted text — empty while the file is still being read. */
  text: string;
  pages?: number;
  truncated: boolean;
  status: 'reading' | 'ready' | 'error';
  error?: string;
  /** Which parser read it: pdf | docx | pptx | image | html | text. */
  kind?: string;
}

interface Props {
  docs: AttachedDoc[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  /** True when AI features are unavailable — the panel explains why. */
  disabled?: boolean;
  disabledReason?: string;
}

const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.json,.html,.htm,image/*';

const KIND_ICON: Record<string, string> = {
  pdf: '📕', docx: '📘', pptx: '📙', image: '🖼️', html: '🌐', text: '📄',
};

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TutorDocuments({
  docs, onFiles, onRemove, onAnalyze, analyzing, disabled, disabledReason,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const readyDocs = docs.filter(d => d.status === 'ready' && d.text.trim().length > 0);
  const reading = docs.some(d => d.status === 'reading');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  };

  return (
    <div className="sw-tutor-docs">
      <div
        className={`sw-tutor-drop ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => { if (!disabled) inputRef.current?.click(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        aria-label="Upload documents for the AI Tutor"
      >
        <span className="sw-tutor-drop-icon" aria-hidden="true">📎</span>
        <span className="sw-tutor-drop-title">
          {disabled ? 'Connect your AI key to upload documents' : 'Drop a file here, or click to browse'}
        </span>
        <span className="sw-tutor-drop-hint">
          {disabled
            ? (disabledReason || 'AI features need a Pro subscription or your own Google AI Studio key.')
            : 'PDF · DOCX · PPTX · images (OCR) · text — up to 10 files'}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sw-tutor-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {docs.length > 0 && (
        <div className="sw-tutor-doclist">
          {docs.map(doc => (
            <div key={doc.id} className={`sw-tutor-doc ${doc.status === 'error' ? 'is-error' : ''}`}>
              <span className="sw-tutor-doc-icon" aria-hidden="true">
                {doc.status === 'reading' ? '⏳' : (KIND_ICON[doc.kind || 'text'] || '📄')}
              </span>
              <span className="sw-tutor-doc-body">
                <span className="sw-tutor-doc-name" title={doc.name}>{doc.name}</span>
                <span className="sw-tutor-doc-meta">
                  {doc.status === 'reading' && 'Reading…'}
                  {doc.status === 'error' && (doc.error || 'Could not read this file')}
                  {doc.status === 'ready' && (
                    <>
                      {formatBytes(doc.size)}
                      {doc.pages ? ` · ${doc.pages} block${doc.pages === 1 ? '' : 's'}` : ''}
                      {doc.truncated ? ' · truncated' : ''}
                    </>
                  )}
                </span>
              </span>
              <button
                type="button"
                className="sw-tutor-doc-remove"
                onClick={() => onRemove(doc.id)}
                title={`Remove ${doc.name}`}
                aria-label={`Remove ${doc.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <button
          type="button"
          className="btn btn-primary btn-sm sw-tutor-analyze"
          onClick={onAnalyze}
          disabled={analyzing || reading || readyDocs.length === 0 || disabled}
          title={
            readyDocs.length === 0
              ? 'Waiting for the file to be read'
              : 'Let the tutor read the document and pull out what you must know'
          }
        >
          {analyzing ? 'Analyzing…' : `🔍 Analyze ${readyDocs.length} document${readyDocs.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
