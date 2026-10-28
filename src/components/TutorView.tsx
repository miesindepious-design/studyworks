import { useCallback, useEffect, useRef, useState } from 'react';
import { serverTutor, saveUserProfile } from '../api/ai';
import type { Note } from '../types';

interface Props {
  tier: string;
  setCurrentView: (view: any) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  notes?: Note[];
  onSaveNote?: (note: { title: string; content: string; tags?: string[] }) => void;
}

type TutorMode = 'lesson' | 'simpler' | 'deeper' | 'quiz';

interface ChatTurn {
  id: string;
  mode: TutorMode;
  topic: string;
  question?: string;
  response: string;
  at: Date;
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface TopicGroup {
  topic: string;
  turns: ChatTurn[];
  mastery: number;
  difficulty: 'easy' | 'medium' | 'hard';
  lastActive: Date;
}

const LEVELS = [
  { value: 'high-school', label: 'High School' },
  { value: 'college-freshman', label: 'College Freshman' },
  { value: 'college-sophomore', label: 'College Sophomore' },
  { value: 'college-junior', label: 'College Junior' },
  { value: 'college-senior', label: 'College Senior / Final Year' },
  { value: 'university', label: 'University' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'phd', label: 'PhD / Research' },
];

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy:   { label: 'Easy',   color: 'var(--success)' },
  medium: { label: 'Medium', color: 'var(--warning)' },
  hard:   { label: 'Hard',   color: 'var(--danger)' },
};

