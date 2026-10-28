/**
 * studentTemplates.ts — exam-prep starter content for the STUDENT version.
 *
 * Provides:
 *   - subject starter folders (one-click study organisation),
 *   - reusable note templates (lecture notes, revision sheet, exam checklist),
 *   - a starter flashcard deck,
 *   - buildStarterPack() → a bundle of folders + notes + flashcards a new
 *     student can load in one click.
 *
 * All factories return fully-shaped objects (ids via crypto.randomUUID,
 * dates via new Date) so callers can append them straight to the real
 * diffing setters in useDB.
 */

import type { Folder, Note, Flashcard } from '../types';

const now = () => new Date();

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface SubjectFolder {
  id: string;
  name: string;
  icon: string;
  /** Optional smart filter, e.g. "tag:exam". */
  smartFilter?: string;
}

export const SUBJECT_FOLDERS: SubjectFolder[] = [
  { id: 'subject-math',    name: 'Mathematics',    icon: '📐' },
  { id: 'subject-science', name: 'Sciences',       icon: '🔬' },
  { id: 'subject-cs',      name: 'Computer Science', icon: '💻' },
  { id: 'subject-hum',     name: 'Humanities',     icon: '📜' },
  { id: 'subject-lang',    name: 'Languages',      icon: '🗣️' },
];

export function buildSubjectFolders(): Folder[] {
  return SUBJECT_FOLDERS.map(s => ({
    id: s.id,
    name: `${s.icon} ${s.name}`,
    createdAt: now(),
  }));
}

