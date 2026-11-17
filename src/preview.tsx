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
import ShortcutsModal from './components/ShortcutsModal';
import Onboarding from './components/Onboarding';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch, StudyDocument } from './types';
import type { UseAIResult } from './hooks/useAI';
import { PAGE_TITLES } from './config/nav';

const param = new URLSearchParams(location.search);
const VIEW: string = param.get('view') ?? 'dashboard';
const IS_DARK = param.has('dark');
// Which diagram tier the mocked tutor answers with: 'line' (cheap plain
// text) or 'svg' (the expensive full picture).
const DIAGRAM_KIND: string = param.get('diagram') ?? 'svg';
const noop = () => {};

/**
 * Preview-only mock of the tutor endpoint.
 *
 * The sample answer is deliberately messy — raw LaTeX, markdown headers and
 * table pipes — so the formatting pass (utils/aiText) can be inspected
 * without an AI key. Dev-only: preview.tsx never ships in the bundle.
 */
const MESSY_TUTOR_ANSWER = `## Photosynthesis

**Photosynthesis** is how green plants turn $CO_2$ and water into glucose using light energy:

$$6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2$$

### The two stages

- **Light reactions** — chlorophyll ($\\alpha$ and $\\beta$) absorbs photons in the thylakoid
- **Calvin cycle** — $\\frac{1}{6}$ of the carbon is fixed per turn, in the stroma
- Energy stored per molecule: $E = mc^2$

> Common exam trap: students mix up the light-dependent and light-independent reactions.

| Stage | Location | Main product |
| --- | --- | --- |
| Light reactions | Thylakoid membrane | ATP + NADPH |
| Calvin cycle | Chloroplast stroma | G3P (glucose precursor) |

### Misconceptions to avoid

1. Saying respiration only happens in the dark — it happens all the time.
2. Confusing $\\Delta$ (change) with $d$ (a derivative).
3. Believing plants get energy from soil rather than sunlight.

\`\`\`
6CO2 + 6H2O -> C6H12O6 + 6O2
\`\`\`

So the answer is simple: light in, sugar out.`;

const LINE_DIAGRAM_TUTOR_ANSWER = `Here is the two-stage flow you asked for.

\`\`\`diagram
  Sunlight + H2O
        │
        ▼
  ┌──────────────────┐                  ┌──────────────────┐
  │  Light reactions │ ───────────────→ │   Calvin cycle   │
  │   (thylakoid)    │                  │    (stroma)      │
  └──────────────────┘                  └──────────────────┘
        │                                     │
       O2 released                          G3P → glucose
\`\`\`

**How to read it:** light hits the thylakoid membrane, where the light reactions make ATP and NADPH. Those feed the Calvin cycle in the stroma, which fixes carbon dioxide into G3P — the sugar that stores the energy. Oxygen leaves as a by-product.`;

const PHOTOSYNTHESIS_DIAGRAM = `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="pv-arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
      <path d="M0 0 L10 5 L0 10 Z" fill="#555"/>
    </marker>
  </defs>
  <rect x="240" y="110" width="200" height="80" rx="12" fill="#dcfce7" stroke="#15803d" stroke-width="2"/>
  <text x="270" y="145" font-size="15" font-weight="bold" fill="#14532d">Chloroplast</text>
  <text x="268" y="170" font-size="12" fill="#166534">in the leaf cell</text>
  <rect x="20" y="40" width="150" height="46" rx="10" fill="#fef9c3" stroke="#ca8a04" stroke-width="2"/>
  <text x="42" y="68" font-size="14" fill="#422006">Sunlight</text>
  <rect x="20" y="210" width="150" height="46" rx="10" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="30" y="230" font-size="13" fill="#1e3a8a">Water (H2O)</text>
  <text x="34" y="248" font-size="11" fill="#1e40af">from the roots</text>
  <rect x="510" y="40" width="150" height="46" rx="10" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/>
  <text x="528" y="68" font-size="14" fill="#7f1d1d">Oxygen (O2)</text>
  <rect x="510" y="210" width="150" height="46" rx="10" fill="#f3e8ff" stroke="#9333ea" stroke-width="2"/>
  <text x="524" y="230" font-size="13" fill="#581c87">Glucose</text>
  <text x="536" y="248" font-size="11" fill="#6b21a8">stored energy</text>
  <path d="M170 63 L 240 120" stroke="#555" stroke-width="2" marker-end="url(#pv-arrow)"/>
  <path d="M170 233 L 240 180" stroke="#555" stroke-width="2" marker-end="url(#pv-arrow)"/>
  <path d="M440 120 L 510 63" stroke="#555" stroke-width="2" marker-end="url(#pv-arrow)"/>
  <path d="M440 180 L 510 233" stroke="#555" stroke-width="2" marker-end="url(#pv-arrow)"/>
  <text x="185" y="82" font-size="11" fill="#555">light energy</text>
  <text x="180" y="218" font-size="11" fill="#555">absorbed</text>
  <text x="452" y="82" font-size="11" fill="#555">by-product</text>
  <text x="448" y="218" font-size="11" fill="#555">sugar made</text>
  <text x="230" y="290" font-size="12" fill="#555">6CO2 + 6H2O -> C6H12O6 + 6O2</text>
</svg>`;

