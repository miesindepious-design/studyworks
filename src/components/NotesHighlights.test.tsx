/**
 * Notes — making flashcards from highlights.
 *
 * The conversion logic itself is tested in `utils/highlightsToCards.test.ts`.
 * What matters here is that the button in the Highlights panel is actually
 * wired to it: clicking "Make cards" has to add cards to the student's
 * collection, and it has to say so.
 *
 * There is no testing-library in this project, so the component is driven
 * directly through `react-dom/client` and React 19's `act` — the same
 * pattern the admin dashboard test uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import NotesView from './NotesView';
import type { Flashcard, Note } from '../types';

// The notes view reaches for the AI layer, the file APIs and the sync API.
// None of that is involved in turning highlights into cards, so it is stubbed
// out and the test only exercises the path it cares about.
vi.mock('../api/ai', () => ({
  fetchAISettings: vi.fn().mockResolvedValue(null),
  saveAISettings: vi.fn().mockResolvedValue({}),
  testAIKey: vi.fn().mockResolvedValue({ ok: false }),
  serverSummary: vi.fn().mockResolvedValue(''),
  serverFlashcards: vi.fn().mockResolvedValue([]),
  serverPracticeQuestions: vi.fn().mockResolvedValue([]),
  serverQA: vi.fn().mockResolvedValue(''),
  serverRerank: vi.fn().mockResolvedValue([]),
  serverInsights: vi.fn().mockResolvedValue({ insights: [] }),
  serverTutor: vi.fn().mockResolvedValue({ answer: '', keyPoints: [] }),
  serverAnalyzeDocuments: vi.fn().mockResolvedValue({}),
  fetchStudentProfile: vi.fn().mockResolvedValue(null),
  saveStudentProfile: vi.fn().mockResolvedValue({}),
  saveFullStudentProfile: vi.fn().mockResolvedValue({}),
}));

vi.mock('../api/attachments', () => ({
  uploadFile: vi.fn(),
  deleteRemoteAttachment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/notes', () => ({
  deleteNote: vi.fn().mockResolvedValue(undefined),
  bulkDeleteNotes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/phase2', () => ({
  unfurlUrl: vi.fn(),
}));

vi.mock('../game/ProgressionContext', () => ({
  useProgression: () => ({ award: vi.fn(), syncStats: vi.fn() }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE: Note = {
  id: 'n1',
  title: 'Working memory & recall',
  content: 'Some study notes.',
  tags: ['exam'],
  type: 'note',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  highlights: [
    { id: 'hl1', text: 'Working memory holds roughly four chunks at any one moment.', color: '#fde68a', createdAt: new Date('2026-01-01') },
    { id: 'hl2', text: 'Chunking is the strategy of grouping individual items into larger units.', color: '#bbf7d0', createdAt: new Date('2026-01-01') },
  ],
};

const addToast = vi.fn();

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let flashcards: Flashcard[] = [];
  const setFlashcards = (next: Flashcard[]) => { flashcards = next; };

  const notes = [NOTE];
  const setNotes = (next: Note[]) => { notes.splice(0, notes.length, ...next); };

  await act(async () => {
    root.render(createElement(NotesView, {
      notes,
      setNotes,
      flashcards,
      setFlashcards,
      tier: 'pro',
      setCurrentView: vi.fn(),
      addToast,
      totalItems: 1,
      incrementAiSummaries: vi.fn(),
      aiSummariesThisMonth: 0,
      folders: [{ id: 'default', name: 'All Items', createdAt: new Date('2026-01-01') }],
      setFolders: vi.fn(),
      practiceQuestions: [],
      setPracticeQuestions: vi.fn(),
      incrementQaQueries: vi.fn(),
      qaQueriesThisMonth: 0,
      savedSearches: [],
      setSavedSearches: vi.fn(),
      ai: {
        isReady: false,
        reloadConfig: vi.fn(),
        config: { provider: 'gemini', model: '', enabled: false, apiKey: '' },
        source: 'none',
        serverManaged: false,
        hasOwnKey: false,
        generateSummary: vi.fn(),
        generateFlashcards: vi.fn(),
        generatePracticeQuestions: vi.fn(),
        smartQA: vi.fn(),
        semanticSearch: vi.fn(),
        generateWeeklyInsights: vi.fn(),
        runCustomPrompt: vi.fn(),
        analyzeDocuments: vi.fn(),
      },
      loadStarterPack: vi.fn(),
      documents: [],
      setDocuments: vi.fn(),
    }));
  });
  await flush();

  // Open the note's detail panel, which is where the Highlights section lives.
  await act(async () => {
    const more = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').includes('More'));
    more?.click();
  });
  await flush();

  return { container, root, getFlashcards: () => flashcards };
}

function buttonByText(container: HTMLElement, needle: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes(needle));
  if (!match) throw new Error(`No button matching "${needle}"`);
  return match as HTMLButtonElement;
}

describe('Notes — make cards from highlights', () => {
  beforeEach(() => {
    addToast.mockClear();
  });

  it('offers the button once a note has highlights', async () => {
    const { container, root } = await mount();
    expect(buttonByText(container, 'Make cards')).toBeTruthy();
    await act(async () => { root.unmount(); });
  });

  it('adds a card for each highlight when clicked', async () => {
    const { container, root, getFlashcards } = await mount();

    await act(async () => {
      buttonByText(container, 'Make cards').click();
    });
    await flush();

    expect(getFlashcards()).toHaveLength(2);
    await act(async () => { root.unmount(); });
  });

  it('tags the new cards so they can be found again', async () => {
    const { container, root, getFlashcards } = await mount();

    await act(async () => {
      buttonByText(container, 'Make cards').click();
    });
    await flush();

    const cards = getFlashcards();
    expect(cards[0].tags).toContain('highlight');
    expect(cards[0].tags).toContain('exam');
    expect(cards[0].source).toBe('note');
    await act(async () => { root.unmount(); });
  });

  it('tells the student how many cards were made', async () => {
    const { container, root } = await mount();

    await act(async () => {
      buttonByText(container, 'Make cards').click();
    });
    await flush();

    const message = addToast.mock.calls.map(c => c[0]).join(' ');
    expect(message).toContain('2 cards');
    expect(addToast.mock.calls.some(c => c[1] === 'success')).toBe(true);
    await act(async () => { root.unmount(); });
  });
});
