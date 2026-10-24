import { useState, useMemo, useEffect, useRef } from 'react';
import { Note, Flashcard, Folder, PracticeQuestion, SavedSearch, Highlight, PersonalNote } from '../types';
import type { UseAIResult } from '../hooks/useAI';
import { renderLinkedContent } from '../utils/noteLinker';
import { matchesSmartFilter, previewSmartFilter } from '../utils/smartFolders';
import { exportNotesToPDF } from '../utils/exportPDF';
import { toPlainText } from '../utils/text';
import { extractTextFromFile } from '../utils/extractText';
import { NOTE_TEMPLATES } from '../lib/studentTemplates';
import { uploadFile, deleteRemoteAttachment } from '../api/attachments';
import { unfurlUrl } from '../api/phase2';
import { findRelated, findBacklinks } from '../utils/backlinks';
import { useDebounce } from '../hooks/useDebounce';
import RichTextEditor from './RichTextEditor';
import ConfirmModal from './ConfirmModal';

type Tier = 'free' | 'pro';
type SortBy = 'newest' | 'oldest' | 'title';
type FilterType = 'all' | 'note' | 'article' | 'idea' | 'project';

interface NotesViewProps {
  notes: Note[];
  setNotes: (notes: Note[]) => void;
  flashcards: Flashcard[];
  setFlashcards: (flashcards: Flashcard[]) => void;
  tier: Tier;
  setCurrentView: (view: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  totalItems: number;
  incrementAiSummaries: () => void;
  aiSummariesThisMonth: number;
  folders: Folder[];
  setFolders: (folders: Folder[]) => void;
  practiceQuestions: PracticeQuestion[];
  setPracticeQuestions: (questions: PracticeQuestion[]) => void;
  incrementQaQueries: () => void;
  qaQueriesThisMonth: number;
  savedSearches: SavedSearch[];
  setSavedSearches: (searches: SavedSearch[]) => void;
  ai: UseAIResult;
  loadStarterPack: () => void;
}

// helper: read current flashcards from the prop before append
// (NotesView gets flashcards so it can append, not replace)

const HIGHLIGHT_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'];

function typeTagClass(type: Note['type']): string {
  switch (type) {
    case 'note':    return 'primary';
    case 'article': return 'success';
    case 'idea':    return 'accent';
    case 'project': return 'danger';
    default:        return '';
  }
}

export default function NotesView({
  notes, setNotes, flashcards, setFlashcards, tier, setCurrentView, addToast,
  totalItems, incrementAiSummaries, aiSummariesThisMonth,
  folders, setFolders, practiceQuestions, setPracticeQuestions,
  incrementQaQueries, qaQueriesThisMonth,
  savedSearches, setSavedSearches, ai, loadStarterPack,
}: NotesViewProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'note' | 'article' | 'idea' | 'project'>('note');
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('default');
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [savedSearchName, setSavedSearchName] = useState('');
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderSmart, setNewFolderSmart] = useState(false);
  const [newFolderFilter, setNewFolderFilter] = useState('');

  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [qaQuery, setQaQuery] = useState('');
  const [qaAnswer, setQaAnswer] = useState<string | null>(null);
  const [showQa, setShowQa] = useState(false);

