/**
 * Preview harness — renders the real AppShell + Dashboard with mock data so
 * the redesign can be inspected without signing in. Dev-only; not part of
 * the production bundle (it is never imported by main.tsx).
 */
import { createRoot } from 'react-dom/client';
import './index.css';
import './design.css';
import AppShell from './components/AppShell';
import Dashboard from './components/Dashboard';
import type { Note, Contact, Flashcard, Folder } from './types';
import SettingsView from './components/SettingsView';

const isSettings = location.search.includes('settings');
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
  content: '',
  tags: [],
  type: (['note', 'article', 'idea', 'project'] as const)[i % 4],
  createdAt: new Date(now - (i + 1) * day),
  updatedAt: new Date(now - i * day),
  folderId: folders[i % 3].id,
}));

const flashcards: Flashcard[] = Array.from({ length: 26 }, (_, i) => ({
  id: `c${i}`,
  question: `Question ${i + 1}`,
  answer: `Answer ${i + 1}`,
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

if (location.search.includes('dark')) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

// The streak store is seeded in the background; the dashboard reloads it
// whenever the window regains focus.
seedStreak();

createRoot(document.getElementById('root')!).render(
  <AppShell
    currentView="dashboard"
    onNavigate={() => {}}
    pageTitle="Dashboard"
    userName="Alex Morgan"
    userEmail="alex@studyworks.app"
    userSub="Cognitive psychology · Level 3"
    tier="pro"
    trialDaysLeft={0}
    totalItems={46}
    notesCount={notes.length}
    dueFlashcards={9}
    accentId="sunset"
    onAccentChange={() => {}}
    onOpenCommandPalette={() => {}}
    onOpenPricing={() => {}}
    onSignOut={() => {}}
  >
    {isSettings ? (
      <SettingsView
        notif={{ permission: 'default', request: async () => 'default', notify: () => {}, supported: true }}
        tier="pro"
        onAddToast={() => {}}
        onShowShortcuts={() => {}}
        folders={folders}
        theme="light"
        onThemeChange={() => {}}
        accent="sunset"
        onAccentChange={() => {}}
        data={{ notes, contacts, flashcards, practiceQuestions: [], savedSearches: [] }}
        displayName="Alex Morgan"
      />
    ) : (
    <Dashboard
      userName="Alex"
      trialDaysLeft={0}
      notes={notes}
      contacts={contacts}
      flashcards={flashcards}
      tier="pro"
      totalItems={46}
      aiSummariesThisMonth={12}
      qaQueriesThisMonth={4}
      folders={folders}
      practiceQuestions={[]}
      setCurrentView={() => {}}
      aiReady={true}
      aiProvider="gemini"
      onGenerateInsights={() => {}}
      weeklyInsights={null}
      insightsLoading={false}
    />
    )}
  </AppShell>,
);