const DIAGRAM_TUTOR_ANSWER = `Here is the diagram of photosynthesis you asked for.

\`\`\`svg
${PHOTOSYNTHESIS_DIAGRAM}
\`\`\`

**How to read it:** sunlight and water arrive at the chloroplast (green box) — the factory where the light reactions run. Oxygen leaves as a by-product, and glucose is the sugar that stores the captured energy.

The two inputs on the left, two outputs on the right — that's the whole reaction in one picture.`;

const PART_EXPLANATION = `Let's slow down on just that step.

**Restating the part:** the light reactions split water and use the released electrons to make ATP and NADPH.

**Step by step:**
1. Chlorophyll absorbs a photon — an electron gets excited and leaves the molecule.
2. That electron travels down the electron transport chain, losing energy at each step.
3. The lost energy pumps protons (H+) across the thylakoid membrane, building a gradient.
4. The protons flow back through ATP synthase — like water through a turbine — producing ATP.
5. Water fills the electron gap: 2H2O -> 4H+ + 4e- + O2. That's where the oxygen comes from.

**Why it matters:** every ATP your cells spend was charged by this process in the chloroplast.`;

/** Mock accounts for the admin dashboard preview. */
const ADMIN_USERS = [
  {
    id: 'u-1', email: 'alex@studyworks.app', name: 'Alex (admin)', tier: 'PRO' as const,
    emailVerified: true, createdAt: '2025-11-02T09:14:00.000Z',
    stripeSubscriptionId: null, stripeCurrentPeriodEnd: null, stripePriceId: null,
  },
  {
    id: 'u-2', email: 'student@example.com', name: 'Chidi Okonkwo', tier: 'PRO' as const,
    emailVerified: true, createdAt: '2026-01-18T16:02:00.000Z',
    stripeSubscriptionId: 'sub_preview_1', stripeCurrentPeriodEnd: '2026-12-01T00:00:00.000Z',
    stripePriceId: 'price_pro_monthly',
  },
  {
    id: 'u-3', email: 'nora@example.com', name: 'Nora Haddad', tier: 'FREE' as const,
    emailVerified: true, createdAt: '2026-03-05T11:47:00.000Z',
    stripeSubscriptionId: null, stripeCurrentPeriodEnd: null, stripePriceId: null,
  },
];

