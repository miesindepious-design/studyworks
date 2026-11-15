import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { serverTutor, saveUserProfile } from '../api/ai';
import type { Note } from '../types';
import { renderAiText, toPlainText } from '../utils/aiText';

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

/**
 * Voices that actually sound good. Windows/Edge expose the Microsoft Neural
 * voices, Chrome exposes Google's — those are far better than the default
 * "Microsoft David Desktop" voice, which is the one that used to read every
 * answer.
 */
const VOICE_PREFERENCE: RegExp[] = [
  /Microsoft (Aria|Jenny|Guy|Sonia|Libby|Emma|Michelle|Ava|Ryan)(?!.*David)/i,
  /Google (US|UK) English/i,
  /(Samantha|Serena|Karen|Moira|Tessa|Fiona|Allison|Vicki|Nicky|Aria|Jenny|Zira)/i,
  /(Natural|Neural|Premium|Enhanced)/i,
  /Microsoft (Zira|Hazel|Sonia)/i,
];

/** Voices we would rather not fall back to. */
const VOICE_AVOID = /David|George|Mark|Ricardo/i;

/** Pick the most natural-sounding English voice available. */
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter(v => /^en(-|_|$)/i.test(v.lang || ''));
  const pool = english.length ? english : voices;
  for (const re of VOICE_PREFERENCE) {
    const hit = pool.find(v => re.test(v.name || ''));
    if (hit) return hit;
  }
  const nice = pool.find(v => v.localService && !VOICE_AVOID.test(v.name || ''));
  return nice ?? pool[0];
}

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
  const [fullscreen, setFullscreen] = useState(false);
  // Voice mode: mic in (speech recognition) + spoken answers (speech synthesis)
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(() => {
    try { return localStorage.getItem('sw-tutor-voice') || ''; } catch { return ''; }
  });
  const recognitionRef = useRef<any>(null);
  const voiceModeRef = useRef(false);
  // Refs let speakText → startListening → send call each other regardless of
  // declaration order (send is defined below).
  const sendRef = useRef<(mode: TutorMode, payloadTopic?: string) => Promise<void>>(async () => {});
  const startListeningRef = useRef<() => void>(() => {});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  // The voice list loads asynchronously in most browsers.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices() || []);
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // The voice actually used: the user's pick, else the best available.
  const activeVoice = useMemo(() => {
    if (voiceURI) {
      const picked = voices.find(v => v.voiceURI === voiceURI);
      if (picked) return picked;
    }
    return pickBestVoice(voices);
  }, [voices, voiceURI]);

  // Strip markdown + maths so the TTS reads sentences, not symbols.
  const cleanForSpeech = useCallback((text: string): string => toPlainText(text), []);

  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    if (activeVoice) {
      utterance.voice = activeVoice;
      utterance.lang = activeVoice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = 0.97;      // a touch slower than default — clearer
    utterance.pitch = 1.04;     // slightly brighter
    utterance.volume = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => {
      setSpeaking(false);
      // Hands-free loop: listen again after the tutor finishes speaking
      if (voiceModeRef.current) startListeningRef.current();
    };
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [cleanForSpeech, activeVoice]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addToast('Voice input is not supported in this browser (try Chrome or Edge).', 'error');
      return;
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (finalText.trim()) {
        setTopic(finalText.trim());
        sendRef.current('lesson', finalText.trim());
      } else if (interim.trim()) {
        setTopic(interim.trim());
      }
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        addToast('Microphone access denied. Allow the microphone in your browser settings.', 'error');
      } else if (event.error !== 'aborted') {
        addToast(`Voice input error: ${event.error}`, 'error');
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    setListening(true);
    recognition.start();
  }, [addToast]);

  const toggleVoiceMode = useCallback(() => {
    if (!('speechSynthesis' in window)) {
      addToast('Speech output is not supported in this browser.', 'error');
      return;
    }
    setVoiceMode(prev => {
      const next = !prev;
      if (!next) {
        try { recognitionRef.current?.stop(); } catch {}
        window.speechSynthesis.cancel();
        setSpeaking(false);
        setListening(false);
      } else {
        addToast('Voice mode on — tap the microphone, then speak.', 'info');
      }
      return next;
    });
  }, [addToast]);

  // Stop speech/recognition on unmount
  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch {}
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  // Exit fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // While fullscreen the body itself scrolls, so the panel fills the screen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

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
      // Voice mode: read the answer aloud
      if (voiceModeRef.current) speakText(res.response);
    } catch (err: any) {
      const msg = err.message || 'Tutor request failed.';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [topic, tier, level, history, answer, addToast, setCurrentView, speakText]);

  // Keep the refs pointing at the latest callbacks
  sendRef.current = send;
  startListeningRef.current = startListening;

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
      // Save plain prose — the raw markdown only reads badly later.
      const content = topicTurns.map(t => `[${t.mode.toUpperCase()}] ${toPlainText(t.response)}`).join('\n\n---\n\n');
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

  /* ── Shared pieces ─────────────────────────────────────────────────────── */

  /** The ask row: topic input, mic, teach button. */
  const askRow = (
    <div className="sw-tutor-ask">
      <input
        className="input"
        placeholder={listening ? '🎙️ Listening…' : 'Type a topic to learn…'}
        value={topic}
        onChange={e => setTopic(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && send('lesson')}
      />
      <button
        type="button"
        className={`btn sw-tutor-mic ${listening ? 'btn-primary' : 'btn-secondary'}`}
        onClick={startListening}
        disabled={loading}
        title={listening ? 'Listening for your voice…' : 'Speak your topic'}
        style={listening ? { animation: 'pulse 1.2s infinite ease-in-out' } : undefined}
      >
        {listening ? '🔴' : '🎙️'}
      </button>
      <button className="btn btn-primary" onClick={() => send('lesson')} disabled={loading}>
        {loading ? 'Teaching…' : 'Teach me'}
      </button>
    </div>
  );

  /** Voice controls + voice picker. */
  const voiceControls = (
    <div className="sw-tutor-voice">
      <button
        type="button"
        className={`btn btn-sm ${voiceMode ? 'btn-primary' : 'btn-secondary'}`}
        onClick={toggleVoiceMode}
        title={voiceMode ? 'Turn voice mode off' : 'Turn voice mode on — speak your questions and hear answers aloud'}
        aria-pressed={voiceMode}
      >
        {voiceMode ? '🔊 Voice on' : '🔈 Voice off'}
      </button>
      {voices.length > 0 && (
        <select
          className="select select-sm sw-tutor-voice-select"
          value={activeVoice?.voiceURI ?? ''}
          onChange={e => {
            setVoiceURI(e.target.value);
            try { localStorage.setItem('sw-tutor-voice', e.target.value); } catch {}
          }}
          title="Choose the voice used for spoken answers"
          aria-label="Tutor voice"
        >
          {voices
            .filter(v => /^en/i.test(v.lang || ''))
            .map(v => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name.replace(/\s+(Microsoft|Google|Desktop|Natural)\s*/gi, ' ').trim()} ({v.lang})
              </option>
            ))}
        </select>
      )}
      {speaking && <span className="text-xs text-muted">🗣️ Tutor is speaking…</span>}
      {listening && <span className="text-xs text-muted">🎙️ Listening — say what you don't understand…</span>}
    </div>
  );

  /** Mode buttons (simpler / deeper / quiz / save). */
  const modeControls = (
    <div className="sw-tutor-modes">
      <button className="btn btn-secondary btn-sm" onClick={() => send('simpler')} disabled={loading || !latestResponse}>Simpler</button>
      <button className="btn btn-secondary btn-sm" onClick={() => send('deeper')} disabled={loading || !latestResponse}>Dive deeper</button>
      <button className="btn btn-secondary btn-sm" onClick={() => send('quiz')} disabled={loading || !latestResponse}>Test me</button>
      {activeTopic && (
        <button className="btn btn-ghost btn-sm" onClick={saveToNotes} disabled={saving || loading}>
          {saving ? 'Saving…' : '💾 Save to notes'}
        </button>
      )}
    </div>
  );

  /** The chat history list. */
  const historyList = (() => {
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
      <div key={turn.id} className="card animate-in sw-tutor-turn">
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
        {/* Formatted, symbol-free answer */}
        {renderAiText(turn.response)}
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
  })();

  /* ── Fullscreen overlay ────────────────────────────────────────────────── */
  /* Rendered through a portal on <body> so no ancestor can clip it — the
     old version was trapped inside the page column and covered half the
     screen. */
  const fullscreenOverlay = (
    <div className="sw-tutor-fs" role="dialog" aria-modal="true" aria-label="AI Tutor full screen">
      <div className="sw-tutor-fs-bar">
        <div className="sw-tutor-fs-heading">
          <span className="sw-label">Create</span>
          <h2>AI Tutor</h2>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setFullscreen(false)}
          title="Exit full screen (Esc)"
        >
          ⛶ Exit full screen
        </button>
      </div>
      <div className="sw-tutor-fs-ask">
        {askRow}
        {voiceControls}
        {modeControls}
      </div>
      <div className="sw-tutor-fs-list" ref={panelRef}>
        {historyList}
      </div>
    </div>
  );

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <span className="sw-label">Create</span>
          <h2>AI Tutor</h2>
          <p className="text-sm text-muted">
            Ask anything about your coursework and get an explanation at your level.
          </p>
        </div>
        <span className="tag">{tier === 'pro' ? '⭐ Pro' : 'Free'}</span>
      </div>

      <div className="sw-tutor-layout">
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

          {askRow}

          {/* Voice mode toggle */}
          {voiceControls}

          {modeControls}

          {suggestedTopics.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <p className="text-xs text-muted" style={{ marginBottom: '0.35rem' }}>Suggested from your notes:</p>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {suggestedTopics.map((s, si) => (
                  <button
                    key={`${s}-${si}`}
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
      <div ref={panelRef} className="sw-tutor-panel">
        {/* Fullscreen toolbar */}
        <div className="sw-tutor-panel-bar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFullscreen(true)}
            title="View in full screen"
          >
            ⛶ Full screen
          </button>
        </div>
        {historyList}
      </div>

      {fullscreen && createPortal(fullscreenOverlay, document.body)}
    </div>
  );
}
