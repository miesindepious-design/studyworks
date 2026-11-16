/**
 * DocumentsPanel — the uploaded-document library, shown under Notes → Documents.
 *
 * Students can pick documents (checkboxes), read the tutor's briefing,
 * and turn the selected material into practice questions or flashcards.
 */

import { useCallback, useRef, useState } from 'react';
import type { StudyDocument, Flashcard, PracticeQuestion } from '../types';
import type { UseAIResult } from '../hooks/useAI';
import { extractTextFromFile } from '../utils/extractText';
import DocumentBriefing from './DocumentBriefing';
import KeyPointsPanel from './KeyPointsPanel';

interface Props {
  documents: StudyDocument[];
  setDocuments: (docs: StudyDocument[]) => void;
  ai: UseAIResult;
  practiceQuestions: PracticeQuestion[];
  setPracticeQuestions: (questions: PracticeQuestion[]) => void;
  flashcards: Flashcard[];
  setFlashcards: (cards: Flashcard[]) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  setCurrentView: (view: string) => void;
}

const KIND_ICONS: Record<StudyDocument['kind'], string> = {
  pdf: '📕', docx: '📘', pptx: '📊', image: '🖼️', html: '🌐', text: '📄',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Join selected documents into one text blob for the AI, with light caps. */
function combineTexts(docs: StudyDocument[], maxChars = 60000): { title: string; text: string } {
  const title = docs.length === 1 ? docs[0].name.replace(/\.[^.]+$/, '') : `${docs.length} documents`;
  let text = '';
  for (const d of docs) {
    const chunk = d.text.length > maxChars - text.length
      ? d.text.slice(0, Math.max(0, maxChars - text.length))
      : d.text;
    text += `\n\n--- ${d.name} ---\n${chunk}`;
    if (text.length >= maxChars) break;
  }
  return { title, text: text.trim() };
}

export default function DocumentsPanel({
  documents, setDocuments, ai,
  practiceQuestions, setPracticeQuestions,
  flashcards, setFlashcards,
  addToast, setCurrentView,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readingId, setReadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'analyze' | 'questions' | 'flashcards' | 'upload'>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const requireAI = useCallback(() => {
    if (!ai.isReady) {
      addToast('Connect your free Google AI Studio key in Settings to use AI on documents.', 'info');
      setCurrentView('settings');
      return false;
    }
    return true;
  }, [ai.isReady, addToast, setCurrentView]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedDocs = documents.filter(d => selected.has(d.id));
  const allSelected = documents.length > 0 && selectedDocs.length === documents.length;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy('upload');
    const saved: StudyDocument[] = [];
    for (const file of files) {
      try {
        const res = await extractTextFromFile(file);
        if (!res.text.trim()) throw new Error('No readable text in this file.');
        saved.push({
          id: crypto.randomUUID(),
          name: file.name,
          kind: res.kind || 'text',
          size: file.size,
          text: res.text,
          pages: res.pageCount,
          truncated: res.truncated,
          analysis: null,
          source: 'library',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (err: any) {
        addToast(`Could not read ${file.name}: ${err?.message || 'unknown error'}`, 'error');
      }
    }
    setBusy(null);
    if (saved.length === 0) return;
    setDocuments([...saved, ...documents]);
    addToast(`${saved.length} document${saved.length === 1 ? '' : 's'} added to your library.`, 'success');
  };

  const handleAnalyze = async () => {
    if (!requireAI()) return;
    const docs = selectedDocs.filter(d => d.text.trim().length > 0);
    if (docs.length === 0) { addToast('Select at least one document with readable text.', 'info'); return; }
    setBusy('analyze');
    try {
      const analysis = await ai.analyzeDocuments(docs.map(d => ({ name: d.name, text: d.text })));
      const now = new Date();
      // The briefing covers the whole selection — stamp it on the first doc
      // so the reader has something to show, and note it on the rest.
      const target = docs[0].id;
      setDocuments(documents.map(d => {
        if (d.id === target) return { ...d, analysis, updatedAt: now };
        if (docs.some(x => x.id === d.id)) return { ...d, updatedAt: now };
        return d;
      }));
      setReadingId(target);
      addToast(`Analyzed ${docs.length} document${docs.length === 1 ? '' : 's'} — ${analysis.keyPoints.length} key point${analysis.keyPoints.length === 1 ? '' : 's'} found.`, 'success');
    } catch (err: any) {
      addToast(`Analysis failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleQuestions = async () => {
    if (!requireAI()) return;
    const docs = selectedDocs.filter(d => d.text.trim().length > 0);
    if (docs.length === 0) { addToast('Select at least one document with readable text.', 'info'); return; }
    setBusy('questions');
    try {
      const { title, text } = combineTexts(docs);
      const generated = await ai.generatePracticeQuestions(title, text, 6);
      const stamp = Date.now();
      const newQs: PracticeQuestion[] = generated.map((g, i) => ({
        id: `doc-pq-${stamp}-${i}`,
        question: g.question,
        answer: g.answer,
        type: g.type,
        options: g.options,
        noteId: undefined,
        createdAt: new Date(),
      }));
      setPracticeQuestions([...newQs, ...practiceQuestions]);
      addToast(`${newQs.length} practice question${newQs.length === 1 ? '' : 's'} added — find them in Flashcards → Practice.`, 'success');
    } catch (err: any) {
      addToast(`Question generation failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleFlashcards = async () => {
    if (!requireAI()) return;
    const docs = selectedDocs.filter(d => d.text.trim().length > 0);
    if (docs.length === 0) { addToast('Select at least one document with readable text.', 'info'); return; }
    setBusy('flashcards');
    try {
      const { title, text } = combineTexts(docs);
      const generated = await ai.generateFlashcards(title, text, 12);
      const stamp = Date.now();
      const newCards: Flashcard[] = generated.map((g, i) => ({
        id: `doc-fc-${stamp}-${i}`,
        question: g.question,
        answer: g.answer,
        tags: ['from-document'],
        difficulty: g.difficulty ?? 'medium',
        type: g.type ?? 'standard',
        createdAt: new Date(),
      }));
      setFlashcards([...newCards, ...flashcards]);
      addToast(`${newCards.length} flashcard${newCards.length === 1 ? '' : 's'} added — review them in Flashcards.`, 'success');
    } catch (err: any) {
      addToast(`Flashcard generation failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (doc: StudyDocument) => {
    setDeletingId(doc.id);
    // Small window so a misclick isn't destructive; second click confirms.
    window.setTimeout(() => setDeletingId(cur => (cur === doc.id ? null : cur)), 3000);
  };

  const confirmDelete = (doc: StudyDocument) => {
    setDeletingId(null);
    setDocuments(documents.filter(d => d.id !== doc.id));
    setSelected(prev => { const n = new Set(prev); n.delete(doc.id); return n; });
    if (readingId === doc.id) setReadingId(null);
    addToast(`Deleted ${doc.name}.`, 'success');
  };

  const reading = documents.find(d => d.id === readingId) || null;

  return (
    <div className="sw-docs">
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.txt,.md,.html,image/*"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />

      {/* Toolbar */}
      <div className="sw-docs-toolbar">
        <label className="sw-docs-check-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(documents.map(d => d.id)))}
          />
          {selectedDocs.length > 0 ? `${selectedDocs.length} selected` : 'Select all'}
        </label>
        <button className="btn btn-secondary" disabled={busy !== null || selectedDocs.length === 0} onClick={handleAnalyze}>
          {busy === 'analyze' ? '⏳ Analyzing…' : '🧠 Analyze'}
        </button>
        <button className="btn btn-secondary" disabled={busy !== null || selectedDocs.length === 0} onClick={handleQuestions}>
          {busy === 'questions' ? '⏳ Writing…' : '❓ Generate Questions'}
        </button>
        <button className="btn btn-secondary" disabled={busy !== null || selectedDocs.length === 0} onClick={handleFlashcards}>
          {busy === 'flashcards' ? '⏳ Writing…' : '🃏 Generate Flashcards'}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => uploadRef.current?.click()}>
          {busy === 'upload' ? '⏳ Reading…' : '⬆️ Upload'}
        </button>
      </div>

      {documents.length === 0 && (
        <div className="sw-docs-empty">
          <p style={{ fontSize: '2rem', margin: 0 }}>📄</p>
          <h3>No documents yet</h3>
          <p className="text-sm text-muted">
            Upload a PDF, DOCX, PPTX or image — or upload from the AI Tutor — and it will appear here.
            Select documents to analyze them or turn them into practice questions and flashcards.
          </p>
          <button className="btn btn-primary" onClick={() => uploadRef.current?.click()}>⬆️ Upload a document</button>
        </div>
      )}

      <div className="sw-docs-layout">
        {/* Document list */}
        {documents.length > 0 && (
          <ul className="sw-docs-list">
            {documents.map(doc => (
              <li
                key={doc.id}
                className={`sw-docs-item${selected.has(doc.id) ? ' is-selected' : ''}${readingId === doc.id ? ' is-reading' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={() => toggle(doc.id)}
                  aria-label={`Select ${doc.name}`}
                />
                <button className="sw-docs-open" onClick={() => setReadingId(readingId === doc.id ? null : doc.id)}>
                  <span aria-hidden="true">{KIND_ICONS[doc.kind]}</span>
                  <span className="sw-docs-name" title={doc.name}>{doc.name}</span>
                  <span className="sw-docs-meta">
                    {formatSize(doc.size)}{doc.pages ? ` · ${doc.pages}p` : ''}{doc.truncated ? ' · truncated' : ''}
                  </span>
                  {doc.analysis && <span className="tag success">✓ Analyzed</span>}
                  {doc.source === 'tutor' && <span className="tag" title="Uploaded via AI Tutor">tutor</span>}
                </button>
                {deletingId === doc.id ? (
                  <button className="btn btn-sm btn-danger" onClick={() => confirmDelete(doc)}>Confirm delete</button>
                ) : (
                  <button
                    className="btn btn-sm btn-secondary"
                    title="Remove from library"
                    onClick={() => handleDelete(doc)}
                  >🗑️</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Reader */}
        {reading && (
          <div className="sw-docs-reader">
            <div className="sw-docs-reader-head">
              <h3>{KIND_ICONS[reading.kind]} {reading.name}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setReadingId(null)}>✕ Close</button>
            </div>
            {reading.analysis ? (
              <>
                <DocumentBriefing analysis={reading.analysis} />
                {reading.analysis.keyPoints.length > 0 && (
                  <KeyPointsPanel points={reading.analysis.keyPoints} />
                )}
              </>
            ) : (
              <div className="sw-docs-raw">
                <p className="text-sm text-muted">
                  No AI briefing yet — select it above and hit <strong>🧠 Analyze</strong> to extract
                  the key points, outline, glossary and exam questions.
                </p>
                <pre className="sw-docs-raw-text">{reading.text.slice(0, 6000)}{reading.text.length > 6000 ? '\n\n… (truncated preview)' : ''}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