function groupHistoryByTopic(history: ChatTurn[]): TopicGroup[] {
  const map = new Map<string, TopicGroup>();
  for (const turn of history) {
    const key = turn.topic;
    if (!map.has(key)) {
      map.set(key, {
        topic: key,
        turns: [],
        mastery: 0,
        difficulty: 'medium',
        lastActive: turn.at,
      });
    }
    const group = map.get(key)!;
    group.turns.push(turn);
    if (turn.at > group.lastActive) group.lastActive = turn.at;
  }
  for (const group of map.values()) {
    const quizTurns = group.turns.filter(t => t.mode === 'quiz');
    const answeredQuizzes = quizTurns.filter(t => t.question && t.question.trim().length > 0);
    if (quizTurns.length > 0) {
      group.mastery = Math.round((answeredQuizzes.length / quizTurns.length) * 100);
    }
    if (group.turns.length > 0) {
      group.difficulty = group.turns[group.turns.length - 1].difficulty || 'medium';
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TutorView({ tier, setCurrentView, addToast, notes = [], onSaveNote }: Props) {
  const [level, setLevel] = useState<string | null>(null);
  const [savingLevel, setSavingLevel] = useState(false);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    if (panelRef.current) panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [history, scrollToBottom]);

  // Generate suggested topics from note titles
  useEffect(() => {
    const titles = notes
      .map(n => n.title.trim())
      .filter((t): t is string => !!t && t.length > 2)
      .slice(0, 6);
    setSuggestedTopics(titles);
  }, [notes]);

  // Simulate typing indicator
  useEffect(() => {
    if (loading) {
      setIsTyping(true);
      typingRef.current = setTimeout(() => setIsTyping(false), 1500);
    } else {
      setIsTyping(false);
    }
    return () => { if (typingRef.current) clearTimeout(typingRef.current); };
  }, [loading]);

  const send = useCallback(async (mode: TutorMode, payloadTopic?: string) => {
    const effectiveTopic = payloadTopic || topic.trim();
    if (!effectiveTopic) { addToast('Enter a topic first.', 'info'); return; }
    if (tier !== 'pro') { addToast('AI Tutor is a Pro feature.', 'info'); setCurrentView('pricing'); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await serverTutor({
        topic: effectiveTopic,
        mode,
        educationLevel: level,
        history: history.map(h => ({ role: 'assistant', content: h.response })),
        lastAnswer: mode === 'quiz' ? answer || undefined : undefined,
      });

      // Adaptive difficulty: adjust based on quiz performance for this topic
      let newDifficulty: 'easy' | 'medium' | 'hard' = 'medium';
      const topicHistory = history.filter(h => h.topic === effectiveTopic);
      const topicQuizzes = topicHistory.filter(h => h.mode === 'quiz' && h.question && h.question.trim().length > 0);
      if (topicQuizzes.length >= 2) {
        const lastTwo = topicQuizzes.slice(-2);
        const allAnswered = lastTwo.every(q => q.question && q.question.trim().length > 0);
        if (allAnswered) {
          newDifficulty = 'hard';
        } else if (topicQuizzes.length >= 1 && topicQuizzes[topicQuizzes.length - 1].question && topicQuizzes[topicQuizzes.length - 1].question!.trim().length > 0) {
          newDifficulty = 'medium';
        } else {
          newDifficulty = 'easy';
        }
      }

      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        mode,
        topic: effectiveTopic,
        question: mode === 'quiz' ? answer || undefined : undefined,
        response: res.response,
        at: new Date(),
        difficulty: newDifficulty,
      };
      setHistory(prev => [...prev, turn]);
      setAnswer('');
      setTopic(effectiveTopic);
      setActiveTopic(effectiveTopic);
    } catch (err: any) {
      const msg = err.message || 'Tutor request failed.';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [topic, tier, level, history, answer, addToast, setCurrentView]);

  const saveLevel = useCallback(async (next: string | null) => {
    setSavingLevel(true);
    try {
      await saveUserProfile(next);
      setLevel(next);
      addToast('Education level saved.', 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to save level.', 'error');
    } finally {
      setSavingLevel(false);
    }
  }, [addToast]);

  const startNewTopic = useCallback(() => {
    setTopic('');
    setActiveTopic(null);
    setAnswer('');
    setError(null);
  }, []);

  const saveToNotes = useCallback(async () => {
    if (!activeTopic) { addToast('No active topic to save.', 'info'); return; }
    setSaving(true);
    try {
      const topicTurns = history.filter(h => h.topic === activeTopic);
      if (topicTurns.length === 0) { addToast('Nothing to save for this topic.', 'info'); return; }
      const content = topicTurns.map(t => `[${t.mode.toUpperCase()}] ${t.response}`).join('\n\n---\n\n');
      if (onSaveNote) {
        await onSaveNote({
          title: `AI Tutor: ${activeTopic}`,
          content,
          tags: ['ai-tutor', activeTopic.toLowerCase().replace(/\s+/g, '-')],
        });
      } else {
        await navigator.clipboard.writeText(content);
        addToast('Lesson copied to clipboard. Connect notes to save directly.', 'info');
        return;
      }
      addToast('Lesson saved to notes!', 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to save.', 'error');
    } finally {
      setSaving(false);
    }
  }, [activeTopic, history, onSaveNote, addToast]);

  const latestResponse = history[history.length - 1]?.response;

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>AI Tutor</h2>
        <span className="tag">{tier === 'pro' ? '⭐ Pro' : 'Free'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.25rem' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Your level</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>
            This sets the base lesson complexity.
          </p>
          <select
            className="select"
            value={level ?? ''}
            onChange={e => setLevel(e.target.value || null)}
            style={{ width: '100%' }}
          >
            <option value="">Select level…</option>
            {LEVELS.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: '0.75rem', width: '100%' }}
            onClick={() => saveLevel(level)}
            disabled={savingLevel || !level}
          >
            {savingLevel ? 'Saving…' : 'Save level'}
          </button>

          {activeTopic && (
            <div style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={startNewTopic}>
                ✨ New topic
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Ask a topic</span>
            <span className="text-xs text-muted">Examples: "Newton's laws", "Photosynthesis", "OOP"</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Type a topic to learn…"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send('lesson')}
              style={{ flex: 1, minWidth: '220px' }}
            />
            <button className="btn btn-primary" onClick={() => send('lesson')} disabled={loading}>
              {loading ? 'Teaching…' : 'Teach me'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => send('simpler')} disabled={loading || !latestResponse}>Simpler</button>
            <button className="btn btn-secondary btn-sm" onClick={() => send('deeper')} disabled={loading || !latestResponse}>Dive deeper</button>
            <button className="btn btn-secondary btn-sm" onClick={() => send('quiz')} disabled={loading || !latestResponse}>Test me</button>
            {activeTopic && (
              <button className="btn btn-ghost btn-sm" onClick={saveToNotes} disabled={saving || loading}>
                {saving ? 'Saving…' : '💾 Save to notes'}
              </button>
            )}
          </div>

          {suggestedTopics.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <p className="text-xs text-muted" style={{ marginBottom: '0.35rem' }}>Suggested from your notes:</p>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {suggestedTopics.map(s => (
                  <button
                    key={s}
                    className="badge badge-primary"
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setTopic(s); send('lesson', s); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{error}</p>
          )}
        </div>
      </div>

      {/* Topic tabs + mastery */}
      {(() => {
        const topicGroups = groupHistoryByTopic(history);
        if (topicGroups.length === 0) return null;
        return (
          <div className="card" style={{ padding: '1rem 1.25rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="text-xs text-muted" style={{ fontWeight: 600 }}>Topics:</span>
              {topicGroups.map(group => (
                <button
                  key={group.topic}
                  className={`tag ${activeTopic === group.topic ? 'primary' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveTopic(activeTopic === group.topic ? null : group.topic)}
                >
                  {group.topic}
                  <span style={{ marginLeft: '0.35rem', fontSize: '0.7rem', opacity: 0.8 }}>
                    {group.mastery}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Chat history panel */}
      <div
        ref={panelRef}
        style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '520px', overflow: 'auto', paddingRight: '0.25rem' }}
      >
        {(() => {
          const displayedHistory = activeTopic
            ? history.filter(h => h.topic === activeTopic)
            : history;
          if (displayedHistory.length === 0 && !loading) {
            return (
              <div className="card empty-state" style={{ padding: '3rem 2rem' }}>
                <div className="empty-state-icon">{isTyping ? '🤔' : '🎓'}</div>
                <h3>{isTyping ? 'Thinking...' : 'Start a lesson'}</h3>
                <p>Enter any topic above and press <strong>Teach me</strong> to begin. Try "Cell division" or "Supply and demand".</p>
                {isTyping && (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.35rem' }}>
                    <span style={{ animation: 'bounce 1.4s infinite ease-in-out both', fontSize: '1.2rem' }}>.</span>
                    <span style={{ animation: 'bounce 1.4s infinite ease-in-out 0.2s both', fontSize: '1.2rem' }}>.</span>
                    <span style={{ animation: 'bounce 1.4s infinite ease-in-out 0.4s both', fontSize: '1.2rem' }}>.</span>
                  </div>
                )}
              </div>
            );
          }

          return displayedHistory.map(turn => (
            <div key={turn.id} className="card animate-in" style={{ border: '1px solid var(--border)' }}>
              <div className="card-header" style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="card-title" style={{ fontSize: '0.95rem' }}>{turn.topic}</span>
                  <span className="tag" style={{ textTransform: 'capitalize' }}>{turn.mode}</span>
                  {turn.difficulty && (
                    <span className="tag" style={{ background: 'var(--surface-2)', color: DIFFICULTY_LABELS[turn.difficulty]?.color || 'var(--text-2)' }}>
                      {DIFFICULTY_LABELS[turn.difficulty]?.label || turn.difficulty}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted">{formatTime(turn.at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{turn.response}</div>
              {turn.mode === 'quiz' && (
                <div style={{ marginTop: '0.75rem' }}>
                  <textarea
                    className="textarea"
                    placeholder="Type your answer here…"
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                  />
                  <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => send('quiz')} disabled={loading}>
                    Submit answer
                  </button>
                </div>
              )}
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
