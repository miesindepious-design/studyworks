/**
 * Preview harness — renders the real AppShell with mock data so the redesign
 * can be inspected without signing in. Dev-only; not part of the production
 * bundle (it is never imported by main.tsx).
 *
 * Pick a page with ?view=<id> (defaults to the dashboard) and flip the theme
 * with &dark. Every view gets the same mock library, so a page that reads
 * from IndexedDB on the real app renders populated here.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import './index.css';
// Same cascade as App.tsx — the preview has to load the full stack, or
// buttons, tags, toggles and the docked chip render unstyled.
import './App.css';
import './compat.css';
import './design.css';
import AppShell from './components/AppShell';
import Dashboard from './components/Dashboard';
import SettingsView from './components/SettingsView';
import NotesView from './components/NotesView';
import ContactsView from './components/ContactsView';
import FlashcardsView from './components/FlashcardsView';
import StudyTimer from './components/StudyTimer';
import TutorView from './components/TutorView';
import StudyRoom from './components/StudyRoom';
import MultiplayerQuiz from './components/MultiplayerQuiz';
import PricingView from './components/PricingView';
import AdminDashboard from './components/AdminDashboard';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from './types';
import type { UseAIResult } from './hooks/useAI';
import { PAGE_TITLES } from './config/nav';

const param = new URLSearchParams(location.search);
const VIEW: string = param.get('view') ?? 'dashboard';
const IS_DARK = param.has('dark');
const noop = () => {};

const now = Date.now();
const day = 86400000;

const folders: Folder[] = [
  { id: 'f1', name: 'Cognitive psychology', createdAt: new Date(now - 40 * day) },
  { id: 'f2', name: 'Linear algebra', createdAt: new Date(now - 30 * day) },
  { id: 'f3', name: 'Design thinking', createdAt: new Date(now - 20 * day) },
];

const notes: Note[] = Array.from({ length: 14 }, (_, i) => ({
  id: `n${i}`,
  title: ['Working memory & recall', 'Attention residue', 'Matrix spaces', 'Eigenvectors', 'Design critique notes'][i % 5],
  content: 'A short body of study notes so cards and previews have something to show.',
  tags: i % 3 === 0 ? ['exam'] : [],
  type: (['note', 'article', 'idea', 'project'] as const)[i % 4],
  createdAt: new Date(now - (i + 1) * day),
  updatedAt: new Date(now - i * day),
  folderId: folders[i % 3].id,
}));

const flashcards: Flashcard[] = Array.from({ length: 26 }, (_, i) => ({
  id: `c${i}`,
  question: `What is the capacity of working memory?`,
  answer: 'Roughly four chunks, plus or minus one.',
  tags: [],
  createdAt: new Date(now - (i + 2) * day),
  updatedAt: new Date(now - i * day),
  folderId: folders[i % 3].id,
  repetitions: i % 4,
  nextReview: i % 3 === 0 ? new Date(now - day) : new Date(now + 3 * day),
}));

const contacts: Contact[] = [
  {
    id: 'p1', name: 'Dr. Alvarez', role: 'Lecture tutor', tags: [],
    createdAt: new Date(now - 20 * day), nextReminder: new Date(now - 2 * 3600000),
  },
  {
    id: 'p2', name: 'Sam Okafor', role: 'Study group', tags: [],
    createdAt: new Date(now - 15 * day), nextReminder: new Date(now + 3600000),
  },
];

const practiceQuestions: PracticeQuestion[] = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i}`,
  question: `Explain spaced repetition in one sentence.`,
  answer: 'Review material at widening intervals to beat the forgetting curve.',
  type: 'open' as const,
  noteId: notes[i].id,
  createdAt: new Date(now - (i + 1) * day),
}));

const savedSearches: SavedSearch[] = [
  { id: 's1', name: 'Exam prep', query: 'exam', createdAt: new Date(now - 5 * day) },
];

/** A stand-in for useAI: enough shape for the views to render populated. */
const mockAI = {
  isReady: true,
  reloadConfig: async () => {},
  config: { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true, apiKey: '' },
  source: 'none',
  serverManaged: false,
  generateSummary: async () => 'A generated summary would appear here.',
  generateFlashcards: async () => [],
  generatePracticeQuestions: async () => [],
  smartQA: async () => 'A generated answer would appear here.',
  semanticSearch: async () => notes.slice(0, 3),
  generateWeeklyInsights: async () => ({
    summary: '',
    topTopics: [],
    suggestedFocus: '',
  }),
  runCustomPrompt: async () => 'A generated answer would appear here.',
} as unknown as UseAIResult;

const mockDb = { xp: 420, setXp: noop };

const dailyCounts: Record<string, number> = {};
for (let i = 0; i < 70; i++) {
  const d = new Date(now - i * day).toISOString().slice(0, 10);
  dailyCounts[d] = (i * 7) % 11;
}

