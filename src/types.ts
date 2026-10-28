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
  lastRevisited?: Date;
  nextReminder?: Date;
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
  type?: 'standard' | 'fill-in';
  reviewHistory?: Array<{ date: string; quality: number }>;
}

export interface PracticeQuestion {
  id: string;
  question: string;
  answer: string;
  type: 'multiple-choice' | 'true-false' | 'open';
  options?: string[];
  noteId?: string;
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