if (typeof window !== 'undefined') {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/ai/tutor')) {
      // The instruction rider tells the preview which answer to serve:
      // diagram ask, explain-a-part ask, or the default messy lesson.
      // Match loosely — keying off one exact phrase meant that rewording
      // the button's instruction silently served the wrong answer.
      let body: any = null;
      try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
      const instruction: string = body?.instruction ?? '';
      const isPartAsk = instruction.includes('does not understand a specific part');
      const isDiagramAsk = !isPartAsk && /diagram/i.test(instruction);
      const response = isDiagramAsk
        ? (DIAGRAM_KIND === 'line' ? LINE_DIAGRAM_TUTOR_ANSWER : DIAGRAM_TUTOR_ANSWER)
        : isPartAsk
          ? PART_EXPLANATION
          : MESSY_TUTOR_ANSWER;
      return Promise.resolve(new Response(
        JSON.stringify({
          topic: 'Photosynthesis',
          mode: 'lesson',
          educationLevel: null,
          response,
          keyPoints: [
            { point: 'Photosynthesis converts light energy into chemical energy stored in glucose.', why: 'It is the single idea the whole chapter is built on.', importance: 'must-know' },
            { point: 'The light reactions happen in the thylakoid membrane and produce ATP and NADPH.', why: 'You must know where each stage happens for diagram questions.', importance: 'must-know' },
            { point: 'The Calvin cycle fixes carbon dioxide in the chloroplast stroma.', why: 'Confusing the two stages is the most common exam trap.', importance: 'should-know' },
            { point: 'Chlorophyll absorbs red and blue light but reflects green light.', why: 'Explains why leaves look green — a favourite short question.', importance: 'good-to-know' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    // Document analysis — a representative briefing for the uploaded file.
    if (url.includes('/api/ai/document/analyze')) {
      return Promise.resolve(new Response(
        JSON.stringify({
          title: 'Photosynthesis and Plant Energy',
          overview: '## What this chapter covers\nThis chapter explains how plants convert light energy into chemical energy, and how that energy powers everything else a plant does.\n\n## How to revise it\nLearn the two stages in order, then practise drawing the pathway from memory.',
          keyPoints: [
            { point: 'Light energy is converted into chemical energy stored in glucose.', why: 'The central claim of the whole chapter.', importance: 'must-know' },
            { point: 'The light reactions produce ATP and NADPH in the thylakoid membrane.', why: 'You need both products and their location for diagram questions.', importance: 'must-know' },
            { point: 'The Calvin cycle fixes carbon dioxide into G3P in the stroma.', why: 'Mixing up the two stages is the most common exam trap.', importance: 'must-know' },
            { point: 'Chlorophyll absorbs red and blue light but reflects green.', why: 'A short question that appears almost every year.', importance: 'should-know' },
            { point: 'Photolysis of water releases oxygen as a by-product.', why: 'Explains where the oxygen you breathe comes from.', importance: 'should-know' },
            { point: 'Limiting factors are carbon dioxide concentration and light intensity.', why: 'Sets up the classic graph questions.', importance: 'good-to-know' },
          ],
          outline: [
            { heading: 'Light-dependent reactions', detail: 'In the thylakoid membrane; splits water and makes ATP and NADPH.' },
            { heading: 'The Calvin cycle', detail: 'In the stroma; fixes carbon dioxide into G3P using ATP and NADPH.' },
            { heading: 'Limiting factors', detail: 'How carbon dioxide and light intensity change the rate.' },
          ],
          glossary: [
            { term: 'Thylakoid', meaning: 'A membrane sac inside the chloroplast where the light reactions happen.' },
            { term: 'Stroma', meaning: 'The fluid around the thylakoids where the Calvin cycle happens.' },
            { term: 'Photolysis', meaning: 'The splitting of water by light, which releases oxygen.' },
          ],
          questions: [
            'Explain the light-dependent reactions and where they occur.',
            'Why are leaves green?',
            'Compare the light reactions and the Calvin cycle in a table.',
            'How does increasing carbon dioxide affect the rate of photosynthesis?',
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    // No key on the mock account → the onboarding key step shows.
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve(new Response(
        JSON.stringify({
          provider: 'gemini', model: 'gemini-4-hydrogen', enabled: false,
          hasApiKey: false, hasOwnKey: false, serverManaged: false, canUseAI: false,
          customSummaryPrompt: null, customFlashcardPrompt: null, customQAPrompt: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    // "Test connection" succeeds for any non-empty key in the preview.
    if (url.includes('/api/ai/test')) {
      return Promise.resolve(new Response(
        JSON.stringify({ ok: true, provider: 'gemini', model: 'gemini-4-hydrogen', reply: 'OK' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    // Admin dashboard — a mock account list so the delete-account flow can be
    // inspected without a live server or database.
    if (url.includes('/api/admin')) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const json = (body: unknown) => new Response(
        JSON.stringify(body),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
      if (method === 'GET' && url.includes('/api/admin/stats')) {
        return Promise.resolve(json({ total: 3, pro: 2, free: 1 }));
      }
      if (method === 'GET' && /\/api\/admin\/users\/[^/?]+$/.test(url)) {
        return Promise.resolve(json({
          user: ADMIN_USERS[1],
          counts: {
            notes: 24, folders: 5, contacts: 11, flashcards: 48, practiceQuestions: 16,
            savedSearches: 7, attachments: 9, gameRooms: 2, supportTickets: 1,
          },
        }));
      }
      if (method === 'GET' && url.includes('/api/admin/users')) {
        return Promise.resolve(json({ users: ADMIN_USERS }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(json({
          deleted: { id: 'u-2', email: 'student@example.com' },
          filesRemoved: 9,
          warnings: [],
        }));
      }
    }
    return realFetch(input, init);
  }) as typeof window.fetch;
}

const now = Date.now();
const day = 86400000;

const folders: Folder[] = [
  { id: 'f1', name: 'Cognitive psychology', createdAt: new Date(now - 40 * day) },
  { id: 'f2', name: 'Linear algebra', createdAt: new Date(now - 30 * day) },
  { id: 'f3', name: 'Design thinking', createdAt: new Date(now - 20 * day) },
];

const documents: StudyDocument[] = [
  {
    id: 'doc-1',
    name: 'Biology — Chapter 4: Cell Structure.pdf',
    kind: 'pdf',
    size: 1_240_000,
    text: 'Cells are the basic structural units of living organisms. The cell membrane, cytoplasm, nucleus and organelles each play a role. Mitochondria produce ATP through cellular respiration. Ribosomes synthesise proteins. Plant cells additionally contain chloroplasts and a cellulose cell wall.## Analysed briefing (from AI Tutor)\nOverview: Chapter 4 covers the structure and function of eukaryotic cells, comparing plant and animal cells and walking through each organelle.\n\nKey points://n- (must-know) The cell membrane is a selectively permeable phospholipid bilayer — it controls what enters and leaves the cell, which is why transport mechanisms are heavily examined.\n- (must-know) Mitochondria are the site of aerobic respiration and produce ATP.\n- (should-know) Ribosomes build proteins; rough ER folds and ships them.\n\nOutline://n1. Cell theory\n2. Membrane structure and transport\n3. Organelles and their functions\n\nGlossary://n- Osmosis: diffusion of water across a semi-permeable membrane.\n\nExam questions://n1. Explain how the structure of the cell membrane relates to its function.\n',
    pages: 24,
    truncated: false,
    analysis: {
      title: 'Biology — Chapter 4: Cell Structure',
      overview: 'Chapter 4 covers the structure and function of eukaryotic cells, comparing plant and animal cells and walking through every organelle you need to label on an exam diagram.',
      keyPoints: [
        { point: 'The cell membrane is a selectively permeable phospholipid bilayer.', why: 'It controls what enters and leaves the cell — transport is a favourite exam topic.', importance: 'must-know' },
        { point: 'Mitochondria are the site of aerobic respiration and produce ATP.', why: 'Energy transfer questions come up almost every year.', importance: 'must-know' },
        { point: 'Ribosomes build proteins; rough ER folds and ships them.', why: 'Common mix-up with smooth ER — know the difference.', importance: 'should-know' },
        { point: 'Only plant cells have chloroplasts and a cellulose cell wall.', why: 'The classic plant-vs-animal cell comparison.', importance: 'good-to-know' },
      ],
      outline: [
        { heading: 'Cell theory', detail: 'All living things are made of cells; cells come from pre-existing cells.' },
        { heading: 'Membrane structure and transport', detail: 'Diffusion, osmosis, active transport.' },
        { heading: 'Organelles and their functions', detail: 'Nucleus, mitochondria, ribosomes, ER, chloroplasts, vacuole.' },
      ],
      glossary: [
        { term: 'Osmosis', meaning: 'Diffusion of water across a semi-permeable membrane.' },
        { term: 'Organelle', meaning: 'A specialised structure inside a cell with a specific job.' },
      ],
      questions: [
        'Explain how the structure of the cell membrane relates to its function.',
        'Compare plant and animal cells.',
      ],
    },
    source: 'tutor' as const,
    createdAt: new Date('2026-11-14T09:00:00'),
    updatedAt: new Date('2026-11-15T17:30:00'),
  },
  {
    id: 'doc-2',
    name: 'History — Cold War timelines.docx',
    kind: 'docx',
    size: 480_000,
    text: 'The Cold War (1947–1991) was a period of geopolitical tension between the USA and the USSR. Key events: the Truman Doctrine (1947), the Berlin Blockade (1948–49), the Cuban Missile Crisis (1962), détente, and the fall of the Berlin Wall (1989).',
    pages: 8,
    truncated: false,
    analysis: null,
    source: 'library' as const,
    createdAt: new Date('2026-11-15T11:20:00'),
    updatedAt: new Date('2026-11-15T11:20:00'),
  },
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
/**
 * Onboarding preview — onComplete flips a visible flag so audits can verify
 * that finishing the flow (saving the key / skipping) actually closes it.
 */
function OnboardingPreview() {
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);
  if (done) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center' }} data-testid="onboarding-done">
        <h2>ONBOARDING-COMPLETE</h2>
        <p>{saved ? 'KEY-SAVED' : 'KEY-SKIPPED'}</p>
      </div>
    );
  }
  return (
    <Onboarding
      onComplete={() => setDone(true)}
      onAISaved={() => setSaved(true)}
      onLoadStarterPack={noop}
    />
  );
}

/**
 * Onboarding preview marker.
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
  const [docs, setDocs] = useState<StudyDocument[]>(documents);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
          documents={docs} setDocuments={setDocs}
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
      case 'onboarding': return <OnboardingPreview />;
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
    <>
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
      profileUser={{
        id: 'u1', email: 'alex@studyworks.app', name: 'Alex Morgan',
        emailVerified: true, tier: 'PRO', image: null,
        createdAt: new Date().toISOString(),
      }}
      tierLabel="Pro plan"
      sidebarExtra={(
        <div className="sw-side-deck">
          <div className="sw-side-deck-row">
            <button type="button" className="sw-deck-btn sw-deck-theme">🌙 <span>Dark</span></button>
            <button type="button" className="sw-deck-btn sw-deck-icon">⬇</button>
            <button type="button" className="sw-deck-btn sw-deck-icon">⬆</button>
          </div>
            <button type="button" className="sw-deck-btn sw-deck-wide" onClick={() => setShortcutsOpen(true)}>
              <span>Shortcuts</span>
              <span className="sw-deck-dots" aria-hidden="true">···</span>
            </button>
        </div>
      )}
    >
      {view}
    </AppShell>

    {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
