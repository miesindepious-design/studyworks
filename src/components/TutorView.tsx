import { useCallback, useEffect, useRef, useState } from 'react';
import { serverTutor, saveUserProfile } from '../api/ai';

interface Props {
  tier: string;
  setCurrentView: (view: any) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type TutorMode = 'lesson' | 'simpler' | 'deeper' | 'quiz';

interface ChatTurn {
  id: string;
  mode: TutorMode;
  topic: string;
  question?: string;
  response: string;
  at: Date;
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

export default function TutorView({ tier, setCurrentView, addToast }: Props) {
  const [level, setLevel] = useState<string | null>(null);
  const [savingLevel, setSavingLevel] = useState(false);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    if (panelRef.current) panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [history, scrollToBottom]);

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

      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        mode,
        topic: effectiveTopic,
        question: mode === 'quiz' ? answer || undefined : undefined,
        response: res.response,
        at: new Date(),
      };
      setHistory(prev => [...prev, turn]);
      setAnswer('');
      setTopic(effectiveTopic);
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
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Ask a topic</span>
            <span className="text-xs text-muted">Examples: "Newton’s laws", "Photosynthesis", "OOP"</span>
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
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{error}</p>
          )}
        </div>
      </div>

      <div ref={panelRef} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '520px', overflow: 'auto', paddingRight: '0.25rem' }}>
        {history.map(turn => (
          <div key={turn.id} className="card animate-in" style={{ border: '1px solid var(--border)' }}>
            <div className="card-header" style={{ marginBottom: '0.5rem' }}>
              <span className="card-title">{turn.topic}</span>
              <span className="tag" style={{ textTransform: 'capitalize' }}>{turn.mode}</span>
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
        ))}
        {!history.length && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)' }}>
            <p>No lesson yet. Enter a topic and press <strong>Teach me</strong>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
