export type TabType = 
  | 'dashboard' 
  | 'notes' 
  | 'contacts' 
  | 'flashcards' 
  | 'pricing' 
  | 'settings' 
  | 'multiplayer';

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: Date;
  updatedAt?: Date; // server-side LWW compare key
  isSmart?: boolean;
  smartFilter?: string; // e.g. "tag:exam" | "type:article" | "tag:lecture,type:note"
}

export interface FileAttachment {
  id: string;
  name: string;
  type: 'pdf' | 'pptx' | 'image' | 'audio';
  url: string;
  size: number;
  uploadedAt: Date;
}

export interface Highlight {
  id: string;
  text: string;
  color: string;
  note?: string;
  createdAt: Date;
}

export interface PersonalNote {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  type: 'note' | 'article' | 'idea' | 'project';
  createdAt: Date;
  updatedAt: Date;
  summary?: string;
  folderId?: string;
  files?: FileAttachment[];
  highlights?: Highlight[];
  personalNotes?: PersonalNote[];
  /**
   * Set when the note was produced as a document (a Word handout, a PDF
   * worksheet, a slide deck). The note keeps the reference; the file itself
   * lives in the generated-documents store.
   */
  document?: GeneratedDocumentMeta;
  lastRevisited?: Date;
  nextReminder?: Date;
  /**
   * Spaced-repetition state. A note that is never reviewed is a note the
   * student will forget, so notes are scheduled on the same SM-2 curve as
   * cards and practice questions. These fields mirror `Flashcard` exactly,
   * which is what lets one scheduler drive all three.
   */
  repetitions?: number;
  interval?: number;
  ef?: number;
  /** When this note should come back. */
  nextReview?: Date;
  /** The trail of self-assessed recall ratings, most recent last. */
  reviewHistory?: Array<{ date: string; quality: number }>;
  /**
   * How many times this note has been rated "Again". Three or more means
   * the note itself is the problem — usually too long to recall.
   */
  leechCount?: number;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  notes?: string;
  lastContacted?: Date;
  nextReminder?: Date;
  tags: string[];
  folderId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  birthday?: Date;
  relationshipStrength?: 'weak' | 'moderate' | 'strong';
  studyGroupIds?: string[];
}

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  createdAt: Date;
  updatedAt?: Date; // server-side LWW compare key
  folderId?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  nextReview?: Date;
  interval?: number;
  repetitions?: number;
  ef?: number; // SM-2 easiness factor; defaults to 2.5 if unset
  type?: 'standard' | 'fill-in' | 'cloze';
  /** The subject this card belongs to. Drives the Mastery Map. */
  topic?: string;
  /** How many times this card has been rated "Again". Three or more = leech. */
  leechCount?: number;
  /** Where the card came from, so the app can offer to fix AI-made ones. */
  source?: 'manual' | 'note' | 'ai' | 'tutor' | 'import';
  reviewHistory?: Array<{ date: string; quality: number }>;
}

export interface PracticeQuestion {
  id: string;
  question: string;
  answer: string;
  type: 'multiple-choice' | 'true-false' | 'open';
  options?: string[];
  noteId?: string;
  /** The subject this question belongs to. Drives the Mastery Map. */
  topic?: string;
  createdAt: Date;
  updatedAt?: Date;
  // Spaced repetition state — same fields as Flashcard so the same
  // SM-2 implementation can drive both. Earlier versions were
  // fire-and-forget: the user saw the question, never got asked again.
  nextReview?: Date;
  interval?:   number;
  repetitions?: number;
  ef?:         number;
  lastAnsweredCorrect?: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'streak' | 'study' | 'social' | 'ai';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  requirement: { type: string; target: number };
  unlockedAt?: Date;
  progress: number;
}

export interface StudyGoal {
  id: string;
  type: 'flashcards' | 'notes' | 'minutes';
  target: number;
  current: number;
  date: string; // YYYY-MM-DD
  completed: boolean;
}

export interface StudyTimerSession {
  id: string;
  task: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // seconds
  type: 'focus' | 'break';
  date: string; // YYYY-MM-DD
}

export interface StudyGroup {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdBy: string;
  createdAt: Date;
  color: string;
}

// ── Quiz Battle additions ─────────────────────────────────────────────────────
export type PowerUpType = '50/50' | 'extra-time' | 'double-points';

export interface PowerUpState {
  fiftyFifty: boolean;
  extraTime: boolean;
  doublePoints: boolean;
  pendingDouble: boolean;
}

export interface GameHistoryEntry {
  id: string;
  date: Date;
  opponent: string;
  myScore: number;
  opponentScore: number;
  result: 'win' | 'loss' | 'draw';
  xpEarned: number;
  questionCount: number;
}

export interface LobbyReaction {
  emoji: string;
  userId: string;
  userName: string;
  timestamp: number;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  snapshotAt: Date;
}

export interface SessionStat {
  id: string;
  date: string;
  mode: 'review' | 'cram' | 'intensive';
  duration: number;
  cardsReviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  accuracy: number;
  avgResponseTime: number;
}

export interface DeckProgress {
  folderId: string;
  name: string;
  total: number;
  mastered: number;
  learning: number;
  new: number;
  due: number;
  progress: number;
}

// ── Document library ──────────────────────────────────────────────────────────
import type { DocumentAnalysis } from './api/ai';

/** A document the student uploaded (via AI Tutor or the Notes library). */
export interface StudyDocument {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'pptx' | 'image' | 'html' | 'text';
  size: number;
  /** Extracted plain text — the AI reads this, not the raw file. */
  text: string;
  pages?: number;
  truncated: boolean;
  /** Filled in after the tutor analyses the document. */
  analysis?: DocumentAnalysis | null;
  source: 'tutor' | 'library';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A shared study file handed from the lobby to the AI tutor. It carries the
 * text with it so the tutor can pick the material up the moment the student
 * lands on the tutor screen.
 */
export interface PendingTutorDocument {
  id: string;
  name: string;
  text: string;
  size: number;
  kind: StudyDocument['kind'];
}

/**
 * A document the AI tutor produced from a lesson — a Word handout, a PDF
 * worksheet or a slide deck. The note keeps a reference to it instead of the
 * whole lesson as one long block of text.
 */
export type GeneratedDocFormat = 'docx' | 'pdf' | 'pptx';

export interface GeneratedDocumentMeta {
  /** The id of the stored document (IndexedDB). */
  id: string;
  /** What the document is. */
  format: GeneratedDocFormat;
  /** The file name it downloads as. */
  fileName: string;
  /** Size in bytes. */
  size: number;
  /** Why this format was chosen — shown on the note card. */
  reason?: string;
}

export interface GeneratedDocument {
  id: string;
  title: string;
  topic: string;
  format: GeneratedDocFormat;
  fileName: string;
  size: number;
  /** The generated file itself. */
  blob: Blob;
  /** The note this document belongs to, if any. */
  noteId?: string;
  createdAt: Date;
}