  // Save from URL (Phase 2)
  const [showUrlSave, setShowUrlSave] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);

  // Browser-extension / deep-link save: App stashes ?save=<url> in
  // sessionStorage; pick it up, open the panel, and prefill.
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem('studyworks:pendingSaveUrl'); } catch {}
    if (pending) {
      try { sessionStorage.removeItem('studyworks:pendingSaveUrl'); } catch {}
      setUrlInput(pending);
      setShowUrlSave(true);
    }
  }, []);

  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [personalNoteInput, setPersonalNoteInput] = useState('');
  const [editingPersonalNote, setEditingPersonalNote] = useState<PersonalNote | null>(null);

  const [bulkMode, setBulkMode]         = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // Pending delete confirmation
  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'bulk'; id?: string } | null>(null);

  // After uploading a PDF, we extract its text and offer to feed it
  // directly to the flashcard generator. The user can decline and the
  // text just gets dropped.
  const [pendingPdfText, setPendingPdfText] = useState<{ noteId: string; fileName: string; text: string; truncated: boolean } | null>(null);

  // Note revisit reminder
  const [reminderNoteId, setReminderNoteId] = useState<string | null>(null);
  const [reminderDate, setReminderDate]     = useState('');

  const updateNote = (noteId: string, patch: Partial<Note>) =>
    setNotes(notes.map(n => n.id === noteId ? { ...n, ...patch, updatedAt: new Date() } : n));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim().replace(/<[^>]*>/g, '').trim()) {
      addToast('Please add some content to your note.', 'info');
      return;
    }
    if (editingNote) {
      setNotes(notes.map(n => n.id === editingNote.id ? { ...n, title, content, type, tags: tags.split(',').map(t => t.trim()).filter(Boolean), folderId: selectedFolder, updatedAt: new Date() } : n));
      setEditingNote(null); setFormOpen(false);
      addToast('Note updated!', 'success');
    } else {
      if (tier === 'free' && totalItems >= 50) { addToast("50 item limit reached. Upgrade to Pro.", 'info'); setCurrentView('pricing'); return; }
      setNotes([{ id: Date.now().toString(), title, content, type, tags: tags.split(',').map(t => t.trim()).filter(Boolean), folderId: selectedFolder, createdAt: new Date(), updatedAt: new Date(), files: [], highlights: [], personalNotes: [] }, ...notes]);
      addToast('Note added!', 'success'); setFormOpen(false);
    }
    setTitle(''); setContent(''); setTags('');
  };

  const startEdit = (note: Note) => { setEditingNote(note); setTitle(note.title); setContent(note.content); setType(note.type); setTags(note.tags.join(', ')); setSelectedFolder(note.folderId || 'default'); setFormOpen(true); };

  // Save from URL (Phase 2): unfurl the URL server-side, then create a note
  // pre-filled with the page's title, description, and a link back to source.
  const handleSaveUrl = async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    if (tier === 'free' && totalItems >= 50) { addToast('50 item limit reached. Upgrade to Pro.', 'info'); setCurrentView('pricing'); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setUrlLoading(true);
    try {
      const meta = await unfurlUrl(url);
      const typeMap: Record<string, Note['type']> = { youtube: 'article', twitter: 'article', article: 'article', file: 'note' };
      const noteType = typeMap[meta.kind] ?? 'article';
      const parts: string[] = [];
      if (meta.image) parts.push(`<p><img src="${meta.image}" alt="" style="max-width:100%;border-radius:8px" /></p>`);
      if (meta.description) parts.push(`<p>${meta.description}</p>`);
      parts.push(`<p><a href="${meta.url}" target="_blank" rel="noopener noreferrer">${meta.siteName || meta.url}</a></p>`);
      setNotes([{
        id: Date.now().toString(),
        title: meta.title || url,
        content: parts.join(''),
        type: noteType,
        tags: ['clipped', ...(meta.siteName ? [meta.siteName.toLowerCase().replace(/\s+/g, '-')] : [])],
        folderId: selectedFolder,
        createdAt: new Date(), updatedAt: new Date(),
        files: [], highlights: [], personalNotes: [],
      }, ...notes]);
      addToast(`Saved "${meta.title || url}"`, 'success');
      setUrlInput(''); setShowUrlSave(false);
    } catch (err: any) {
      addToast(err?.message || 'Could not fetch that URL.', 'error');
    } finally {
      setUrlLoading(false);
    }
  };
  const cancelEdit = () => { setEditingNote(null); setTitle(''); setContent(''); setTags(''); setFormOpen(false); };
  const deleteNote = (id: string) => { setPendingDelete({ type: 'note', id }); };

  const bulkDelete = () => {
    if (bulkSelected.size === 0) return;
    setPendingDelete({ type: 'bulk' });
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'note' && pendingDelete.id) {
      setNotes(notes.filter(n => n.id !== pendingDelete.id));
      if (expandedNoteId === pendingDelete.id) setExpandedNoteId(null);
      addToast('Note deleted.', 'success');
    } else if (pendingDelete.type === 'bulk') {
      setNotes(notes.filter(n => !bulkSelected.has(n.id)));
      setBulkSelected(new Set()); setBulkMode(false);
      addToast(`Deleted ${bulkSelected.size} note${bulkSelected.size > 1 ? 's' : ''}.`, 'success');
    }
    setPendingDelete(null);
  };
  const toggleBulkSelect = (id: string) => setBulkSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const saveReminder = (noteId: string) => {
    if (!reminderDate) return;
    updateNote(noteId, { nextReminder: new Date(reminderDate) });
    setReminderNoteId(null); setReminderDate('');
    addToast('Reminder set!', 'success');
  };
  const clearReminder = (noteId: string) => {
    updateNote(noteId, { nextReminder: undefined });
    addToast('Reminder cleared.', 'info');
  };

  const handleFileUpload = async (noteId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (tier !== 'pro') { addToast('File uploads are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    if (!['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/wav','audio/ogg'].includes(file.type)) { addToast('Only PDF, PPTX, image, and audio files are supported.', 'error'); return; }
    if (file.size > 50 * 1024 * 1024) { addToast('File must be under 50MB.', 'error'); return; }
    const note = notes.find(n => n.id === noteId); if (!note) return;
    try {
      const { attachment, storageMode } = await uploadFile({ file, noteId });
      updateNote(noteId, { files: [...(note.files || []), attachment] });
      addToast(
        storageMode === 'cloud'
          ? `☁️ ${file.name} uploaded to cloud storage.`
          : `${file.name} attached (local storage).`,
        'success'
      );

      // If the upload is a PDF or PPTX, kick off text extraction in the background.
      // We don't await — the upload is already done and we don't want to
      // block the UI while pdfjs parses a 50-page document (or jszip unzips
      // a deck). When the extraction finishes, surface a confirm modal asking
      // the user if they want to generate flashcards from it.
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ||
          file.name.toLowerCase().endsWith('.pptx')) {
        extractTextFromFile(file)
          .then(result => {
            if (!result.text.trim()) {
              addToast('No extractable text found (image-only slides?). Add a summary manually.', 'info');
              return;
            }
            // If AI isn't configured, skip the offer — they can still get the
            // note+file but can't generate cards without a key.
            if (!ai.isReady) {
              addToast(`📄 Extracted ${result.pageCount ?? '?'} pages of text. Configure AI in Settings to generate flashcards.`, 'info');
              return;
            }
            setPendingPdfText({ noteId, fileName: file.name, text: result.text, truncated: result.truncated });
          })
          .catch(err => addToast(`PDF text extraction failed: ${err.message}`, 'error'));
      }
    } catch (err: any) {
      addToast(`Upload failed: ${err.message}`, 'error');
    }
  };

  // Global "Import" button: pick a PDF/PPTX without opening a note first.
  // Auto-creates a note (titled after the file), attaches the upload, then
  // extracts text and surfaces the same "Generate flashcards?" modal as the
  // in-note attach flow — so one click goes file → cards offer.
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (tier !== 'pro') { addToast('File imports are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/wav','audio/ogg'].includes(file.type)) {
      addToast('Only PDF, PPTX, image, and audio files are supported.', 'error'); return;
    }
    if (file.size > 50 * 1024 * 1024) { addToast('File must be under 50MB.', 'error'); return; }

    const noteId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newNote: Note = {
      id: noteId,
      title: file.name.replace(/\.[^.]+$/, ''),
      content: '',
      type: 'note',
      tags: ['imported'],
      folderId: selectedFolder,
      createdAt: new Date(), updatedAt: new Date(),
      files: [], highlights: [], personalNotes: [],
    };
    setNotes([newNote, ...notes]);
    addToast(`Importing ${file.name}…`, 'info');

    try {
      const { attachment } = await uploadFile({ file, noteId });
      updateNote(noteId, { files: [attachment] });

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ||
          file.name.toLowerCase().endsWith('.pptx')) {
        extractTextFromFile(file)
          .then(result => {
            if (!result.text.trim()) {
              addToast('No extractable text found (image-only slides?). Add a summary manually.', 'info');
              return;
            }
            if (!ai.isReady) {
              addToast(`📄 Extracted text from ${file.name}. Configure AI in Settings to generate flashcards.`, 'info');
              return;
            }
            setPendingPdfText({ noteId, fileName: file.name, text: result.text, truncated: result.truncated });
          })
          .catch(err => addToast(`Text extraction failed: ${err.message}`, 'error'));
      }
    } catch (err: any) {
      addToast(`Import failed: ${err.message}`, 'error');
    }
  };

  const deleteAttachment = async (noteId: string, fileId: string) => {
    const note = notes.find(n => n.id === noteId); if (!note) return;
    const att  = (note.files || []).find(f => f.id === fileId);
    // Cloud-stored attachments have a server-side id (cuid); local ones use
    // a client-generated UUID. Only call the server for cloud ids.
    if (att && att.id && /^[a-z0-9]{20,}$/i.test(att.id)) {
      try { await deleteRemoteAttachment(att.id); }
      catch (err) { console.warn('[attachments] remote delete failed (continuing):', err); }
    }
    updateNote(noteId, { files: (note.files || []).filter(f => f.id !== fileId) });
  };

  const addHighlight = (noteId: string) => {
    const sel = window.getSelection(); if (!sel || sel.isCollapsed) { addToast('Select some text first.', 'info'); return; }
    const text = sel.toString().trim(); if (!text) return;
    if (tier === 'free') { const note = notes.find(n => n.id === noteId); if ((note?.highlights?.length || 0) >= 3) { addToast('Free plan: 3 highlights max. Upgrade to Pro.', 'info'); setCurrentView('pricing'); return; } }
    const note = notes.find(n => n.id === noteId); if (!note) return;
    updateNote(noteId, { highlights: [...(note.highlights || []), { id: Date.now().toString(), text, color: highlightColor, createdAt: new Date() } as Highlight] });
    sel.removeAllRanges(); addToast('Highlight saved!', 'success');
  };
  const deleteHighlight = (noteId: string, hId: string) => { const note = notes.find(n => n.id === noteId); if (!note) return; updateNote(noteId, { highlights: (note.highlights || []).filter(h => h.id !== hId) }); };

  const savePersonalNote = (noteId: string) => {
    if (!personalNoteInput.trim()) return;
    const parent = notes.find(n => n.id === noteId); if (!parent) return;
    if (tier === 'free' && !editingPersonalNote) {
      if ((parent.personalNotes || []).length >= 1) { addToast('Free plan: 1 personal note max.', 'info'); setCurrentView('pricing'); return; }
      if (personalNoteInput.length > 200) { addToast('Free plan: 200 chars max.', 'info'); return; }
    }
    if (editingPersonalNote) {
      updateNote(noteId, { personalNotes: (parent.personalNotes || []).map(pn => pn.id === editingPersonalNote.id ? { ...pn, content: personalNoteInput, updatedAt: new Date() } : pn) });
      setEditingPersonalNote(null); addToast('Personal note updated!', 'success');
    } else {
      updateNote(noteId, { personalNotes: [...(parent.personalNotes || []), { id: Date.now().toString(), content: personalNoteInput, createdAt: new Date(), updatedAt: new Date() } as PersonalNote] });
      addToast('Personal note saved!', 'success');
    }
    setPersonalNoteInput('');
  };
  const deletePersonalNote = (noteId: string, pnId: string) => { const note = notes.find(n => n.id === noteId); if (!note) return; updateNote(noteId, { personalNotes: (note.personalNotes || []).filter(pn => pn.id !== pnId) }); };

  const saveSearch = () => {
    if (tier !== 'pro') { addToast('Saved searches are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (!search.trim() || !savedSearchName.trim()) { addToast('Enter both a query and a name.', 'info'); return; }
    setSavedSearches([...savedSearches, { id: Date.now().toString(), name: savedSearchName.trim(), query: search.trim(), createdAt: new Date() }]);
    setSavedSearchName(''); addToast('Search saved!', 'success');
  };

  const addFolder = () => {
    if (tier !== 'pro') { addToast('Folders are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (newFolderName.trim()) {
      setFolders([...folders, {
        id: Date.now().toString(),
        name: newFolderName.trim(),
        createdAt: new Date(),
        isSmart: newFolderSmart,
        smartFilter: newFolderSmart ? newFolderFilter.trim() : undefined,
      }]);
      setNewFolderName(''); setNewFolderFilter(''); setNewFolderSmart(false);
      addToast(`${newFolderSmart ? 'Smart folder' : 'Folder'} added!`, 'success');
    }
  };

  const generateSummary = async (note: Note) => {
    // Gate: free tier monthly limit still applies even with real AI
    if (tier !== 'pro' && aiSummariesThisMonth >= 20) {
      addToast('20 AI summary limit reached. Upgrade to Pro.', 'info');
      setCurrentView('pricing'); return;
    }
    if (!ai.isReady) {
      addToast('Configure your OpenAI API key in Settings to use real AI summaries.', 'info');
      setCurrentView('settings'); return;
    }
    setIsGenerating(note.id);
    try {
      const summary = await ai.generateSummary(note.title, note.content);
      updateNote(note.id, { summary });
      if (tier === 'free') incrementAiSummaries();
      addToast('AI Summary generated!', 'success');
    } catch (err: any) {
      addToast(`Summary failed: ${err.message}`, 'error');
    } finally {
      setIsGenerating(null);
    }
  };

  // Generates flashcards from a note. If `sourceText` is provided (e.g.
  // extracted from an uploaded PDF), use that instead of the note's own
  // content. This lets us generate from a PDF even when the note body is
  // empty or just a title.
  const generateFlashcards = async (note: Note, sourceText?: string) => {
    if (tier !== 'pro') { addToast('AI Flashcards is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (!ai.isReady) { addToast('Configure your OpenAI API key in Settings first.', 'info'); setCurrentView('settings'); return; }
    setIsGenerating(note.id);
    try {
      const text = sourceText ?? note.content;
      // Generate high-volume exam-style flashcards when possible.
      const len = toPlainText(text).length;
      const est = Math.min(60, Math.max(15, Math.round(len / 180)));
      const generated = await ai.generateFlashcards(note.title, text, est);
      const newCards: Flashcard[] = generated.map((g, i) => ({
        id: `${note.id}-fc-${Date.now()}-${i}`,
        question: g.question,
        answer:   g.answer,
        tags:     [...note.tags, 'ai-generated'],
        difficulty: g.difficulty ?? 'medium',
        type:       g.type ?? 'standard',
        createdAt:  new Date(),
        folderId:   note.folderId,
      }));
      // Append to existing flashcards — don't replace the whole deck
      setFlashcards([...flashcards, ...newCards]);
      addToast(`${newCards.length} flashcards added!`, 'success');
    } catch (err: any) {
      addToast(`Flashcard generation failed: ${err.message}`, 'error');
    } finally {
      setIsGenerating(null);
    }
  };

  const generatePracticeQuestions = async (note: Note) => {
    if (tier !== 'pro') { addToast('Practice questions are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (!ai.isReady) { addToast('Configure your OpenAI API key in Settings first.', 'info'); setCurrentView('settings'); return; }
    setIsGenerating(note.id);
    try {
      const generated = await ai.generatePracticeQuestions(note.title, note.content, 4);
      const newQs: PracticeQuestion[] = generated.map((g, i) => ({
        id:       `${note.id}-pq-${Date.now()}-${i}`,
        question: g.question,
        answer:   g.answer,
        type:     g.type,
        options:  g.options,
        noteId:   note.id,
        createdAt: new Date(),
      }));
      setPracticeQuestions([...practiceQuestions, ...newQs]);
      addToast(`${newQs.length} practice questions added!`, 'success');
    } catch (err: any) {
      addToast(`Practice question generation failed: ${err.message}`, 'error');
    } finally {
      setIsGenerating(null);
    }
  };

  const handleQa = async () => {
    if (!qaQuery.trim()) return;
    if (tier !== 'pro' && qaQueriesThisMonth >= 100) {
      addToast('100 Q&A query limit reached. Upgrade to Pro.', 'info');
      setCurrentView('pricing'); return;
    }
    if (!ai.isReady) {
      addToast('Configure your OpenAI API key in Settings to use Smart Q&A.', 'info');
      setCurrentView('settings'); return;
    }
    setIsGenerating('qa');
    try {
      const answer = await ai.smartQA(qaQuery, notes);
      setQaAnswer(answer);
      if (tier === 'free') incrementQaQueries();
      addToast('Answer generated!', 'success');
    } catch (err: any) {
      addToast(`Q&A failed: ${err.message}`, 'error');
    } finally {
      setIsGenerating(null);
    }
  };

  // ── Semantic search (AI-powered when configured, keyword fallback otherwise) ──
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Note[] | null>(null);

  const runSemanticSearch = async () => {
    if (!search.trim() || !ai.isReady) return;
    setIsSemanticSearching(true);
    try {
      const results = await ai.semanticSearch(search, notes);
      setSemanticResults(results);
      addToast(`Semantic search: ${results.length} results ranked by relevance.`, 'success');
    } catch (err: any) {
      addToast(`Semantic search failed: ${err.message}`, 'error');
    } finally {
      setIsSemanticSearching(false);
    }
  };

  const activeFolder = folders.find(f => f.id === selectedFolder);

  // Strip HTML from content for search index.
  //   - `debouncedSearch` lags the input by 200ms so we don't re-run
  //     `toPlainText` on every keystroke.
  //   - `plainTextById` caches the html-stripped body per note id so the
  //     search filter doesn't redo the same work for every keystroke.
  // Earlier versions re-stripped HTML for every note on every keystroke;
  // a 5000-note library would stall the main thread on every character.
  const debouncedSearch = useDebounce(search, 200);
  const plainTextById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) map.set(n.id, toPlainText(n.content));
    return map;
  }, [notes]);

  const filteredNotes = (semanticResults ?? notes
    .filter(n => filterType === 'all' || n.type === filterType)
    .filter(n => {
      if (selectedFolder === 'default') return true;
      if (activeFolder?.isSmart && activeFolder.smartFilter) {
        return matchesSmartFilter(n, activeFolder.smartFilter);
      }
      return n.folderId === selectedFolder;
    })
    .filter(n => {
      const plain = plainTextById.get(n.id) ?? '';
      const q = debouncedSearch.toLowerCase();
      if (!q) return true;
      return n.title.toLowerCase().includes(q) || plain.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q));
    })
    .sort((a, b) => sortBy === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : sortBy === 'oldest' ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : a.title.localeCompare(b.title))
  );

  const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = (text: string) => Math.max(1, Math.round(wordCount(text) / 200));

  // Related: scored by wikilinks + tag Jaccard + same folder.
  // Top 3, excluding the current note.
  const relatedNotes = (note: Note) => tier !== 'pro' ? [] : findRelated(note, notes, 3);
  // Backlinks: notes that explicitly link to this one via [[Title]] syntax.
  const backlinks = (note: Note) => findBacklinks(note, notes);
  const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

  return (
    <div>
      {/* Confirm delete modal */}
      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete.type === 'bulk' ? `Delete ${bulkSelected.size} notes?` : 'Delete note?'}
          description={pendingDelete.type === 'bulk'
            ? `This will permanently delete ${bulkSelected.size} note${bulkSelected.size > 1 ? 's' : ''}. This cannot be undone.`
            : 'This will permanently delete this note and all its highlights, personal notes, and attachments.'}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Auto-generate flashcards from a freshly uploaded PDF */}
      {pendingPdfText && (() => {
        const note = notes.find(n => n.id === pendingPdfText.noteId);
        return (
          <ConfirmModal
            title="Generate flashcards from this PDF?"
            description={`We extracted ${pendingPdfText.text.length.toLocaleString()} characters from "${pendingPdfText.fileName}"${pendingPdfText.truncated ? ' (truncated to 100KB)' : ''}. Generate ~${Math.min(40, Math.max(10, Math.round(pendingPdfText.text.length / 200)))} flashcards from its content?`}
            confirmLabel="Generate"
            cancelLabel="Not now"
            onConfirm={() => {
              if (note) generateFlashcards(note, pendingPdfText.text);
              setPendingPdfText(null);
            }}
            onCancel={() => setPendingPdfText(null)}
          />
        );
      })()}
      <div className="page-header">
        <h2>Notes &amp; Knowledge Base</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {ai.isReady
            ? <span className="tag success" title={`Provider: ${ai.config.provider} · Model: ${ai.config.model}`}>
                🤖 {ai.config.provider === 'gemini' ? 'Gemini' : 'OpenAI'} on
              </span>
            : <span className="tag" title="Configure AI in Settings → ⚙️" style={{ cursor: 'pointer' }} onClick={() => setCurrentView('settings')}>
                🤖 AI off
              </span>
          }
          {tier === 'pro' && savedSearches.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setShowSavedSearches(o => !o)}>🔖 Saved Searches</button>
          )}
          {tier === 'pro' && (
            <button className="btn btn-secondary" onClick={() => setShowQa(o => !o)}>{showQa ? 'Hide Q&A' : '🤖 Ask Your Brain'}</button>
          )}
          {tier === 'pro' && filteredNotes.length > 0 && (
            <button className="btn btn-secondary" title="Export visible notes as PDF" onClick={async () => { try { await exportNotesToPDF(filteredNotes); addToast('📄 PDF downloaded.', 'success'); } catch (err: any) { addToast(`PDF export failed: ${err.message}`, 'error'); } }}>🖨️ PDF</button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowUrlSave(o => !o)}>{showUrlSave ? '✕ Close URL' : '🔗 Save from URL'}</button>
          <button className="btn btn-primary" onClick={() => importInputRef.current?.click()} title="Import a PDF or PPTX and turn it into flashcards">📥 Import</button>
          <input ref={importInputRef} type="file" accept=".pdf,.pptx,image/*,audio/*" onChange={handleImport} style={{ display: 'none' }} />
          <div style={{ position: 'relative' }}>
            <button className="btn btn-primary" onClick={() => { if (!editingNote) setFormOpen(o => !o); }}>
              {formOpen ? '✕ Close' : '+ New Note'}
            </button>
            <button
              className="btn btn-primary"
              style={{ paddingInline: '0.5rem', marginLeft: '0.25rem' }}
              title="New from template"
              onClick={() => setShowTemplateMenu(o => !o)}
            >▾</button>
            {showTemplateMenu && (
              <div className="card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, minWidth: '220px', padding: '0.5rem', boxShadow: 'var(--shadow-lg)' }}>
                <p className="text-xs text-muted" style={{ padding: '0.25rem 0.5rem', fontWeight: 700 }}>New from template</p>
                {NOTE_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', gap: '0.5rem' }}
                    onClick={() => {
                      const note = t.build(selectedFolder);
                      setNotes([note, ...notes]);
                      setShowTemplateMenu(false);
                      addToast(`Created ${t.label} template`, 'success');
                    }}
                  >{t.icon} {t.label}</button>
                ))}
              </div>
            )}
          </div>
      </div>
      </div>

      {tier === 'free' && totalItems >= 40 && (
            <div className="limit-warning">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <p>Approaching your 50 item limit! Upgrade to Pro for unlimited storage.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrentView('pricing')}>Upgrade</button>
        </div>
      )}

      {showSavedSearches && tier === 'pro' && (
        <div className="card animate-in" style={{ marginBottom: '1.25rem' }}>
          <div className="card-header"><span className="card-title">🔖 Saved Searches</span></div>
          {savedSearches.length === 0 ? <p className="text-sm text-muted">No saved searches yet.</p> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {savedSearches.map(ss => (
                <div key={ss.id} className="tag" style={{ padding: '0.2rem 0.5rem 0.2rem 0.75rem' }}>
                  <button onClick={() => { setSearch(ss.query); setShowSavedSearches(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)', fontSize: '0.8125rem' }}>{ss.name}</button>
                  <button onClick={() => setSavedSearches(savedSearches.filter(s => s.id !== ss.id))} className="btn btn-ghost btn-xs" style={{ color: 'var(--danger)' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showQa && tier === 'pro' && (
        <div className="card animate-in" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">🤖 Smart Q&amp;A</span>
            {ai.isReady && <span className="tag success text-xs">{ai.config.model}</span>}
          </div>
          {!ai.isReady && (
            <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span>⚠️</span>
              <p className="text-sm" style={{ flex: 1 }}>Add your OpenAI API key in <strong>Settings</strong> to enable real answers.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => setCurrentView('settings')}>Settings →</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <input type="text" className="input" placeholder="Ask a question about your knowledge base…" value={qaQuery} onChange={e => setQaQuery(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && handleQa()} />
            <button className="btn btn-primary" onClick={handleQa} disabled={isGenerating === 'qa' || !ai.isReady}>{isGenerating === 'qa' ? 'Thinking…' : 'Ask'}</button>
          </div>
          {qaAnswer && <div style={{ background: 'var(--surface-2)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}><p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.7 }}>{qaAnswer}</p></div>}
        </div>
      )}

      {showUrlSave && (
        <div className="card animate-in" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-title">🔗 Save from URL</span></div>
          <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>Paste a link — YouTube, X/Twitter, articles — and we'll clip the title, description, and thumbnail into a new note.</p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input type="url" className="input" placeholder="https://…" value={urlInput} onChange={e => setUrlInput(e.target.value)} style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') handleSaveUrl(); }} disabled={urlLoading} />
            <button className="btn btn-primary" onClick={handleSaveUrl} disabled={urlLoading || !urlInput.trim()}>{urlLoading ? 'Fetching…' : 'Save'}</button>
          </div>
        </div>
      )}

      {(formOpen || editingNote) && (
        <div className="card animate-in" style={{ marginBottom: '1.75rem' }}>
          <div className="card-header">
            <span className="card-title">{editingNote ? '✏️ Edit Note' : '✚ New Note'}</span>
            {tier === 'free' && <span className="tag accent">{totalItems}/50 items</span>}
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <input type="text" className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} required />
              <select className="select" value={type} onChange={e => setType(e.target.value as Note['type'])}>
                <option value="note">Note</option><option value="article">Article</option><option value="idea">Idea</option><option value="project">Project</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <select className="select" value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.isSmart ? '⚡ ' : ''}{f.name}
                  </option>
                ))}
              </select>
              {activeFolder?.isSmart && activeFolder.smartFilter && (
                <p className="text-xs text-muted" style={{ marginTop: '0.25rem', padding: '0 0.25rem' }}>
                  ⚡ Auto-filter: {previewSmartFilter(activeFolder.smartFilter)}
                </p>
              )}
              {tier === 'pro' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input type="text" className="input" placeholder="New folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addFolder}>+ Folder</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      id="smart-folder-toggle"
                      checked={newFolderSmart}
                      onChange={e => setNewFolderSmart(e.target.checked)}
                    />
                    <label htmlFor="smart-folder-toggle" className="text-xs text-muted" style={{ cursor: 'pointer' }}>
                      Smart folder
                    </label>
                  </div>
                  {newFolderSmart && (
                    <div>
                      <input
                        type="text"
                        className="input"
                        placeholder='Filter e.g. "tag:exam" or "type:article,tag:research"'
                        value={newFolderFilter}
                        onChange={e => setNewFolderFilter(e.target.value)}
                      />
                      {newFolderFilter && (
                        <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                          Preview: {previewSmartFilter(newFolderFilter)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Content…"
              minHeight="120px"
            />
            <input type="text" className="input" placeholder="Tags (comma separated)" value={tags} onChange={e => setTags(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={!editingNote && tier === 'free' && totalItems >= 50}>{!editingNote && tier === 'free' && totalItems >= 50 ? 'Upgrade to Add More' : editingNote ? 'Update' : 'Save'}</button>
              {editingNote && <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>
      )}

      <div className="toolbar">
        <input type="text" className="input" placeholder="Search notes, articles, ideas, projects…" value={search} onChange={e => { setSearch(e.target.value); setSemanticResults(null); }} />
        <select className="select" value={filterType} onChange={e => setFilterType(e.target.value as FilterType)} style={{ minWidth: '140px' }}>
          <option value="all">All Types</option><option value="note">Notes</option><option value="article">Articles</option><option value="idea">Ideas</option><option value="project">Projects</option>
        </select>
        <select className="select" value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)} style={{ minWidth: '140px' }}>
          <option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="title">Title A-Z</option>
        </select>
        {ai.isReady && search.trim() && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={runSemanticSearch}
            disabled={isSemanticSearching}
            title="AI-powered semantic re-ranking"
          >
            {isSemanticSearching ? '⏳ Ranking…' : '🧠 Smart Rank'}
          </button>
        )}
        {semanticResults && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSemanticResults(null)} title="Clear AI ranking">
            ✕ Clear rank
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()); }}>
          {bulkMode ? '✕ Cancel' : '☑ Select'}
        </button>
        {bulkMode && bulkSelected.size > 0 && (
          <button className="btn btn-danger btn-sm" onClick={bulkDelete}>🗑️ Delete {bulkSelected.size}</button>
        )}
      </div>

      {tier === 'pro' && search.trim() && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <input type="text" className="input" placeholder="Name this search…" value={savedSearchName} onChange={e => setSavedSearchName(e.target.value)} style={{ maxWidth: '220px' }} />
          <button className="btn btn-secondary btn-sm" onClick={saveSearch}>🔖 Save</button>
        </div>
      )}

      <div className="grid stagger">
        {filteredNotes.map(note => {
          const isExpanded    = expandedNoteId === note.id;
          const isSelected    = bulkSelected.has(note.id);
          const overdueRemind = note.nextReminder && new Date(note.nextReminder) < new Date();
          const showReminderForm = reminderNoteId === note.id;

          return (
            <div
              key={note.id}
              className="card"
              style={{
                border: isSelected ? '2px solid var(--accent)' : overdueRemind ? '2px solid var(--danger)' : undefined,
                background: isSelected ? 'var(--accent-soft)' : undefined,
                cursor: bulkMode ? 'pointer' : undefined,
              }}
              onClick={bulkMode ? () => toggleBulkSelect(note.id) : undefined}
            >
              {/* Bulk checkbox */}
              {bulkMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, background: isSelected ? 'var(--accent)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span className="text-xs text-muted">{isSelected ? 'Selected' : 'Click to select'}</span>
                </div>
              )}

              {/* Tags row */}
              <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={`tag ${typeTagClass(note.type)}`}>{note.type}</span>
                {note.folderId && note.folderId !== 'default' && <span className="tag">📁 {folders.find(f => f.id === note.folderId)?.name}</span>}
                {note.nextReminder && (
                  <span className={`tag ${overdueRemind ? 'danger' : ''}`} title={`Reminder: ${new Date(note.nextReminder).toLocaleString()}`}>
                    {overdueRemind ? '🔴' : '⏰'} {new Date(note.nextReminder).toLocaleDateString()}
                  </span>
                )}
              </div>

              <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{note.title}</h3>

              {/* Content with highlights */}
              <div style={{ marginBottom: '0.75rem' }}>
                <p className="text-sm text-muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {renderLinkedContent({
                    content: note.content,
                    notes,
                    highlights: note.highlights,
                    onLinkClick: (linkedNote) => startEdit(linkedNote),
                  })}
                </p>
                <p className="text-xs text-muted" style={{ marginTop: '0.375rem' }}>
                  {wordCount(note.content)} words · {readingTime(note.content)} min read
                </p>
              </div>

              {/* AI Summary */}
              {note.summary && (
                <div style={{ background: 'var(--surface-2)', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: '0.75rem' }}>
                  <p className="text-xs text-muted" style={{ fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Summary</p>
                  <p className="text-sm">{note.summary}</p>
                </div>
              )}

                {!bulkMode && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => startEdit(note)}>✏️ Edit</button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => generateSummary(note)}
                      disabled={isGenerating === note.id}
                      title={ai.isReady ? 'AI-powered summary' : 'Add API key in Settings'}
                    >
                      {isGenerating === note.id ? '⏳' : ai.isReady ? '✨ Summary' : '✨ Summary'}
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => generateFlashcards(note)}
                      disabled={isGenerating === note.id}
                      title={ai.isReady ? 'Generate flashcards with AI' : 'Add API key in Settings'}
                    >
                      {isGenerating === note.id ? '⏳' : '📝 Flashcards'}
                    </button>
                    {tier === 'pro' && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => generatePracticeQuestions(note)}
                        disabled={isGenerating === note.id}
                        title={ai.isReady ? 'Generate practice questions with AI' : 'Add API key in Settings'}
                      >
                        {isGenerating === note.id ? '⏳' : '❓ Practice Qs'}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-xs"
                      title="Set revisit reminder"
                      onClick={() => { setReminderNoteId(showReminderForm ? null : note.id); setReminderDate(''); }}
                    >⏰</button>
                    <button
                      className="btn btn-ghost btn-xs"
                      title={ai.isReady ? 'Generate flashcards from this note with AI' : 'Add API key in Settings'}
                      disabled={isGenerating === note.id || !ai.isReady}
                      onClick={() => generateFlashcards(note)}
                    >{isGenerating === note.id ? '⏳' : '📝 Flashcards'}</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => {
                      const opening = !isExpanded;
                      setExpandedNoteId(opening ? note.id : null);
                      setPersonalNoteInput('');
                      setEditingPersonalNote(null);
                      // Track last revisited when opening the detail panel
                      if (opening) updateNote(note.id, { lastRevisited: new Date() });
                    }}>{isExpanded ? '▲ Less' : '▼ More'}</button>
                    <button className="btn btn-danger btn-xs" onClick={() => deleteNote(note.id)}>🗑️</button>
                  </div>
                )}

              {/* Reminder setter */}
              {showReminderForm && !bulkMode && (
                <div className="animate-in" style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <p className="text-xs text-muted" style={{ fontWeight: 700, marginBottom: '0.5rem' }}>⏰ Set Revisit Reminder</p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="datetime-local"
                      className="input"
                      value={reminderDate}
                      onChange={e => setReminderDate(e.target.value)}
                      style={{ flex: 1, minWidth: '160px' }}
                    />
                    <button className="btn btn-primary btn-sm" onClick={() => saveReminder(note.id)} disabled={!reminderDate}>Set</button>
                    {note.nextReminder && (
                      <button className="btn btn-danger btn-sm" onClick={() => clearReminder(note.id)}>Clear</button>
                    )}
                  </div>
                </div>
              )}

              {/* Expanded panel */}
              {isExpanded && !bulkMode && (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '1rem', border: '1px solid var(--border)' }}>
                  {/* Highlights */}
                  <div>
                    <p className="section-title">🖊️ Highlights {tier === 'free' && <span className="text-xs text-muted" style={{ fontWeight: 400 }}>({(note.highlights || []).length}/3 free)</span>}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <span className="text-sm text-muted">Color:</span>
                      {HIGHLIGHT_COLORS.map(c => <button key={c} onClick={() => setHighlightColor(c)} style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: highlightColor === c ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer' }} />)}
                      <button className="btn btn-secondary btn-xs" onClick={() => addHighlight(note.id)}>+ Highlight Selection</button>
                    </div>
                    {(note.highlights || []).length > 0
                      ? <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>{note.highlights!.map(h => <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: h.color + '50', padding: '0.4rem 0.625rem', borderRadius: 'var(--radius)' }}><span className="text-sm" style={{ flex: 1 }}>"{h.text}"</span><button className="btn btn-ghost btn-xs" onClick={() => deleteHighlight(note.id, h.id)} style={{ color: 'var(--danger)' }}>✕</button></div>)}</div>
                      : <p className="text-sm text-muted">Select text above, then click "+ Highlight Selection".</p>}
                  </div>
                  <div className="divider" style={{ margin: 0 }} />
                  {/* Personal Notes */}
                  <div>
                    <p className="section-title">🗒️ Personal Notes {tier === 'free' && <span className="text-xs text-muted" style={{ fontWeight: 400 }}>(1 note, 200 chars on Free)</span>}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {tier === 'pro' ? (
                        <RichTextEditor
                          value={personalNoteInput}
                          onChange={setPersonalNoteInput}
                          placeholder="Your thoughts… (supports bold, italic, lists)"
                          minHeight="80px"
                        />
                      ) : (
                        <textarea className="textarea" rows={2} placeholder="Personal note (max 200 chars)…" value={personalNoteInput} onChange={e => setPersonalNoteInput(e.target.value)} maxLength={200} />
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => savePersonalNote(note.id)}>{editingPersonalNote ? 'Update' : 'Save'}</button>
                        {editingPersonalNote && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingPersonalNote(null); setPersonalNoteInput(''); }}>Cancel</button>}
                      </div>
                    </div>
                    {(note.personalNotes || []).length > 0
                      ? <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{note.personalNotes!.map(pn => <div key={pn.id} style={{ background: 'var(--surface)', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', position: 'relative' }}>{pn.content.startsWith('<') ? <div className="text-sm" style={{ paddingRight: '4rem', marginBottom: '0.2rem' }} dangerouslySetInnerHTML={{ __html: pn.content }} /> : <p className="text-sm" style={{ paddingRight: '4rem', marginBottom: '0.2rem' }}>{pn.content}</p>}<p className="text-xs text-muted">{new Date(pn.updatedAt).toLocaleDateString()}</p><div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.25rem' }}><button className="btn btn-ghost btn-xs" onClick={() => { setEditingPersonalNote(pn); setPersonalNoteInput(pn.content); }}>✏️</button><button className="btn btn-danger btn-xs" onClick={() => deletePersonalNote(note.id, pn.id)}>🗑️</button></div></div>)}</div>
                      : <p className="text-sm text-muted">No personal notes yet.</p>}
                  </div>
                  <div className="divider" style={{ margin: 0 }} />
                  {/* Attachments */}
                  <div>
                    <p className="section-title">📎 Attachments {tier !== 'pro' && <span className="text-xs text-muted" style={{ fontWeight: 400 }}>(Pro only)</span>}</p>
                    {tier === 'pro' && <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><label style={{ cursor: 'pointer' }}><span className="btn btn-secondary btn-sm">📤 Upload File</span><input type="file" accept=".pdf,.pptx,image/*,audio/*" onChange={e => handleFileUpload(note.id, e)} style={{ display: 'none' }} /></label><span className="text-xs text-muted">PDF, PPTX, images, audio · max 50MB</span></div>}
                    {(note.files || []).length > 0
                      ? <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{note.files!.map(f => <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}><span>{f.type === 'pdf' ? '📄' : f.type === 'pptx' ? '📊' : f.type === 'image' ? '🖼️' : '🎵'}</span><div style={{ flex: 1, minWidth: 0 }}><p className="text-sm truncate" style={{ fontWeight: 600 }}>{f.name}</p><p className="text-xs text-muted">{formatBytes(f.size)}</p></div>{f.type === 'image' && <img src={f.url} alt={f.name} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--radius)' }} />}{f.type === 'audio' && <audio controls src={f.url} style={{ height: '32px', maxWidth: '160px' }} />}{f.type === 'pdf' && <a href={f.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-xs">View</a>}<button className="btn btn-danger btn-xs" onClick={() => deleteAttachment(note.id, f.id)}>🗑️</button></div>)}</div>
                      : <p className="text-sm text-muted">{tier === 'pro' ? 'No attachments yet.' : 'Upgrade to Pro to attach PDFs, images, and audio.'}</p>}
                  </div>
                </div>
              )}

              {/* Related notes — wikilinks + tag Jaccard + same folder */}
              {!bulkMode && tier === 'pro' && relatedNotes(note).length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <p className="text-xs text-muted" style={{ fontWeight: 700, marginBottom: '0.375rem' }}>🔗 Related:</p>
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>{relatedNotes(note).map(rn => <span key={rn.id} className="tag primary" style={{ cursor: 'pointer' }} onClick={() => startEdit(rn)} title={`Open: ${rn.title}`}>{rn.title}</span>)}</div>
                </div>
              )}

              {/* Backlinks — notes that explicitly link TO this one */}
              {!bulkMode && tier === 'pro' && backlinks(note).length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p className="text-xs text-muted" style={{ fontWeight: 700, marginBottom: '0.375rem' }}>↩️ Backlinks:</p>
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>{backlinks(note).map(bn => <span key={bn.id} className="tag" style={{ cursor: 'pointer', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }} onClick={() => startEdit(bn)} title={`From: ${bn.title}`}>{bn.title}</span>)}</div>
                </div>
              )}

              <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>{note.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
              <p className="text-xs text-muted" style={{ marginTop: '0.375rem' }}>
                {new Date(note.createdAt).toLocaleDateString()}
                {' · '}{wordCount(note.content)} words
                {' · '}{readingTime(note.content)} min read
              </p>
            </div>
          );
        })}
      </div>

      {filteredNotes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">{search ? '🔍' : '📝'}</div>
          <h3>{search ? 'No results found' : 'No notes yet'}</h3>
          <p>{search ? 'Try a different search term.' : 'Click "+ New Note" to create your first note.'}</p>
          {!search && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '0.75rem' }}
              onClick={() => { loadStarterPack(); addToast('Loaded exam-prep starter pack ⚡', 'success'); }}
            >
              ⚡ Load exam-prep starter pack
            </button>
          )}
        </div>
      )}
    </div>
  );
}
