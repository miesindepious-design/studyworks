import { useState, useMemo, useEffect, useRef } from 'react';
import { Flashcard, Folder, PracticeQuestion } from '../types';
import { matchesSmartFilter } from '../utils/smartFolders';
import { recordReview } from '../db/streaks';
import Celebration from './Celebration';

type Tier = 'free' | 'pro';
type StudyMode = 'browse' | 'review' | 'practice-review' | 'intensive';

interface FlashcardsViewProps {
  flashcards: Flashcard[];
  setFlashcards: (flashcards: Flashcard[]) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  tier: Tier;
  setCurrentView: (view: string) => void;
  totalItems: number;
  folders: Folder[];
  setFolders: (folders: Folder[]) => void;
  practiceQuestions: PracticeQuestion[];
  setPracticeQuestions: (questions: PracticeQuestion[]) => void;
}

// SM-2 lives in `utils/sm2` so the same algorithm drives both flashcards
// and practice questions. Earlier versions had a local copy that hard-coded
// ef to 2.5 and never updated it; the new shared version is correct.
import { sm2 as sm2Impl } from '../utils/sm2';

// Local wrapper that adds the `difficulty` label on top of the SRS state.
function sm2(card: Flashcard, quality: 0 | 1 | 2 | 3): Partial<Flashcard> {
  const r = sm2Impl(card, quality);
  return {
    ...r,
    difficulty: quality <= 1 ? 'hard' : quality === 2 ? 'medium' : 'easy',
  };
}

const DIFF_COLOR: Record<string, string> = { easy: '#bbf7d0', medium: '#fde68a', hard: '#fecaca' };
const RATE_BTNS = [
  { label: 'Again', emoji: '😰', quality: 0 as const, color: '#ef4444' },
  { label: 'Hard',  emoji: '😓', quality: 1 as const, color: '#f97316' },
  { label: 'Good',  emoji: '🙂', quality: 2 as const, color: '#3b82f6' },
  { label: 'Easy',  emoji: '😄', quality: 3 as const, color: '#22c55e' },
];