/** Seed the streak store so the preview shows a populated workspace. */
async function seedStreak() {
  try {
    const { getDB } = await import('./db/schema');
    const db = await getDB();
    await db.put('streaks', {
      id: 'singleton',
      lastReviewDate: new Date().toISOString().slice(0, 10),
      currentStreak: 7,
      longestStreak: 19,
      totalReviews: 284,
      dailyCounts,
    });
    window.dispatchEvent(new Event('focus'));
  } catch (err) {
    console.warn('[preview] streak seed skipped', err);
  }
}

if (IS_DARK) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

// The streak store is seeded before the first paint so the settings rail
// shows a populated streak instead of zero.
await seedStreak();

/**
 * Holds the accent + theme in local state so the swatches and theme tiles
 * in Settings actually do something in the preview.
 */
function Preview() {
  const [accent, setAccent] = useState('sunset');
  const [theme, setTheme] = useState('light');
  const [noteList, setNoteList] = useState(notes);
  const [contactList, setContactList] = useState(contacts);
  const [cardList, setCardList] = useState(flashcards);
  const [questions, setQuestions] = useState(practiceQuestions);
  const [searches, setSearches] = useState(savedSearches);
  const [folderList, setFolderList] = useState(folders);

  const shared = {
    tier: 'pro' as const,
    setCurrentView: noop,
    addToast: noop,
    totalItems: 46,
    folders: folderList,
    setFolders: setFolderList,
  };

  const view = (() => {
    switch (VIEW) {
      case 'notes': return (
        <NotesView
          notes={noteList} setNotes={setNoteList}
          flashcards={cardList} setFlashcards={setCardList}
          practiceQuestions={questions} setPracticeQuestions={setQuestions}
          savedSearches={searches} setSavedSearches={setSearches}
          incrementAiSummaries={noop} aiSummariesThisMonth={12}
          incrementQaQueries={noop} qaQueriesThisMonth={4}
          ai={mockAI} loadStarterPack={noop}
          {...shared}
        />
      );
      case 'contacts': return (
        <ContactsView contacts={contactList} setContacts={setContactList} {...shared} />
      );
      case 'flashcards': return (
        <FlashcardsView
          flashcards={cardList} setFlashcards={setCardList}
          practiceQuestions={questions} setPracticeQuestions={setQuestions}
          {...shared}
        />
      );
      case 'timer': return <StudyTimer />;
      case 'tutor': return (
        <TutorView notes={noteList} onSaveNote={noop} {...shared} />
      );
      case 'studyRoom': return (
        <StudyRoom userId="u1" userName="Alex Morgan" {...shared} />
      );
      case 'multiplayer': return (
        <MultiplayerQuiz db={mockDb} userId="u1" userName="Alex Morgan" {...shared} />
      );
      case 'pricing': return (
        <PricingView currentTier="pro" onDowngrade={noop} onCheckoutResult={noop} addToast={noop} />
      );
      case 'admin': return <AdminDashboard adminEmail="alex@studyworks.app" addToast={noop} />;
      case 'settings': return (
        <SettingsView
          notif={{ permission: 'default', request: async () => 'default', notify: noop, supported: true }}
          onAddToast={noop}
          onAISaved={noop}
          onShowShortcuts={noop}
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
          data={{ notes: noteList, contacts: contactList, flashcards: cardList, practiceQuestions: questions, savedSearches: searches }}
          displayName="Alex Morgan"
          {...shared}
        />
      );
      default: return (
        <Dashboard
          userName="Alex"
          trialDaysLeft={0}
          notes={noteList}
          contacts={contactList}
          flashcards={cardList}
          aiSummariesThisMonth={12}
          qaQueriesThisMonth={4}
          practiceQuestions={questions}
          aiReady={true}
          aiProvider="gemini"
          onGenerateInsights={noop}
          weeklyInsights={null}
          insightsLoading={false}
          {...shared}
        />
      );
    }
  })();

  return (
    <AppShell
      currentView={VIEW as never}
      onNavigate={noop}
      pageTitle={PAGE_TITLES[VIEW as keyof typeof PAGE_TITLES] ?? 'Dashboard'}
      userName="Alex Morgan"
      userEmail="alex@studyworks.app"
      userSub="Cognitive psychology · Level 3"
      tier="pro"
      trialDaysLeft={0}
      totalItems={46}
      notesCount={noteList.length}
      dueFlashcards={cardList.filter(c => c.nextReview && c.nextReview <= new Date()).length}
      accentId={accent}
      onAccentChange={setAccent}
      onOpenCommandPalette={noop}
      onOpenPricing={noop}
      onSignOut={noop}
    >
      {view}
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
