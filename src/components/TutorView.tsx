import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { serverTutor, serverAnalyzeDocuments, saveUserProfile } from '../api/ai';
import type { KeyPoint, DocumentAnalysis, TutorDocument } from '../api/ai';
import type { Note, StudyDocument } from '../types';
import { renderAiText, toPlainText } from '../utils/aiText';
import { extractTextFromFile } from '../utils/extractText';
import KeyPointsPanel from './KeyPointsPanel';
import DocumentBriefing from './DocumentBriefing';
import TutorDocuments, { type AttachedDoc } from './TutorDocuments';
import { useProgression } from '../game/ProgressionContext';
import {
  pickBestVoice, splitForSpeech, stripEmoji,
  SPEECH_RATES, SPEECH_SPEED_LABELS, type SpeechSpeed,
} from '../utils/speech';

interface Props {
  tier: string;
  /** True when AI features are available (Pro/trial, or the user's own key). */
  aiUnlocked?: boolean;
  setCurrentView: (view: any) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  notes?: Note[];
  onSaveNote?: (note: { title: string; content: string; tags?: string[] }) => void;
  /** Save uploaded files into the document library under Notes. */
  addDocuments?: (docs: StudyDocument[]) => void;
  /** Patch a library document (e.g. attach its analysis). */
  updateDocument?: (id: string, patch: Partial<StudyDocument>) => void;
  /**
   * Save a tutor question as a flashcard. This is how a wrong quiz answer
   * becomes part of the spaced-repetition deck instead of being forgotten.
   */
  onSaveFlashcard?: (card: { question: string; answer: string; topic?: string }) => void;
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
  /** The important points the tutor pulled out of this reply. */
  keyPoints?: KeyPoint[];
  /** Set when this turn is the briefing built from an uploaded document. */
  analysis?: DocumentAnalysis;
  /** True when the turn came from an uploaded file rather than a topic. */
  fromDocument?: boolean;
  /** Set when this turn answers a "I don't understand this part" ask. */
  followUp?: { quote?: string; note?: string };
  /** The instruction that produced this turn ("show me a diagram", …). */
  instruction?: string;
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

// Upload limits — a batch of textbook chapters is plenty.
const MAX_DOCS = 10;
const MAX_DOC_BYTES = 40 * 1024 * 1024;

/**
 * Condense a document briefing into the context that rides along with every
 * follow-up question. It carries the overview and the key points, so the
 * tutor stays grounded in the file without resending the whole document.
 */
function buildDocumentBrief(analysis: DocumentAnalysis): string {
  const points = analysis.keyPoints
    .map(p => `- (${p.importance}) ${p.point}${p.why ? ` — ${p.why}` : ''}`)
    .join('\n');
  return [
    `Document title: ${analysis.title}`,
    analysis.overview ? `Overview:\n${analysis.overview.slice(0, 2500)}` : '',
    points ? `Key points:\n${points}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * Drop the SVG source from a past answer before it is replayed.
 *
 * A single diagram is several hundred tokens of markup the model does not
 * need to read again — it already knows what it drew, and the student can
 * still see the picture in the transcript. Replacing it with a marker keeps
 * every follow-up cheap.
 */
function stripDiagramMarkup(text: string): string {
  return text.replace(/```svg[\s\S]*?```/g, '[a diagram was drawn here]');
}

/**
 * The conversation so far, as proper user/assistant turns.
 *
 * This used to send only the assistant answers, which meant the model never
 * saw what the student actually asked and Gemini received
 * `model, model, …, user` — a conversation with no context and no valid
 * role order. A follow-up like "show me a diagram" then had nothing to
 * attach to. Now every turn replays as the student's ask followed by the
 * tutor's answer.
 */
export function buildChatHistory(
  turns: ChatTurn[],
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of turns) {
    const ask = turn.instruction
      ? `Topic: ${turn.topic}\n\n${turn.instruction}`
      : turn.mode === 'quiz'
        ? `My answer to your question: ${turn.question || '(no answer given)'}`
        : `Topic: ${turn.topic}`;
    out.push({ role: 'user', content: ask });
    out.push({ role: 'assistant', content: stripDiagramMarkup(turn.response) });
  }
  return out;
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

export default function TutorView({ tier, aiUnlocked, setCurrentView, addToast, notes = [], onSaveNote, addDocuments, updateDocument, onSaveFlashcard }: Props) {
  const { award } = useProgression();
  // Quiz turns already saved as flashcards, so the button does not offer twice.
  const [savedFlashcardTurns, setSavedFlashcardTurns] = useState<string[]>([]);
  // A user who connected their own AI Studio key gets the Tutor on any plan.
  const unlocked = aiUnlocked ?? tier === 'pro';
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
  // "I don't understand a part" panel — one open at a time.
  const [confusedFor, setConfusedFor] = useState<string | null>(null);
  const [confusedQuote, setConfusedQuote] = useState('');
  const [confusedNote, setConfusedNote] = useState('');
  // The student's latest highlight inside a tutor answer. Captured on
  // `selectionchange` because clicking the button itself collapses the DOM
  // selection before the click handler can read it.
  const lastSelRef = useRef<{ turnId: string; text: string } | null>(null);

  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || text.length < 2) return; // keep the last real highlight
      let node: Node | null = sel!.anchorNode;
      if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
      const host = (node as Element | null)?.closest?.('[data-turn-id]');
      const turnId = host?.getAttribute('data-turn-id');
      if (turnId) lastSelRef.current = { turnId, text: text.slice(0, 600) };
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);
  // Voice mode: mic in (speech recognition) + spoken answers (speech synthesis)
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(() => {
    try { return localStorage.getItem('sw-tutor-voice') || ''; } catch { return ''; }
  });
  const [speed, setSpeed] = useState<SpeechSpeed>(() => {
    try {
      const saved = localStorage.getItem('sw-tutor-speed') as SpeechSpeed | null;
      return saved && saved in SPEECH_RATES ? saved : 'normal';
    } catch { return 'normal'; }
  });

  // ── Uploaded documents ─────────────────────────────────────────────────────
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  // The most recent document briefing — used as context for follow-ups.
  const [docAnalysis, setDocAnalysis] = useState<DocumentAnalysis | null>(null);

  const recognitionRef = useRef<any>(null);
  const voiceModeRef = useRef(false);
  // Bumped whenever a new reply starts speaking — lets a running sentence
  // chain know it has been superseded.
  const speechTokenRef = useRef(0);
  // Safety net: advances the speaking chain if the browser drops `onend`.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  // The voice actually used: the student's pick, else the best available for
  // the browser's language.
  const activeVoice = useMemo(() => {
    if (voiceURI) {
      const picked = voices.find(v => v.voiceURI === voiceURI);
      if (picked) return picked;
    }
    const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    return pickBestVoice(voices, lang);
  }, [voices, voiceURI]);

  // Strip markdown + maths so the TTS reads sentences, not symbols.
  const cleanForSpeech = useCallback((text: string): string => stripEmoji(toPlainText(text)), []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = undefined;
    }
  }, []);

  /**
   * Speak a reply.
   *
   * The text is spoken one sentence at a time. A single utterance sounds
   * mechanical and Chrome truncates anything past ~15 seconds; sentence-sized
   * chunks give the voice natural pauses and keep every utterance short.
   *
   * A watchdog timer advances the chain in case the browser never fires
   * `onend` — without it the reply would stop after the first sentence.
   */
  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;

    window.speechSynthesis.cancel();
    const token = ++speechTokenRef.current;
    const chunks = splitForSpeech(clean);
    if (!chunks.length) return;

    const rate = SPEECH_RATES[speed];
    let index = 0;

    const speakNext = () => {
      // A newer reply (or a cancel) invalidates this chain.
      if (token !== speechTokenRef.current) return;
      clearWatchdog();

      if (index >= chunks.length) {
        setSpeaking(false);
        // Hands-free loop: listen again after the tutor finishes speaking
        if (voiceModeRef.current) startListeningRef.current();
        return;
      }

      const chunk = chunks[index++];
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (activeVoice) {
        utterance.voice = activeVoice;
        utterance.lang = activeVoice.lang;
      } else {
        utterance.lang = 'en-US';
      }
      utterance.rate = rate;     // a touch slower than default — clearer
      utterance.pitch = 1.03;    // slightly brighter, still neutral
      utterance.volume = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => { clearWatchdog(); speakNext(); };
      utterance.onerror = () => {
        clearWatchdog();
        setSpeaking(false);
        if (token === speechTokenRef.current && voiceModeRef.current) startListeningRef.current();
      };

      // If `onend` never arrives, move on anyway.
      const words = chunk.split(/\s+/).length;
      const estimate = Math.max(1200, (words / (2.6 * rate)) * 1000);
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = undefined;
        if (token === speechTokenRef.current) speakNext();
      }, estimate + 1200);

      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  }, [cleanForSpeech, activeVoice, speed, clearWatchdog]);

  /** Let the student hear the selected voice before committing to it. */
  const previewVoice = useCallback(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    speechTokenRef.current += 1;
    clearWatchdog();
    const utterance = new SpeechSynthesisUtterance(
      "Hi, I'm your study tutor. I'll walk you through this topic clearly, one step at a time.",
    );
    if (activeVoice) {
      utterance.voice = activeVoice;
      utterance.lang = activeVoice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = SPEECH_RATES[speed];
    utterance.pitch = 1.03;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [activeVoice, speed, clearWatchdog]);

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
        speechTokenRef.current += 1;
        clearWatchdog();
        setSpeaking(false);
        setListening(false);
      } else {
        addToast('Voice mode on — tap the microphone, then speak.', 'info');
      }
      return next;
    });
  }, [addToast, clearWatchdog]);

  // Stop speech/recognition on unmount
  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch {}
    speechTokenRef.current += 1;
    clearWatchdog();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [clearWatchdog]);

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

  // The documents and the briefing that ride along with every question.
  const tutorDocs = useMemo<TutorDocument[]>(
    () => docs
      .filter(d => d.status === 'ready' && d.text.trim().length > 0)
      .map(d => ({ name: d.name, text: d.text })),
    [docs],
  );
  const documentBrief = useMemo(
    () => (docAnalysis ? buildDocumentBrief(docAnalysis) : null),
    [docAnalysis],
  );

  const send = useCallback(async (
    mode: TutorMode,
    payloadTopic?: string,
    opts?: { instruction?: string; followUp?: { quote?: string; note?: string } },
  ) => {
    const effectiveTopic = payloadTopic || topic.trim();
    if (!effectiveTopic) { addToast('Enter a topic first.', 'info'); return; }
    if (!unlocked) {
      addToast('Connect your free AI Studio key in Settings to unlock the AI Tutor.', 'info');
      setCurrentView('settings');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await serverTutor({
        topic: effectiveTopic,
        mode,
        educationLevel: level,
        history: buildChatHistory(history),
        lastAnswer: mode === 'quiz' ? answer || undefined : undefined,
        instruction: opts?.instruction ?? undefined,
        documents: tutorDocs,
        documentBrief,
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
        followUp: opts?.followUp,
        instruction: opts?.instruction,
        keyPoints: res.keyPoints,
        at: new Date(),
        difficulty: newDifficulty,
      };
      setHistory(prev => [...prev, turn]);
      setAnswer('');
      setTopic(effectiveTopic);
      setActiveTopic(effectiveTopic);
      // XP: a lesson, a simpler/deeper re-explanation or a quiz answer all
      // count as tutor work, but a real quiz answer is worth a bit more.
      award(mode === 'quiz' ? 'tutor_quiz' : 'tutor_session');
      // Voice mode: read the answer aloud
      if (voiceModeRef.current) speakText(res.response);
    } catch (err: any) {
      const msg = err.message || 'Tutor request failed.';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [topic, unlocked, level, history, answer, addToast, setCurrentView, speakText, tutorDocs, documentBrief, updateDocument]);

  /** Read the dropped / browsed files locally and keep their text in memory. */
  const handleFiles = useCallback(async (incoming: File[]) => {
    if (!unlocked) {
      addToast('Connect your free AI Studio key in Settings to use document analysis.', 'info');
      setCurrentView('settings');
      return;
    }
    const room = MAX_DOCS - docs.length;
    if (room <= 0) {
      addToast(`You can attach up to ${MAX_DOCS} files at a time.`, 'info');
      return;
    }
    const files = incoming.slice(0, room);
    const savedLibrary: StudyDocument[] = [];
    const slots: AttachedDoc[] = files.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      text: '',
      truncated: false,
      status: 'reading',
    }));
    setDocs(prev => [...prev, ...slots]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const slot = slots[i];
      if (file.size > MAX_DOC_BYTES) {
        setDocs(prev => prev.map(d => d.id === slot.id
          ? { ...d, status: 'error', error: 'File is larger than 40 MB.' }
          : d));
        continue;
      }
      try {
        const res = await extractTextFromFile(file);
        if (!res.text.trim()) throw new Error('No readable text in this file.');
        setDocs(prev => prev.map(d => d.id === slot.id
          ? { ...d, text: res.text, pages: res.pageCount, truncated: res.truncated, kind: res.kind, status: 'ready' }
          : d));
        // Keep it in the library so the student can come back to it under Notes.
        savedLibrary.push({
          id: slot.id,
          name: file.name,
          kind: res.kind || 'text',
          size: file.size,
          text: res.text,
          pages: res.pageCount,
          truncated: res.truncated,
          analysis: null,
          source: 'tutor',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (err: any) {
        setDocs(prev => prev.map(d => d.id === slot.id
          ? { ...d, status: 'error', error: err?.message || 'Could not read this file.' }
          : d));
      }
    }
    if (savedLibrary.length > 0) addDocuments?.(savedLibrary);
  }, [unlocked, docs.length, addToast, setCurrentView, addDocuments]);

  const removeDoc = useCallback((id: string) => {
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id);
      // Nothing left to ground the lesson in — drop the briefing context so
      // follow-up questions go back to general knowledge.
      if (!next.some(d => d.status === 'ready' && d.text.trim().length > 0)) {
        setDocAnalysis(null);
      }
      return next;
    });
  }, []);

  /** Ask the tutor to read the attached files and pull out what matters. */
  const handleAnalyze = useCallback(async () => {
    const ready = docs.filter(d => d.status === 'ready' && d.text.trim().length > 0);
    if (ready.length === 0) return;
    if (!unlocked) {
      addToast('Connect your free AI Studio key in Settings to use document analysis.', 'info');
      setCurrentView('settings');
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      const analysis = await serverAnalyzeDocuments(
        ready.map(d => ({ name: d.name, text: d.text })),
        level,
      );
      const topic = (analysis.title || ready[0].name).trim();
      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        mode: 'lesson',
        topic,
        response: analysis.overview || '',
        keyPoints: analysis.keyPoints,
        analysis,
        fromDocument: true,
        at: new Date(),
        difficulty: 'medium',
      };
      setHistory(prev => [...prev, turn]);
      setDocAnalysis(analysis);
      setActiveTopic(topic);
      setTopic(topic);
      // Attach the briefing to the library entry so it shows up under Notes.
      if (ready.length > 0 && updateDocument) {
        updateDocument(ready[0].id, { analysis, updatedAt: new Date() });
      }
      addToast(
        `Analyzed ${ready.length} document${ready.length === 1 ? '' : 's'} — ${analysis.keyPoints.length} key point${analysis.keyPoints.length === 1 ? '' : 's'} found.`,
        'success',
      );
      if (voiceModeRef.current) speakText(analysis.overview || '');
    } catch (err: any) {
      const msg = err.message || 'Document analysis failed.';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [docs, unlocked, level, addToast, setCurrentView, speakText, updateDocument]);

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
      const content = topicTurns.map(t => {
        const blocks = [`[${t.mode.toUpperCase()}] ${toPlainText(t.response)}`];
        // The key points are the part worth revising from — keep them.
        if (t.keyPoints && t.keyPoints.length > 0) {
          const points = t.keyPoints
            .map(p => `- (${p.importance}) ${p.point}${p.why ? ` — ${p.why}` : ''}`)
            .join('\n');
          blocks.push(`[KEY POINTS]\n${points}`);
        }
        if (t.analysis) {
          if (t.analysis.outline.length > 0) {
            blocks.push(`[OUTLINE]\n${t.analysis.outline.map(o => `- ${o.heading}${o.detail ? ` — ${o.detail}` : ''}`).join('\n')}`);
          }
          if (t.analysis.glossary.length > 0) {
            blocks.push(`[VOCABULARY]\n${t.analysis.glossary.map(g => `- ${g.term}: ${g.meaning}`).join('\n')}`);
          }
          if (t.analysis.questions.length > 0) {
            blocks.push(`[LIKELY EXAM QUESTIONS]\n${t.analysis.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
          }
        }
        return blocks.join('\n\n');
      }).join('\n\n---\n\n');
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

  /** Voice controls: toggle, voice picker, preview, speed. */
  const voiceControls = (
    <div className="sw-tutor-voice">
      <button
        type="button"
        className={`btn btn-sm ${voiceMode ? 'btn-primary' : 'btn-secondary'}`}
        onClick={toggleVoiceMode}
        title={voiceMode ? 'Turn voice mode off' : 'Turn voice mode on — speak your questions and hear answers aloud'
        }
        aria-pressed={voiceMode}
      >
        {voiceMode ? '🔊 Voice on' : '🔈 Voice off'}
      </button>

      {voices.length > 0 && (
        <>
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
                  {v.name.replace(/^Microsoft\s+/i, '').replace(/\s+Desktop$/i, '').trim()}
                  {v.voiceURI === activeVoice?.voiceURI ? ' — recommended' : ''} ({v.lang})
                </option>
              ))}
          </select>

          <button
            type="button"
            className="btn btn-sm btn-secondary sw-tutor-voice-play"
            onClick={previewVoice}
            title="Hear this voice"
            aria-label="Preview voice"
          >
            {speaking ? '🔊' : '▶'}
          </button>

          <select
            className="select select-sm sw-tutor-speed-select"
            value={speed}
            onChange={e => {
              const next = e.target.value as SpeechSpeed;
              setSpeed(next);
              try { localStorage.setItem('sw-tutor-speed', next); } catch {}
            }}
            title="Speaking speed"
            aria-label="Speaking speed"
          >
            {(Object.keys(SPEECH_SPEED_LABELS) as SpeechSpeed[]).map(s => (
              <option key={s} value={s}>{SPEECH_SPEED_LABELS[s]}</option>
            ))}
          </select>
        </>
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
          <p>Enter any topic above and press <strong>Teach me</strong> to begin. Try "Cell division" or "Supply and demand".<br />
            You can also drop a document below — the tutor reads it and shows you the points you must know.</p>
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

    return displayedHistory.map((turn, idx) => {
      // The quiz question this turn answers — the tutor's previous message.
      const askedTurn = turn.mode === 'quiz' && turn.question
        ? displayedHistory[idx - 1]
        : undefined;
      const askedQuestion = askedTurn?.response ?? '';
      const savedThisTurn = savedFlashcardTurns.includes(turn.id);

      return (
      <div key={turn.id} className="card animate-in sw-tutor-turn">
        <div className="card-header" style={{ marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="card-title" style={{ fontSize: '0.95rem' }}>{turn.topic}</span>
            {turn.fromDocument ? (
              <span className="tag info">📄 Document briefing</span>
            ) : (
              <span className="tag" style={{ textTransform: 'capitalize' }}>{turn.mode}</span>
            )}
            {turn.difficulty && (
              <span className="tag" style={{ background: 'var(--surface-2)', color: DIFFICULTY_LABELS[turn.difficulty]?.color || 'var(--text-2)' }}>
                {DIFFICULTY_LABELS[turn.difficulty]?.label || turn.difficulty}
              </span>
            )}
          </div>
          <span className="text-xs text-muted">{formatTime(turn.at)}</span>
        </div>

        {/* What the student asked to have explained, when this turn answers
            an "I don't understand this part" follow-up. */}
        {turn.followUp && (turn.followUp.quote || turn.followUp.note) && (
          <div className="sw-tutor-asked">
            <span className="sw-tutor-asked-label">🤔 You asked about:</span>
            {turn.followUp.quote && <blockquote>“{turn.followUp.quote}”</blockquote>}
            {turn.followUp.note && <p>{turn.followUp.note}</p>}
          </div>
        )}

        {turn.analysis ? (
          <DocumentBriefing analysis={turn.analysis} />
        ) : (
          <>
            {/* Formatted, symbol-free answer */}
            <div data-turn-id={turn.id}>
              {renderAiText(turn.response)}
            </div>
            {/* The important points for this topic — same panel the document
                briefing uses, so revision looks consistent everywhere. */}
            {turn.keyPoints && turn.keyPoints.length > 0 && (
              <KeyPointsPanel points={turn.keyPoints} compact />
            )}
          </>
        )}

        {/* Follow-up interactions for explanation turns */}
        {turn.mode !== 'quiz' && (
          <div className="sw-tutor-followups">
            <button
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => send('lesson', turn.topic, {
                instruction: 'The student explicitly asked for a diagram. Draw exactly one diagram of the single most important concept from the lesson so far, using the cheapest form that explains it: a short plain-text diagram in a ```diagram block (box-drawing characters, one line per box, 3-10 lines) when the idea is a simple flow or sequence; only use an SVG in a ```svg block when the concept is genuinely spatial or complex. Then add a one-line caption and two or three sentences on how to read it.',
              })}
              title="Ask the tutor to draw a diagram of this topic"
            >
              🖼️ Show me a diagram
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => {
                // Use the highlight captured on selectionchange — reading
                // window.getSelection() here is too late, the click already
                // collapsed it.
                const captured = lastSelRef.current?.turnId === turn.id
                  ? lastSelRef.current.text
                  : '';
                setConfusedQuote(captured);
                setConfusedNote('');
                setConfusedFor(confusedFor === turn.id ? null : turn.id);
              }}
              title="Point at the part you don't understand and get a focused explanation"
            >
              🤔 I don't understand a part
            </button>
          </div>
        )}

        {confusedFor === turn.id && (
          <div className="sw-confused-panel">
            <p className="text-xs text-muted" style={{ margin: 0 }}>
              Tip: highlight the exact part in the explanation above before opening this,
              or just describe what's confusing you.
            </p>
            <textarea
              className="textarea"
              rows={2}
              placeholder="The part you're stuck on (highlighted text appears here)…"
              value={confusedQuote}
              onChange={e => setConfusedQuote(e.target.value)}
            />
            <textarea
              className="textarea"
              rows={2}
              placeholder="Anything else the tutor should know (optional)…"
              value={confusedNote}
              onChange={e => setConfusedNote(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfusedFor(null)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={loading || (!confusedQuote.trim() && !confusedNote.trim())}
                onClick={() => {
                  const quote = confusedQuote.trim();
                  const note = confusedNote.trim();
                  setConfusedFor(null);
                  send('lesson', turn.topic, {
                    instruction: [
                      'The student does not understand a specific part of your previous explanation in this conversation. Re-explain ONLY that part, slowly and step by step, at the same level. Start by restating the part in your own words, then break it down. Do not re-teach the whole topic.',
                      quote ? `The part they are stuck on (quoted from your explanation): "${quote}"` : '',
                      note ? `Extra context from the student: "${note}"` : '',
                    ].filter(Boolean).join('\n'),
                    followUp: { quote: quote || undefined, note: note || undefined },
                  });
                }}
              >
                🎯 Explain this part
              </button>
            </div>
          </div>
        )}

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

        {/* A quiz turn with an answer can become a flashcard — this is how a
            question that went wrong joins the spaced-repetition deck instead
            of being forgotten. */}
        {turn.mode === 'quiz' && turn.question && onSaveFlashcard && askedQuestion && !savedThisTurn && (
          <div style={{ marginTop: '0.6rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                onSaveFlashcard({
                  question: askedQuestion,
                  answer: turn.response,
                  topic: turn.topic,
                });
                setSavedFlashcardTurns(prev => [...prev, turn.id]);
                award('card_created');
                addToast('Saved as a flashcard — it will come back around.', 'success');
              }}
              title="Turn this question and the tutor's explanation into a flashcard"
            >
              🩹 Save as flashcard
            </button>
          </div>
        )}
        {turn.mode === 'quiz' && turn.question && savedThisTurn && (
          <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>✓ Saved to your deck</p>
        )}
      </div>
      );
    });
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
            Ask anything about your coursework and get an explanation at your level — or upload your
            notes and get the important points pulled out for you.
          </p>
        </div>
        <span className="tag">{tier === 'pro' ? '⭐ Pro' : unlocked ? '🔑 Your key' : 'Free'}</span>
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

          {/* Document upload — the tutor reads the file and pulls out the
              points that matter before it starts teaching. */}
          <TutorDocuments
            docs={docs}
            onFiles={handleFiles}
            onRemove={removeDoc}
            onAnalyze={handleAnalyze}
            analyzing={analyzing}
            disabled={!unlocked}
            disabledReason="Connect your free Google AI Studio key in Settings to analyze documents."
          />

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