export default function FlashcardsView({
  flashcards, setFlashcards, addToast, tier, setCurrentView,
  totalItems, folders, setFolders, practiceQuestions, setPracticeQuestions,
}: FlashcardsViewProps) {

  // ── Form state ────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState('');
  const [answer, setAnswer]     = useState('');
  const [tags, setTags]         = useState('');
  const [selectedFolder, setSelectedFolder] = useState('default');
  const [newFolderName, setNewFolderName]   = useState('');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [formOpen, setFormOpen]       = useState(false);

  // ── Browse ────────────────────────────────────────────────────────────────
  const [currentCard, setCurrentCard] = useState(0);
  const [isFlipped, setIsFlipped]     = useState(false);
  const [filterFolder, setFilterFolder] = useState('all');
  const [filterDiff, setFilterDiff]     = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [bulkMode, setBulkMode]         = useState(false);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [showStats, setShowStats]       = useState(false);
  const [celebrate, setCelebrate]         = useState<{ emoji: string; title: string; subtitle?: string } | null>(null);

  // ── Review ────────────────────────────────────────────────────────────────
  const [studyMode, setStudyMode]         = useState<StudyMode>('browse');
  const [reviewIndex, setReviewIndex]     = useState(0);
  const [reviewFlipped, setReviewFlipped] = useState(false);
  const [sessionStats, setSessionStats]   = useState({ again: 0, hard: 0, good: 0, easy: 0 });

  // Fire-and-forget: every review contributes to the daily streak. We don't
  // await — IDB writes shouldn't block the UI. The streak widget on the
  // dashboard polls `getStreakData()` on view change and on focus, so it
  // picks up the new value within a beat.
  const bumpStreak = () => { recordReview().catch(() => {}); };

  // ── Practice questions ────────────────────────────────────────────────────
  const [showPractice, setShowPractice] = useState(false);
  const [qIdx, setQIdx]                 = useState(0);
  const [showAnswer, setShowAnswer]     = useState(false);

  // ── Due cards ─────────────────────────────────────────────────────────────
  const dueCards = useMemo(() => {
    const now = new Date();
    return flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
  }, [flashcards]);

  // Due practice questions — same SRS scheduler as flashcards. Practice
  // questions that have never been answered are treated as due.
  const duePracticeQuestions = useMemo(() => {
    const now = new Date();
    return practiceQuestions
      .filter(q => !q.nextReview || new Date(q.nextReview) <= now)
      .sort((a, b) => {
        // Most-overdue first; never-reviewed at the top.
        if (!a.nextReview && !b.nextReview) return 0;
        if (!a.nextReview) return -1;
        if (!b.nextReview) return 1;
        return new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime();
      });
  }, [practiceQuestions]);
  const [practiceReviewIdx, setPracticeReviewIdx] = useState(0);
  const [practiceReveal, setPracticeReveal]       = useState(false);
  const [practiceChosen, setPracticeChosen]       = useState<string | null>(null);
  const currentPracticeQuestion = duePracticeQuestions[practiceReviewIdx % Math.max(duePracticeQuestions.length, 1)];

  const reviewCards       = dueCards.length > 0 ? dueCards : flashcards;
  const currentReviewCard = reviewCards[reviewIndex % Math.max(reviewCards.length, 1)];

  // ── Intensive study mode ───────────────────────────────────────────────────
  // Picks a subset of cards (the current filtered set), shuffles them, and
  // re-queues anything rated < Good at the end of each pass. The session
  // ends when every card has been rated Good or Easy at least once.
  const [intensiveQueue, setIntensiveQueue]     = useState<string[]>([]);
  const [intensiveIdx, setIntensiveIdx]         = useState(0);
  const [intensiveMastered, setIntensiveMastered] = useState(0);
  const [intensiveRounds, setIntensiveRounds]   = useState<Map<string, number>>(new Map());

  // The card at the head of the queue, looked up in the live flashcards list
  // so updates from rateCard() are reflected immediately.
  const currentIntensiveCard = intensiveQueue[intensiveIdx]
    ? flashcards.find(c => c.id === intensiveQueue[intensiveIdx])
    : undefined;

  // ── Filtered cards ────────────────────────────────────────────────────────
  const filteredCards = flashcards.filter(c => {
    if (filterFolder !== 'all') {
      const folder = folders.find(f => f.id === filterFolder);
      if (folder?.isSmart && folder.smartFilter) {
        const asNote = { tags: c.tags, type: 'note', highlights: [], files: [] } as any;
        if (!matchesSmartFilter(asNote, folder.smartFilter)) return false;
      } else if (c.folderId !== filterFolder) return false;
    }
    if (filterDiff !== 'all' && c.difficulty !== filterDiff) return false;
    return true;
  });

  const card = filteredCards[Math.min(currentCard, Math.max(filteredCards.length - 1, 0))];

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total:    flashcards.length,
    reviewed: flashcards.filter(c => (c.repetitions ?? 0) > 0).length,
    easy:     flashcards.filter(c => c.difficulty === 'easy').length,
    medium:   flashcards.filter(c => c.difficulty === 'medium').length,
    hard:     flashcards.filter(c => c.difficulty === 'hard').length,
    due:      dueCards.length,
    avgInterval: flashcards.length
      ? Math.round(flashcards.reduce((s, c) => s + (c.interval ?? 0), 0) / flashcards.length)
      : 0,
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const startReview = () => {
    if (tier !== 'pro') { addToast('Spaced repetition is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (!flashcards.length) { addToast('Add some flashcards first!', 'info'); return; }
    setReviewIndex(0); setReviewFlipped(false);
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 });
    setStudyMode('review');
  };

  const rateCard = (quality: 0 | 1 | 2 | 3) => {
    if (!currentReviewCard) return;
    setFlashcards(flashcards.map(c => c.id === currentReviewCard.id ? { ...c, ...sm2(currentReviewCard, quality) } : c));
    const key = RATE_BTNS[quality].label.toLowerCase() as keyof typeof sessionStats;
    setSessionStats(prev => ({ ...prev, [key]: prev[key] + 1 }));
    bumpStreak();
    setReviewFlipped(false);
    if (reviewIndex + 1 >= reviewCards.length) {
      setCelebrate({ emoji: '🎉', title: 'Session complete!', subtitle: `${reviewCards.length} card${reviewCards.length > 1 ? 's' : ''} reviewed. Nice work!` });
      setStudyMode('browse'); setReviewIndex(0);
    } else {
      setReviewIndex(p => p + 1);
    }
  };

  // ── Practice question review (SRS) ────────────────────────────────────────
  // User rates their answer correct/incorrect. We run the same SM-2
  // algorithm (q=3 for correct, q=0 for wrong) and persist nextReview on
  // the question itself. The question is removed from the due queue when
  // its nextReview is in the future.
  const ratePractice = (correct: boolean) => {
    if (!currentPracticeQuestion) return;
    const srs = sm2Impl(currentPracticeQuestion, correct ? 3 : 0);
    setPracticeQuestions(practiceQuestions.map(q =>
      q.id === currentPracticeQuestion.id
        ? { ...q, ...srs, lastAnsweredCorrect: correct, updatedAt: new Date() }
        : q
    ));
    bumpStreak();
    setPracticeReveal(false);
    setPracticeChosen(null);
    if (practiceReviewIdx + 1 >= duePracticeQuestions.length) {
      setCelebrate({ emoji: '🧠', title: 'Practice complete!', subtitle: `${duePracticeQuestions.length} question${duePracticeQuestions.length > 1 ? 's' : ''} reviewed.` });
      setStudyMode('browse');
      setPracticeReviewIdx(0);
    } else {
      setPracticeReviewIdx(p => p + 1);
    }
  };

  const startPracticeReview = () => {
    if (tier !== 'pro') { addToast('Practice review is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (duePracticeQuestions.length === 0) { addToast('No practice questions due for review.', 'info'); return; }
    setShowPractice(false);
    setStudyMode('practice-review');
    setPracticeReviewIdx(0);
    setPracticeReveal(false);
    setPracticeChosen(null);
  };

  // ── Intensive mode actions ─────────────────────────────────────────────────
  // Fisher-Yates shuffle — used to randomise the queue so the user doesn't
  // see cards in the same order every pass.
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const startIntensive = () => {
    if (tier !== 'pro') { addToast('Intensive study is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (filteredCards.length === 0) { addToast('No cards match the current filters.', 'info'); return; }
    // Cap at 50 cards per session so a 5000-card library doesn't take
    // forever. The user can re-enter intensive to do the next 50.
    const subset = shuffle(filteredCards.slice(0, 50).map(c => c.id));
    setIntensiveQueue(subset);
    setIntensiveIdx(0);
    setIntensiveMastered(0);
    setIntensiveRounds(new Map());
    setReviewFlipped(false);
    setStudyMode('intensive');
  };

  const exitIntensive = () => {
    setStudyMode('browse');
    setIntensiveQueue([]);
    setIntensiveIdx(0);
  };

  // Called after the user rates a card in intensive mode. The rating is
  // applied to the card via sm2 (same as review mode) but we additionally
  // decide whether to re-queue the card or move on.
  //   - quality 0 (Again) or 1 (Hard): re-queue at the back of the current pass.
  //   - quality 2 (Good) or 3 (Easy): card is mastered for this session; advance.
  const rateIntensive = (quality: 0 | 1 | 2 | 3) => {
    if (!currentIntensiveCard) return;
    // Apply SRS to the card itself.
    setFlashcards(flashcards.map(c => c.id === currentIntensiveCard.id ? { ...c, ...sm2(currentIntensiveCard, quality) } : c));
    const key = RATE_BTNS[quality].label.toLowerCase() as keyof typeof sessionStats;
    setSessionStats(prev => ({ ...prev, [key]: prev[key] + 1 }));

    const cardId = currentIntensiveCard.id;
    setIntensiveRounds(prev => {
      const next = new Map(prev);
      next.set(cardId, (next.get(cardId) ?? 0) + 1);
      return next;
    });

    setReviewFlipped(false);
    setIntensiveIdx(i => i + 1);
    bumpStreak();

    if (quality <= 1) {
      // Re-queue at the back of the current pass.
      setIntensiveQueue(q => [...q, cardId]);
    } else {
      // Mastered. Increment counter; will trigger end-of-session below.
      setIntensiveMastered(m => m + 1);
    }
  };

  // End the intensive session when every original card has been mastered.
  // We store the original queue length in a ref the first time intensive
  // mode is entered so we can detect "all original cards have a Good/Easy".
  const intensiveOriginalLenRef = useRef(0);
  useEffect(() => {
    if (studyMode === 'intensive' && intensiveQueue.length > 0 && intensiveOriginalLenRef.current === 0) {
      intensiveOriginalLenRef.current = intensiveQueue.length;
    }
    if (studyMode !== 'intensive') intensiveOriginalLenRef.current = 0;
  }, [studyMode, intensiveQueue]);

  // End the session when every original card has been mastered at least once.
  const intensiveAllDone = intensiveOriginalLenRef.current > 0 && intensiveMastered >= intensiveOriginalLenRef.current;
  useEffect(() => {
    if (studyMode === 'intensive' && intensiveAllDone) {
      setCelebrate({ emoji: '🔥', title: 'Intensive complete!', subtitle: `${intensiveOriginalLenRef.current} cards mastered. You crushed it!` });
      exitIntensive();
    }
  }, [intensiveAllDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCard) {
      setFlashcards(flashcards.map(c => c.id === editingCard.id
        ? { ...c, question, answer, tags: tags.split(',').map(t => t.trim()).filter(Boolean), folderId: selectedFolder }
        : c));
      setEditingCard(null); setFormOpen(false);
      addToast('Flashcard updated!', 'success');
    } else {
      if (tier === 'free' && totalItems >= 50) { addToast('50 item limit reached.', 'info'); setCurrentView('pricing'); return; }
      setFlashcards([{ id: Date.now().toString(), question, answer, tags: tags.split(',').map(t => t.trim()).filter(Boolean), createdAt: new Date(), folderId: selectedFolder }, ...flashcards]);
      setFormOpen(false); addToast('Flashcard added!', 'success');
    }
    setQuestion(''); setAnswer(''); setTags('');
  };

  const startEdit = (c: Flashcard) => { setEditingCard(c); setQuestion(c.question); setAnswer(c.answer); setTags(c.tags.join(', ')); setSelectedFolder(c.folderId || 'default'); setFormOpen(true); };
  const cancelEdit = () => { setEditingCard(null); setQuestion(''); setAnswer(''); setTags(''); setFormOpen(false); };

  const deleteFlashcard = (id: string) => {
    if (!confirm('Delete this flashcard?')) return;
    const updated = flashcards.filter(c => c.id !== id);
    setFlashcards(updated);
    if (currentCard >= updated.length && updated.length > 0) setCurrentCard(updated.length - 1);
    addToast('Flashcard deleted.', 'success');
  };

  const addFolder = () => {
    if (tier !== 'pro') { addToast('Folders are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (newFolderName.trim()) { setFolders([...folders, { id: Date.now().toString(), name: newFolderName.trim(), createdAt: new Date() }]); setNewFolderName(''); addToast('Folder added!', 'success'); }
  };

  const nextCard = () => { setCurrentCard(p => (p + 1) % filteredCards.length); setIsFlipped(false); };
  const prevCard = () => { setCurrentCard(p => (p - 1 + filteredCards.length) % filteredCards.length); setIsFlipped(false); };

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDelete = () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} flashcard${selected.size > 1 ? 's' : ''}?`)) return;
    setFlashcards(flashcards.filter(c => !selected.has(c.id)));
    setSelected(new Set()); setBulkMode(false); setCurrentCard(0);
    addToast(`Deleted ${selected.size} flashcard${selected.size > 1 ? 's' : ''}.`, 'success');
  };

  const deletePQ = (id: string) => {
    if (!confirm('Delete this practice question?')) return;
    const updated = practiceQuestions.filter(q => q.id !== id);
    setPracticeQuestions(updated);
    if (qIdx >= updated.length && updated.length > 0) setQIdx(updated.length - 1);
    addToast('Practice question deleted.', 'success');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h2>Flashcards</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {tier === 'pro' && practiceQuestions.length > 0 && (
            <button className="btn btn-secondary" onClick={() => { setShowPractice(o => !o); setStudyMode('browse'); }}>
              {showPractice ? '✕ Hide Practice' : '❓ Practice Qs'}
            </button>
          )}
          {tier === 'pro' && flashcards.length > 0 && studyMode === 'browse' && (
            <button className="btn btn-secondary" onClick={startReview}>
              🧠 Spaced Review
              {dueCards.length > 0 && <span style={{ background: 'var(--danger)', color: '#fff', borderRadius: 'var(--radius-full)', padding: '0 6px', fontSize: '0.7rem', marginLeft: '4px', fontWeight: 700 }}>{dueCards.length}</span>}
            </button>
          )}
          {tier === 'pro' && practiceQuestions.length > 0 && studyMode === 'browse' && (
            <button className="btn btn-secondary" onClick={startPracticeReview}>
              ❓ Practice Review
              {duePracticeQuestions.length > 0 && <span style={{ background: 'var(--danger)', color: '#fff', borderRadius: 'var(--radius-full)', padding: '0 6px', fontSize: '0.7rem', marginLeft: '4px', fontWeight: 700 }}>{duePracticeQuestions.length}</span>}
            </button>
          )}
          {tier === 'pro' && studyMode === 'browse' && filteredCards.length > 0 && (
            <button className="btn btn-secondary" onClick={startIntensive}>
              🎯 Intensive
            </button>
          )}
          {flashcards.length > 0 && <button className="btn btn-secondary" onClick={() => setShowStats(s => !s)} title="Statistics">📊</button>}
          {studyMode === 'review' && <button className="btn btn-secondary" onClick={() => setStudyMode('browse')}>✕ Exit Review</button>}
          {studyMode === 'practice-review' && <button className="btn btn-secondary" onClick={() => setStudyMode('browse')}>✕ Exit Practice Review</button>}
          {studyMode === 'intensive' && <button className="btn btn-secondary" onClick={exitIntensive}>✕ Exit Intensive</button>}
          <button className="btn btn-primary" onClick={() => { if (!editingCard) setFormOpen(o => !o); }}>
            {formOpen ? '✕ Close' : '+ New Card'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {showStats && flashcards.length > 0 && (
        <div className="card animate-in" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">📊 Statistics</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowStats(false)}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {[
              { label: 'Total',      value: stats.total,       color: 'var(--accent)'   },
              { label: 'Reviewed',   value: stats.reviewed,    color: 'var(--accent-2)' },
              { label: 'Due today',  value: stats.due,         color: stats.due > 0 ? 'var(--danger)' : 'var(--success)' },
              { label: 'Easy',       value: stats.easy,        color: '#22c55e'           },
              { label: 'Medium',     value: stats.medium,      color: '#f59e0b'           },
              { label: 'Hard',       value: stats.hard,        color: '#ef4444'           },
              { label: 'Avg interval', value: `${stats.avgInterval}d`, color: 'var(--text-2)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem', border: '1px solid var(--border)', textAlign: 'center' }}>
                <p style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.value}</p>
                <p className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>{s.label}</p>
              </div>
            ))}
          </div>
          {stats.total > 0 && (
            <div>
              <p className="text-xs text-muted" style={{ marginBottom: '0.375rem' }}>Difficulty distribution</p>
              <div style={{ display: 'flex', height: '8px', borderRadius: 'var(--radius-full)', overflow: 'hidden', gap: '2px' }}>
                {stats.easy   > 0 && <div style={{ flex: stats.easy,   background: '#22c55e', borderRadius: 'var(--radius-full)' }} />}
                {stats.medium > 0 && <div style={{ flex: stats.medium, background: '#f59e0b', borderRadius: 'var(--radius-full)' }} />}
                {stats.hard   > 0 && <div style={{ flex: stats.hard,   background: '#ef4444', borderRadius: 'var(--radius-full)' }} />}
                {(stats.total - stats.easy - stats.medium - stats.hard) > 0 && (
                  <div style={{ flex: stats.total - stats.easy - stats.medium - stats.hard, background: 'var(--border)', borderRadius: 'var(--radius-full)' }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Limit warning */}
      {tier === 'free' && totalItems >= 40 && (
        <div className="limit-warning">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <p>Approaching your 50 item limit!</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrentView('pricing')}>Upgrade</button>
        </div>
      )}

      {/* Add/Edit form */}
      {(formOpen || editingCard) && (
        <div className="card animate-in" style={{ marginBottom: '1.75rem' }}>
          <div className="card-header">
            <span className="card-title">{editingCard ? '✏️ Edit Flashcard' : '✚ New Flashcard'}</span>
            {tier === 'free' && <span className="tag accent">{totalItems}/50 items</span>}
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <select className="select" value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {tier === 'pro' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" className="input" placeholder="New folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addFolder}>+ Folder</button>
                </div>
              )}
            </div>
            <input type="text" className="input" placeholder="Question" value={question} onChange={e => setQuestion(e.target.value)} required />
            <textarea className="textarea" placeholder="Answer" rows={3} value={answer} onChange={e => setAnswer(e.target.value)} required />
            <input type="text" className="input" placeholder="Tags (comma separated)" value={tags} onChange={e => setTags(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={!editingCard && tier === 'free' && totalItems >= 50}>
                {!editingCard && tier === 'free' && totalItems >= 50 ? 'Upgrade to Add More' : editingCard ? 'Update' : 'Add Flashcard'}
              </button>
              {editingCard && <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>
      )}

      {/* Spaced Review */}
      {studyMode === 'review' && tier === 'pro' && (
        <div className="animate-in" style={{ maxWidth: '580px', margin: '0 auto', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontWeight: 700 }}>🧠 Review Session</h3>
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8125rem', fontWeight: 600 }}>
              {RATE_BTNS.map(b => <span key={b.label} style={{ color: b.color }}>{b.emoji} {sessionStats[b.label.toLowerCase() as keyof typeof sessionStats]}</span>)}
            </div>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>Card {reviewIndex + 1} of {reviewCards.length} · {dueCards.length} due today</p>
          <div className={`flip-card${reviewFlipped ? ' flipped' : ''}`} onClick={() => setReviewFlipped(f => !f)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setReviewFlipped(f => !f)}>
            <div className="flip-inner">
              <div className="flip-face front" style={{ minHeight: '240px' }}>
                {currentReviewCard?.difficulty && (
                  <span style={{ position: 'absolute', top: '1rem', left: '1rem', background: DIFF_COLOR[currentReviewCard.difficulty] || '#e5e7eb', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600 }}>
                    {currentReviewCard.difficulty} · {currentReviewCard.interval ?? 0}d
                  </span>
                )}
                <p className="text-xs text-muted" style={{ marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Question</p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentReviewCard?.question}</h3>
                <p className="text-xs text-muted" style={{ marginTop: '1.25rem' }}>Click or press Enter to flip</p>
              </div>
              <div className="flip-face back" style={{ minHeight: '240px' }}>
                <p className="text-xs" style={{ marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>Answer</p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentReviewCard?.answer}</h3>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '1.25rem', minHeight: '52px' }}>
            {reviewFlipped ? (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
                {RATE_BTNS.map(b => (
                  <button key={b.label} className="btn btn-secondary" onClick={() => rateCard(b.quality)} style={{ borderColor: b.color, color: b.color, minWidth: '90px' }}>
                    {b.emoji} {b.label}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted" style={{ textAlign: 'center' }}>Flip the card first, then rate it</p>}
          </div>
        </div>
      )}

      {/* Practice Review — SRS-driven review of due practice questions */}
      {studyMode === 'practice-review' && tier === 'pro' && currentPracticeQuestion && (
        <div className="animate-in" style={{ maxWidth: '580px', margin: '0 auto', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontWeight: 700 }}>❓ Practice Review</h3>
            <span className="tag">{duePracticeQuestions.length} due</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
            Question {practiceReviewIdx + 1} of {duePracticeQuestions.length}
            {currentPracticeQuestion.repetitions ? ` · rep ${currentPracticeQuestion.repetitions} · ${currentPracticeQuestion.interval ?? 0}d` : ''}
          </p>
          <div className="card" style={{ padding: '1.75rem', minHeight: '200px', position: 'relative' }}>
            <span className="tag primary" style={{ marginBottom: '0.75rem', display: 'inline-flex' }}>{currentPracticeQuestion.type}</span>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>{currentPracticeQuestion.question}</h3>

            {currentPracticeQuestion.type === 'multiple-choice' && currentPracticeQuestion.options?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {currentPracticeQuestion.options.map((opt) => {
                  const isChosen   = practiceChosen === opt;
                  const isCorrect  = opt === currentPracticeQuestion.answer;
                  const showResult = practiceReveal;
                  return (
                    <button
                      key={opt}
                      onClick={() => { setPracticeChosen(opt); setPracticeReveal(true); }}
                      className="btn btn-secondary"
                      style={{
                        justifyContent: 'flex-start', textAlign: 'left',
                        borderColor: showResult && isCorrect ? 'var(--success)' : (showResult && isChosen && !isCorrect ? 'var(--danger)' : undefined),
                        background:  showResult && isCorrect ? '#d1fae5' : (showResult && isChosen && !isCorrect ? '#fee2e2' : undefined),
                      }}
                    >
                      {opt}
                      {showResult && isCorrect && <span style={{ marginLeft: 'auto' }}>✓</span>}
                      {showResult && isChosen && !isCorrect && <span style={{ marginLeft: 'auto' }}>✕</span>}
                    </button>
                  );
                })}
              </div>
            ) : currentPracticeQuestion.type === 'true-false' ? (
              <div style={{ display: 'flex', gap: '0.75rem' }} onClick={e => e.stopPropagation()}>
                {['True', 'False'].map(opt => {
                  const isChosen  = practiceChosen === opt;
                  const isCorrect = opt === currentPracticeQuestion.answer;
                  const showResult = practiceReveal;
                  return (
                    <button key={opt}
                      onClick={() => { setPracticeChosen(opt); setPracticeReveal(true); }}
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        borderColor: showResult && isCorrect ? 'var(--success)' : (showResult && isChosen && !isCorrect ? 'var(--danger)' : undefined),
                        background:  showResult && isCorrect ? '#d1fae5' : (showResult && isChosen && !isCorrect ? '#fee2e2' : undefined),
                      }}
                    >{opt}</button>
                  );
                })}
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted" style={{ marginBottom: '0.5rem' }}>Open answer — recall it in your head, then reveal.</p>
                {!practiceReveal
                  ? <button className="btn btn-secondary w-full" onClick={() => setPracticeReveal(true)}>Reveal answer</button>
                  : <div className="animate-in" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '1rem', border: '1px solid var(--border)' }}>
                      <p className="text-xs" style={{ color: 'var(--accent)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Answer</p>
                      <p style={{ fontWeight: 700 }}>{currentPracticeQuestion.answer}</p>
                    </div>
                }
              </div>
            )}
          </div>

          {practiceReveal && (
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button className="btn btn-secondary" onClick={() => ratePractice(false)}
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)', minWidth: '140px' }}>
                ✕ I got it wrong
              </button>
              <button className="btn btn-primary" onClick={() => ratePractice(true)}
                style={{ minWidth: '140px' }}>
                ✓ I got it right
              </button>
            </div>
          )}
          {!practiceReveal && currentPracticeQuestion.type !== 'open' && (
            <p className="text-sm text-muted" style={{ marginTop: '1rem', textAlign: 'center' }}>Pick an option to see the answer, then rate yourself.</p>
          )}
        </div>
      )}

      {/* Intensive study mode — shuffle + re-queue Until-Mastered */}
      {studyMode === 'intensive' && tier === 'pro' && currentIntensiveCard && (
        <div className="animate-in" style={{ maxWidth: '580px', margin: '0 auto', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontWeight: 700 }}>🎯 Intensive</h3>
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8125rem', fontWeight: 600 }}>
              {RATE_BTNS.map(b => <span key={b.label} style={{ color: b.color }}>{b.emoji} {sessionStats[b.label.toLowerCase() as keyof typeof sessionStats]}</span>)}
            </div>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
            Card {Math.min(intensiveIdx + 1, intensiveQueue.length)} of {intensiveQueue.length} in queue
            {' · '}
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>{intensiveMastered}</span> mastered
            {intensiveOriginalLenRef.current > 0 && <> / {intensiveOriginalLenRef.current}</>}
            {' · '}
            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {Math.max(intensiveQueue.length - intensiveOriginalLenRef.current, 0)}
            </span> re-queued
          </p>
          <div className={`flip-card${reviewFlipped ? ' flipped' : ''}`} onClick={() => setReviewFlipped(f => !f)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setReviewFlipped(f => !f)}>
            <div className="flip-inner">
              <div className="flip-face front" style={{ minHeight: '240px' }}>
                {currentIntensiveCard.difficulty && (
                  <span style={{ position: 'absolute', top: '1rem', left: '1rem', background: DIFF_COLOR[currentIntensiveCard.difficulty] || '#e5e7eb', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600 }}>
                    {currentIntensiveCard.difficulty} · {currentIntensiveCard.interval ?? 0}d
                  </span>
                )}
                {(intensiveRounds.get(currentIntensiveCard.id) ?? 0) > 1 && (
                  <span style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'var(--danger)', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.7rem', fontWeight: 700 }}>
                    Seen {intensiveRounds.get(currentIntensiveCard.id)}×
                  </span>
                )}
                <p className="text-xs text-muted" style={{ marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Question</p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentIntensiveCard.question}</h3>
                <p className="text-xs text-muted" style={{ marginTop: '1.25rem' }}>Click or press Enter to flip</p>
              </div>
              <div className="flip-face back" style={{ minHeight: '240px' }}>
                <p className="text-xs" style={{ marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>Answer</p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentIntensiveCard.answer}</h3>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '1.25rem', minHeight: '52px' }}>
            {reviewFlipped ? (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
                {RATE_BTNS.map(b => (
                  <button key={b.label} className="btn btn-secondary" onClick={() => rateIntensive(b.quality)} style={{ borderColor: b.color, color: b.color, minWidth: '90px' }}>
                    {b.emoji} {b.label}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted" style={{ textAlign: 'center' }}>Flip the card first, then rate it</p>}
          </div>
        </div>
      )}

      {/* Practice Questions */}
      {showPractice && tier === 'pro' && practiceQuestions.length > 0 && studyMode === 'browse' && (
        <div className="animate-in" style={{ maxWidth: '580px', margin: '0 auto', marginBottom: '2rem' }}>
          <div className="card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="card-title">❓ Practice Questions</span>
            <span className="tag">{qIdx + 1} / {practiceQuestions.length}</span>
          </div>
          {practiceQuestions[qIdx].type === 'multiple-choice' && practiceQuestions[qIdx].options?.length ? (
            <div className="card" style={{ padding: '1.75rem', position: 'relative' }}>
              <button className="btn btn-danger btn-xs" onClick={() => deletePQ(practiceQuestions[qIdx].id)} style={{ position: 'absolute', top: '1rem', right: '1rem' }}>🗑️</button>
              <span className="tag primary" style={{ marginBottom: '1rem', display: 'inline-flex' }}>multiple-choice</span>
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, marginBottom: '1.25rem' }}>{practiceQuestions[qIdx].question}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {practiceQuestions[qIdx].options!.map((opt, i) => {
                  const isCorrect = showAnswer && opt === practiceQuestions[qIdx].answer;
                  return (
                    <button key={i} onClick={() => setShowAnswer(true)} className="btn btn-secondary" style={{ justifyContent: 'flex-start', textAlign: 'left', borderColor: isCorrect ? 'var(--success)' : undefined, background: isCorrect ? '#d1fae5' : undefined, color: isCorrect ? '#065f46' : undefined }}>
                      <span style={{ fontWeight: 700, marginRight: '0.5rem' }}>{String.fromCharCode(65 + i)}.</span>{opt}
                      {isCorrect && <span style={{ marginLeft: 'auto' }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              {!showAnswer && <p className="text-xs text-muted" style={{ marginTop: '1rem', textAlign: 'center' }}>Click an option to reveal</p>}
            </div>
          ) : (
            <div className={`flip-card${showAnswer ? ' flipped' : ''}`} onClick={() => setShowAnswer(a => !a)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setShowAnswer(a => !a)}>
              <div className="flip-inner">
                <div className="flip-face front" style={{ minHeight: '200px', position: 'relative' }}>
                  <button className="btn btn-danger btn-xs" onClick={e => { e.stopPropagation(); deletePQ(practiceQuestions[qIdx].id); }} style={{ position: 'absolute', top: '1rem', right: '1rem' }}>🗑️</button>
                  <span className="tag primary" style={{ marginBottom: '0.75rem' }}>{practiceQuestions[qIdx].type}</span>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700 }}>{practiceQuestions[qIdx].question}</h3>
                  {practiceQuestions[qIdx].type === 'true-false' && (
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-secondary" onClick={() => setShowAnswer(true)} style={{ flex: 1 }}>True</button>
                      <button className="btn btn-secondary" onClick={() => setShowAnswer(true)} style={{ flex: 1 }}>False</button>
                    </div>
                  )}
                  {practiceQuestions[qIdx].type === 'open' && <p className="text-xs text-muted" style={{ marginTop: '1rem' }}>Click to reveal</p>}
                </div>
                <div className="flip-face back" style={{ minHeight: '200px' }}>
                  <p className="text-xs" style={{ color: 'var(--accent)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Answer</p>
                  <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>{practiceQuestions[qIdx].answer}</p>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn btn-secondary" onClick={() => { setQIdx(p => (p - 1 + practiceQuestions.length) % practiceQuestions.length); setShowAnswer(false); }}>← Prev</button>
            <button className="btn btn-primary" onClick={() => { setQIdx(p => (p + 1) % practiceQuestions.length); setShowAnswer(false); }}>Next →</button>
          </div>
        </div>
      )}

      {/* Filter toolbar */}
      {studyMode === 'browse' && flashcards.length > 0 && (
        <div className="toolbar" style={{ marginBottom: '1rem' }}>
          <select className="select" value={filterFolder} onChange={e => { setFilterFolder(e.target.value); setCurrentCard(0); }} style={{ minWidth: '130px' }}>
            <option value="all">All Folders</option>
            {folders.filter(f => f.id !== 'default').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="select" value={filterDiff} onChange={e => { setFilterDiff(e.target.value as typeof filterDiff); setCurrentCard(0); }} style={{ minWidth: '130px' }}>
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(m => !m); setSelected(new Set()); }}>
            {bulkMode ? '✕ Cancel' : '☑ Select'}
          </button>
          {bulkMode && selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={bulkDelete}>🗑️ Delete {selected.size}</button>}
          <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
            {filteredCards.length} card{filteredCards.length !== 1 ? 's' : ''}{filteredCards.length !== flashcards.length && ` of ${flashcards.length}`}
          </span>
        </div>
      )}

      {/* Bulk select grid */}
      {bulkMode && studyMode === 'browse' && (
        <div className="grid animate-in" style={{ marginBottom: '1.5rem' }}>
          {filteredCards.map(c => (
            <div key={c.id} className="card" onClick={() => toggleSelect(c.id)} style={{ cursor: 'pointer', border: selected.has(c.id) ? '2px solid var(--accent)' : '1px solid var(--border)', background: selected.has(c.id) ? 'var(--accent-soft)' : undefined }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${selected.has(c.id) ? 'var(--accent)' : 'var(--border)'}`, background: selected.has(c.id) ? 'var(--accent)' : undefined, flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selected.has(c.id) && <span style={{ color: '#fff', fontSize: '0.7rem' }}>✓</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="text-sm" style={{ fontWeight: 600 }}>{c.question}</p>
                  {c.difficulty && <span style={{ background: DIFF_COLOR[c.difficulty] || '#e5e7eb', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-full)', fontSize: '0.7rem', fontWeight: 600 }}>{c.difficulty}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Browse flipper */}
      {studyMode === 'browse' && filteredCards.length > 0 && !bulkMode && card && (
        <div className="animate-in" style={{ maxWidth: '580px', margin: '0 auto' }}>
          <div className={`flip-card${isFlipped ? ' flipped' : ''}`} onClick={() => setIsFlipped(f => !f)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setIsFlipped(f => !f)}>
            <div className="flip-inner">
              <div className="flip-face front" style={{ minHeight: '280px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '0.875rem', right: '0.875rem', display: 'flex', gap: '0.375rem' }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-xs" onClick={() => startEdit(card)}>✏️</button>
                  <button className="btn btn-danger btn-xs" onClick={() => deleteFlashcard(card.id)}>🗑️</button>
                </div>
                {card.difficulty && (
                  <span style={{ position: 'absolute', top: '0.875rem', left: '0.875rem', background: DIFF_COLOR[card.difficulty] || '#e5e7eb', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.72rem', fontWeight: 600 }}>
                    {card.difficulty}{card.nextReview ? ` · ${new Date(card.nextReview).toLocaleDateString()}` : ''}
                  </span>
                )}
                <div style={{ marginTop: '2rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  {card.tags.map(t => <span key={t} className="tag">{t}</span>)}
                  {card.folderId && card.folderId !== 'default' && <span className="tag">📁 {folders.find(f => f.id === card.folderId)?.name}</span>}
                </div>
                <p className="text-xs text-muted" style={{ marginBottom: '0.75rem' }}>
                  Card {currentCard + 1} of {filteredCards.length}{filteredCards.length !== flashcards.length && ' (filtered)'} · click to flip
                </p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{card.question}</h3>
                <p className="text-xs text-muted" style={{ marginTop: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Question</p>
              </div>
              <div className="flip-face back" style={{ minHeight: '280px' }}>
                <p className="text-xs" style={{ color: 'var(--accent)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Answer</p>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{card.answer}</h3>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn btn-secondary" onClick={prevCard}>← Prev</button>
            <span className="text-sm text-muted" style={{ alignSelf: 'center', minWidth: '80px', textAlign: 'center' }}>{currentCard + 1} / {filteredCards.length}</span>
            <button className="btn btn-primary" onClick={nextCard}>Next →</button>
          </div>
        </div>
      )}

      {/* Empty states */}
      {flashcards.length === 0 && studyMode === 'browse' && (
        <div className="empty-state">
          <div className="empty-state-icon">💡</div>
          <h3>No flashcards yet</h3>
          <p>Create your first card with the "+ New Card" button above.</p>
        </div>
      )}
      {flashcards.length > 0 && filteredCards.length === 0 && !bulkMode && studyMode === 'browse' && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3>No cards match the filters</h3>
          <p>Try changing the folder or difficulty filter above.</p>
        </div>
      )}

      {celebrate && (
        <Celebration
          emoji={celebrate.emoji}
          title={celebrate.title}
          subtitle={celebrate.subtitle}
          onClose={() => setCelebrate(null)}
        />
      )}
    </div>
  );
}