export interface NoteTemplate {
  id: string;
  label: string;
  icon: string;
  type: Note['type'];
  tags: string[];
  build: (folderId?: string) => Note;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'lecture',
    label: 'Lecture notes',
    icon: '📝',
    type: 'note',
    tags: ['lecture'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Lecture — <Topic>',
      content:
        '## Key concepts\n- \n\n## Definitions\n- \n\n## Examples\n- \n\n## Questions to ask\n- \n\n## Homework / next steps\n- ',
      tags: ['lecture'],
      type: 'note',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'revision',
    label: 'Revision sheet',
    icon: '📄',
    type: 'note',
    tags: ['revision'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Revision sheet — <Topic>',
      content:
        '## Must-know facts\n1. \n2. \n3. \n\n## Common mistakes\n- \n\n## Formulae / shortcuts\n- \n\n## 3 practice questions\n1. \n2. \n3. ',
      tags: ['revision'],
      type: 'note',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'exam-checklist',
    label: 'Exam checklist',
    icon: '✅',
    type: 'project',
    tags: ['exam', 'checklist'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Exam checklist — <Exam name>',
      content:
        '## Before the exam\n- [ ] Review all lecture notes\n- [ ] Complete practice paper\n- [ ] Summarise weak topics\n- [ ] Pack calculator / ID / stationery\n\n## Weak topics to attack\n- \n\n## Done when\n- [ ] Scored target on a past paper',
      tags: ['exam', 'checklist'],
      type: 'project',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'exam-prep',
    label: 'Exam prep',
    icon: '📚',
    type: 'project',
    tags: ['exam', 'preparation'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Exam prep — <Subject / Exam>',
      content:
        '## Exam details\n- Date: \n- Location: \n- Format: \n\n## Topics to cover\n- [ ] \n- [ ] \n- [ ] \n\n## Study schedule\n| Day | Topic | Method |\n|-----|-------|--------|\n|     |       |        |\n\n## Practice resources\n- Past papers: \n- Flashcards: \n- Study groups: \n\n## Final checklist\n- [ ] Review all notes\n- [ ] Complete at least 2 past papers\n- [ ] Test myself on weak areas\n- [ ] Sleep well night before',
      tags: ['exam', 'preparation'],
      type: 'project',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'essay-outline',
    label: 'Essay outline',
    icon: '✍️',
    type: 'note',
    tags: ['essay', 'writing'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Essay outline — <Topic>',
      content:
        '## Thesis statement\n\n## Introduction\n- Hook: \n- Context: \n- Thesis: \n\n## Body paragraphs\n### Paragraph 1 — <Point>\n- Evidence: \n- Analysis: \n\n### Paragraph 2 — <Point>\n- Evidence: \n- Analysis: \n\n### Paragraph 3 — <Point>\n- Evidence: \n- Analysis: \n\n## Counter-arguments\n- \n- Rebuttal: \n\n## Conclusion\n- Restate thesis: \n- Key takeaways: \n- Closing thought: \n\n## Sources\n- ',
      tags: ['essay', 'writing'],
      type: 'note',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'research-paper',
    label: 'Research paper',
    icon: '🔬',
    type: 'article',
    tags: ['research', 'paper'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Research paper — <Topic>',
      content:
        '## Title\n\n## Abstract\n\n## Introduction\n- Research question: \n- Motivation: \n- Hypothesis: \n\n## Literature review\n- \n- \n\n## Methodology\n- Approach: \n- Data sources: \n- Limitations: \n\n## Results\n- Finding 1: \n- Finding 2: \n- Finding 3: \n\n## Discussion\n- Interpretation: \n- Implications: \n- Future work: \n\n## References\n- ',
      tags: ['research', 'paper'],
      type: 'article',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
  {
    id: 'meeting-notes',
    label: 'Meeting notes',
    icon: '👥',
    type: 'note',
    tags: ['meeting', 'notes'],
    build: (folderId = 'default') => ({
      id: uid(),
      title: 'Meeting notes — <Date / Topic>',
      content:
        '## Attendees\n- \n- \n\n## Agenda\n1. \n2. \n3. \n\n## Discussion points\n### Topic 1\n- \n\n### Topic 2\n- \n\n## Decisions made\n- [ ] \n- [ ] \n\n## Action items\n| Owner | Task | Deadline |\n|-------|------|----------|\n|       |      |          |\n\n## Next meeting\n- Date: \n- Agenda preview: ',
      tags: ['meeting', 'notes'],
      type: 'note',
      folderId,
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    }),
  },
];

export function buildStarterNotes(): Note[] {
  return [
    {
      id: uid(),
      title: '📚 My study plan',
      content:
        '## This week\n- [ ] Pick 1 topic per subject\n- [ ] Make flashcards from lecture notes\n- [ ] Do one practice paper\n\n## Subjects\n- Mathematics\n- Sciences\n- Computer Science\n\n## Goal\nBeat last exam score by reviewing 20 min/day.',
      tags: ['plan', 'study'],
      type: 'project',
      folderId: 'default',
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    },
    {
      id: uid(),
      title: 'Revision sheet — Example topic',
      content:
        '## Must-know facts\n1. \n2. \n3. \n\n## Common mistakes\n- \n\n## 3 practice questions\n1. \n2. \n3. ',
      tags: ['revision', 'example'],
      type: 'note',
      folderId: 'subject-science',
      createdAt: now(),
      updatedAt: now(),
      files: [], highlights: [], personalNotes: [],
    },
  ];
}

export function buildStarterFlashcards(): Flashcard[] {
  const mk = (q: string, a: string, tags: string[]): Flashcard => ({
    id: uid(),
    question: q,
    answer: a,
    tags,
    createdAt: now(),
    updatedAt: now(),
    folderId: 'default',
    difficulty: 'medium',
    nextReview: now(),
    interval: 0,
    repetitions: 0,
    ef: 2.5,
  });
  return [
    mk('What is spaced repetition?', 'A study technique that reviews material at increasing intervals to fight the forgetting curve.', ['srs']),
    mk('What does SM-2 schedule?', 'The next review date based on how well you recalled a card (quality of response).', ['srs']),
    mk('Why make your own flashcards?', 'Active recall while writing strengthens memory more than passive reading.', ['study']),
    mk('What is a good daily study habit?', 'Short, frequent sessions (20–30 min) beat one long cram the night before.', ['study']),
  ];
}

export interface StarterPack {
  folders: Folder[];
  notes: Note[];
  flashcards: Flashcard[];
}

export function buildStarterPack(): StarterPack {
  return {
    folders: buildSubjectFolders(),
    notes: buildStarterNotes(),
    flashcards: buildStarterFlashcards(),
  };
}
