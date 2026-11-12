/**
 * copilot.ts — the Copilot's knowledge base and matcher.
 *
 * The Copilot answers two kinds of question:
 *   1. "Where do I find X?"  → an article that says which page it lives on
 *      and carries a deep link that navigates the app there.
 *   2. "How do I do X?"       → the same article, but with numbered steps,
 *      plus a task the Copilot can run for you.
 *
 * Everything here is static and local, so the Copilot works for every user,
 * on every plan, with no AI provider configured and no network round-trip.
 * The articles are the single source of truth for where features live — if a
 * feature moves, this file is the only thing that needs updating.
 */
import type { View } from './nav';

/**
 * Every task the Copilot can run. This list is the contract between the
 * knowledge base, the Copilot UI and App.tsx — the switch in App.tsx is
 * exhaustive, so adding an action here without handling it fails the build.
 */
export const COPILOT_ACTION_IDS = [
  'new-note',
  'start-review',
  'start-timer',
  'ask-tutor',
  'toggle-theme',
  'export-data',
  'show-shortcuts',
  'command-palette',
  'sync-now',
] as const;

/** Tasks the Copilot can perform on the user's behalf. */
export type CopilotActionId = (typeof COPILOT_ACTION_IDS)[number];

export interface CopilotArticle {
  id: string;
  /** The question this article answers, phrased as the user would ask it. */
  title: string;
  /** Grouping shown as a small tag on the result card. */
  category: string;
  /** The page this feature lives on — drives the deep link. */
  view?: View;
  /** A task the Copilot can run instead of just navigating. */
  action?: CopilotActionId;
  /** Override for the call-to-action button label. */
  cta?: string;
  /** Words that should match this article. */
  keywords: string[];
  /** Extra spellings and synonyms, matched with lower weight. */
  aliases?: string[];
  /** The one-paragraph answer. */
  summary: string;
  /** How to do it, step by step. */
  steps?: string[];
}

export interface CopilotTask {
  id: CopilotActionId;
  label: string;
  /** Short clarifier shown under the chip. */
  hint: string;
  group: 'Create' | 'Study' | 'Workspace';
}

/** The one-click tasks offered in the Copilot's empty state. */
export const COPILOT_TASKS: CopilotTask[] = [
  { id: 'new-note',      label: 'New note',       hint: 'Start writing',        group: 'Create' },
  { id: 'ask-tutor',     label: 'Ask the tutor',  hint: 'Get an explanation',    group: 'Create' },
  { id: 'start-review',  label: 'Review cards',   hint: 'Spaced repetition',     group: 'Study' },
  { id: 'start-timer',   label: 'Start a timer',  hint: 'Focus session',         group: 'Study' },
  { id: 'toggle-theme',  label: 'Switch theme',   hint: 'Light / dark',          group: 'Workspace' },
  { id: 'show-shortcuts',label: 'Shortcuts',      hint: 'Keyboard reference',    group: 'Workspace' },
  { id: 'command-palette', label: 'Command palette', hint: 'Jump anywhere',      group: 'Workspace' },
  { id: 'export-data',   label: 'Export data',    hint: 'Download a JSON copy',  group: 'Workspace' },
];

/** Suggested questions shown before the user types anything. */
export const COPILOT_SUGGESTIONS: string[] = [
  'Where do I find my flashcards?',
  'How do I back up my data?',
  'How do I turn on notifications?',
  'How do I change the theme?',
  'How do I get AI summaries?',
  'How do I contact support?',
];

/**
 * The knowledge base. Ordered by how often people look for the feature —
 * the Copilot's "browse" view shows these in order when the query is empty.
 */
export const COPILOT_ARTICLES: CopilotArticle[] = [
  // ── Getting started ───────────────────────────────────────────────────────
  {
    id: 'start-here',
    title: 'Where do I start?',
    category: 'Getting started',
    view: 'dashboard',
    keywords: ['start', 'begin', 'first', 'getting started', 'overview', 'home'],
    aliases: ['main page', 'front page'],
    summary: 'The Dashboard is your home base. It shows today\'s goals, your streak, the cards due for review, and quick shortcuts into everything else.',
    steps: [
      'Open Dashboard from the sidebar (or press ⌘1).',
      'Set today\'s goals in the Daily Goals card — they drive your weekly ring.',
      'Check the Activity heatmap to see your last three months of study.',
    ],
  },
  {
    id: 'daily-goals',
    title: 'How do I set my daily goals?',
    category: 'Getting started',
    view: 'dashboard',
    keywords: ['goals', 'daily goals', 'target', 'targets', 'daily target', 'weekly goal'],
    aliases: ['aim', 'quota'],
    summary: 'Daily Goals live on the Dashboard. You set a target for study minutes, flashcards and notes; the hero ring shows how the week is tracking against them.',
    steps: [
      'Go to Dashboard.',
      'Open the Daily Goals card and set your study minutes, flashcards and notes targets.',
      'The big ring in the welcome banner shows your weekly progress.',
    ],
  },
  {
    id: 'student-profile',
    title: 'How do I set my school level?',
    category: 'Getting started',
    view: 'settings',
    keywords: ['student profile', 'school', 'grade', 'year', 'level', 'university', 'education'],
    aliases: ['profile', 'my level', 'class'],
    summary: 'Settings → Student Profile stores your education level, class and department. The AI Tutor uses it to pitch explanations at the right level.',
    steps: [
      'Open Settings.',
      'Find the Student Profile card.',
      'Pick your stage, class or university year, then save.',
    ],
  },
  {
    id: 'install-app',
    title: 'How do I install the app on my device?',
    category: 'Getting started',
    view: 'settings',
    keywords: ['install', 'app', 'pwa', 'phone', 'mobile', 'desktop', 'home screen'],
    aliases: ['download app', 'add to home screen'],
    summary: 'StudyWorks is a Progressive Web App — it installs like a native app with no app store involved.',
    steps: [
      'Open Settings → Install App.',
      'Follow the steps for your platform (Chrome/Edge, iOS Safari, or Android).',
      'It will open in its own window and work offline.',
    ],
  },
  {
    id: 'sign-out',
    title: 'How do I sign out?',
    category: 'Getting started',
    view: 'settings',
    keywords: ['sign out', 'logout', 'log out', 'exit', 'leave'],
    summary: 'Your account block is at the bottom of the sidebar on every page — sign out is right there. There is also a Sign out command in the ⌘K palette.',
    steps: [
      'Scroll to the account block at the bottom of the sidebar.',
      'Click Sign out.',
    ],
  },

  // ── Notes ─────────────────────────────────────────────────────────────────
  {
    id: 'create-note',
    title: 'How do I create a note?',
    category: 'Notes',
    view: 'notes',
    action: 'new-note',
    cta: 'Create a note',
    keywords: ['new note', 'create note', 'write', 'add note', 'make a note', 'composition'],
    aliases: ['write a note', 'new memo'],
    summary: 'Notes are your main workspace. Hit "+ New Note" at the top of the Notes page and the editor opens with title, body and tags.',
    steps: [
      'Open Notes from the sidebar (or press ⌘2).',
      'Click "+ New Note".',
      'Type a title, write the body, add tags, then Save.',
    ],
  },
  {
    id: 'note-folders',
    title: 'How do I organise notes into folders?',
    category: 'Notes',
    view: 'notes',
    keywords: ['folders', 'organise', 'organize', 'categories', 'folder', 'file note'],
    aliases: ['sort notes', 'structure'],
    summary: 'Folders live in the left column of the Notes page. You can drag notes between them, and create new folders from the same column.',
    steps: [
      'Open Notes.',
      'Pick a folder in the left column, or create a new one with the + button.',
      'When saving a note, choose its folder in the editor.',
    ],
  },
  {
    id: 'smart-folders',
    title: 'How do I use smart folders?',
    category: 'Notes',
    view: 'notes',
    keywords: ['smart folder', 'smart folders', 'auto folder', 'rule', 'rules', 'filter folder'],
    aliases: ['dynamic folder', 'automatic'],
    summary: 'A smart folder fills itself from a rule — for example every note tagged "biology", or every note you made this week. The notes still live in their normal folder.',
    steps: [
      'In the Notes sidebar, click "New smart folder".',
      'Choose the rule (tag, date, type…) and save.',
      'It appears as a folder that updates itself.',
    ],
  },
  {
    id: 'note-tags',
    title: 'How do I tag notes?',
    category: 'Notes',
    view: 'notes',
    keywords: ['tags', 'tag', 'label', 'labelling', 'categories'],
    aliases: ['keywords', 'hashtag'],
    summary: 'Tags are typed into the editor\'s Tags field, separated by commas. Tap a tag on any note to filter the whole library by it.',
    steps: [
      'Open or create a note.',
      'Type tags in the Tags field, separated by commas.',
      'Click a tag chip on a note to filter the library.',
    ],
  },
  {
    id: 'search-notes',
    title: 'How do I search my notes?',
    category: 'Notes',
    view: 'notes',
    keywords: ['search', 'find', 'find notes', 'lookup', 'query', 'filter'],
    aliases: ['grep', 'look for'],
    summary: 'The search box at the top of the Notes page filters by title, body and tag as you type. There is also a global search in the top bar.',
    steps: [
      'Open Notes.',
      'Type into the search field at the top — results narrow as you type.',
      'Use the tag and folder filters to narrow further.',
    ],
  },
  {
    id: 'saved-searches',
    title: 'How do I save a search for later?',
    category: 'Notes',
    view: 'notes',
    keywords: ['saved search', 'save search', 'bookmark search', 'keep search'],
    aliases: ['favourite search', 'preserved query'],
    summary: 'Saved searches keep a query and its filters around so you can jump back to it later.',
    steps: [
      'Run the search you want to keep.',
      'Open the saved-searches panel and give it a name.',
      'It appears in the Notes sidebar whenever you return.',
    ],
  },
  {
    id: 'save-from-url',
    title: 'How do I save a note from a web page?',
    category: 'Notes',
    view: 'notes',
    keywords: ['save from url', 'url', 'web page', 'website', 'clip', 'save link', 'article'],
    aliases: ['import url', 'save webpage'],
    summary: '"Save from URL" pulls the title, description and a preview out of a link and turns it into a note you can edit.',
    steps: [
      'Open Notes.',
      'Click "🔗 Save from URL".',
      'Paste the link and save — the page details are filled in for you.',
    ],
  },
  {
    id: 'attachments',
    title: 'How do I attach a file to a note?',
    category: 'Notes',
    view: 'notes',
    keywords: ['attach', 'attachment', 'pdf', 'pptx', 'upload', 'file', 'import file'],
    aliases: ['add file', 'document', 'scan'],
    summary: 'You can attach a PDF, PPTX, image or audio file to a note. Importing a PDF or PPTX also offers to turn it into flashcards.',
    steps: [
      'Open Notes and click "📥 Import".',
      'Choose a PDF, PPTX, image or audio file.',
      'The file is attached to the note — for PDFs and decks you can generate cards from it.',
    ],
  },
  {
    id: 'highlights',
    title: 'How do I highlight text in a note?',
    category: 'Notes',
    view: 'notes',
    keywords: ['highlight', 'highlights', 'mark', 'colour', 'color', 'passage'],
    aliases: ['emphasise', 'emphasize'],
    summary: 'Select text in the editor and use the highlight control to colour it. Highlights are kept with the note and shown in the Highlights panel.',
    steps: [
      'Open a note and select some text.',
      'Pick a highlight colour from the toolbar.',
      'Find all your highlights under the Highlights tab.',
    ],
  },
  {
    id: 'note-versions',
    title: 'How do I see an older version of a note?',
    category: 'Notes',
    view: 'notes',
    keywords: ['version', 'history', 'revision', 'restore', 'older version', 'undo edit'],
    aliases: ['revert', 'roll back', 'restore version'],
    summary: 'Notes keep a version history. You can open any earlier revision, read it, and restore it if you want that version back.',
    steps: [
      'Open the note.',
      'Click "Last edited" under the title to open the version list.',
      'Pick a version to preview it, then restore it if you want.',
    ],
  },
  {
    id: 'note-templates',
    title: 'How do I start from a template?',
    category: 'Notes',
    view: 'notes',
    keywords: ['template', 'templates', 'premade', 'starter'],
    aliases: ['note template', 'blank note'],
    summary: 'The ▾ button next to "+ New Note" opens the template menu — pre-shaped notes for lecture summaries, essays, research and more.',
    steps: [
      'Open Notes.',
      'Click the ▾ next to "+ New Note".',
      'Pick a template and it opens pre-filled.',
    ],
  },
  {
    id: 'note-reminders',
    title: 'How do I set a reminder on a note?',
    category: 'Notes',
    view: 'notes',
    keywords: ['reminder', 'remind', 'alarm', 'notification for note', 'due date'],
    aliases: ['schedule note', 'nudge'],
    summary: 'You can attach a reminder date to a note so it comes back to you when you need to revisit it.',
    steps: [
      'Open the note.',
      'Use the reminder control to pick a date.',
      'You will be notified when it is due.',
    ],
  },
  {
    id: 'focus-mode',
    title: 'How do I enter focus mode?',
    category: 'Notes',
    view: 'notes',
    keywords: ['focus mode', 'distraction free', 'zen', 'distraction-free', 'write mode'],
    aliases: ['distraction free', 'fullscreen editor'],
    summary: 'Focus mode hides the library and gives you the editor alone — nothing else on screen to pull you off the task.',
    steps: [
      'Open Notes.',
      'Click "🧘 Focus Mode" in the toolbar.',
      'Click "← Back to library" when you are done.',
    ],
  },
  {
    id: 'bulk-edit',
    title: 'How do I edit or delete several notes at once?',
    category: 'Notes',
    view: 'notes',
    keywords: ['bulk', 'multiple notes', 'select all', 'batch', 'mass delete'],
    aliases: ['several notes', 'many notes'],
    summary: 'Bulk mode turns the note list into a multi-select so you can move, tag or delete many notes in one go.',
    steps: [
      'Open Notes.',
      'Enter bulk mode from the toolbar.',
      'Tick the notes you want, then choose what to do with them.',
    ],
  },
  {
    id: 'ai-summary',
    title: 'How do I get an AI summary of a note?',
    category: 'Notes',
    view: 'notes',
    keywords: ['ai summary', 'summary', 'summarise', 'summarize', 'tl dr', 'tldr', 'condense'],
    aliases: ['shorten note', 'key points'],
    summary: 'AI Summary reads the note and writes a condensed version you can paste into a personal note. It needs an AI provider connected and a Pro plan.',
    steps: [
      'Open the note you want summarised.',
      'Click "AI Summary".',
      'Review the result and save it into your personal notes.',
    ],
  },
  {
    id: 'ai-qa',
    title: 'How do I ask questions about my notes?',
    category: 'Notes',
    view: 'notes',
    keywords: ['ask a question', 'question', 'qa', 'q&a', 'ask about notes', 'answer from notes'],
    aliases: ['ask notes', 'question my notes', 'chat with notes'],
    summary: 'The Q&A panel answers a question using your own notes as the source and shows which notes it pulled the answer from. Needs an AI provider and Pro.',
    steps: [
      'Open Notes.',
      'Open the question panel and type a question.',
      'The answer cites the notes it used.',
    ],
  },
  {
    id: 'practice-questions',
    title: 'How do I turn a note into practice questions?',
    category: 'Notes',
    view: 'notes',
    keywords: ['practice question', 'quiz', 'test yourself', 'practice', 'mock questions'],
    aliases: ['self test', 'exam questions'],
    summary: 'Practice questions are generated from a note and answered in the Flashcards area under Practice review — a quick way to check what stuck.',
    steps: [
      'Open a note.',
      'Generate practice questions from it.',
      'Review them in Flashcards → Practice.',
    ],
  },
  {
    id: 'email-to-save',
    title: 'How do I save notes by email?',
    category: 'Notes',
    view: 'settings',
    keywords: ['email', 'save by email', 'inbound email', 'email a note', 'forward'],
    aliases: ['email to save', 'send by email'],
    summary: 'Email-to-save gives you a personal address — anything sent there becomes a note automatically. The address is shown in Settings once the server has an inbound domain configured.',
    steps: [
      'Open Settings → Save by Email.',
      'Copy your personal save address.',
      'Forward or send anything to it and it lands in Notes.',
    ],
  },
  {
    id: 'folder-sharing',
    title: 'How do I share a folder with someone?',
    category: 'Notes',
    view: 'settings',
    keywords: ['share', 'sharing', 'share link', 'public link', 'share folder'],
    aliases: ['publish', 'read only link'],
    summary: 'Folder Sharing creates a public read-only link to any folder. Anyone with the link can read the notes but cannot edit them. Pro only.',
    steps: [
      'Open Settings → Folder Sharing.',
      'Pick a folder and click "Create link".',
      'The link is copied to your clipboard — revoke it any time.',
    ],
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    id: 'add-contact',
    title: 'How do I add a person?',
    category: 'People',
    view: 'contacts',
    keywords: ['add person', 'add contact', 'new contact', 'people', 'friend', 'classmate'],
    aliases: ['new person', 'add someone'],
    summary: 'The People page holds everyone you study with — classmates, friends, tutors — so you can track who you last spoke to.',
    steps: [
      'Open People from the sidebar (or press ⌘3).',
      'Click "Add person" and fill in their details.',
      'They appear in the list, ready to track.',
    ],
  },
  {
    id: 'birthdays',
    title: 'How do I track birthdays?',
    category: 'People',
    view: 'contacts',
    keywords: ['birthday', 'birthdays', 'birthdate', 'birth day'],
    aliases: ['birth dates', 'anniversary'],
    summary: 'Each person can have a birthday, and StudyWorks will remind you before it so you can say something.',
    steps: [
      'Open People.',
      'Add or edit a person.',
      'Set their Birthday — you will be reminded ahead of time.',
    ],
  },
  {
    id: 'relationship-strength',
    title: 'How do I track how close I am to someone?',
    category: 'People',
    view: 'contacts',
    keywords: ['relationship', 'relationship strength', 'close', 'closeness', 'strong', 'weak'],
    aliases: ['how close', 'connection level'],
    summary: 'Relationship strength (weak / moderate / strong) lets you sort the people who matter most to you.',
    steps: [
      'Open People.',
      'Add or edit a person.',
      'Set Relationship strength, then use Move to re-sort.',
    ],
  },

  // ── Flashcards ────────────────────────────────────────────────────────────
  {
    id: 'create-flashcards',
    title: 'How do I create flashcards?',
    category: 'Flashcards',
    view: 'flashcards',
    keywords: ['flashcards', 'flashcard', 'cards', 'make cards', 'deck', 'new card'],
    aliases: ['add card', 'create card', 'revision cards'],
    summary: 'Flashcards are question-and-answer pairs. You can write them by hand, or generate them straight from a note, a PDF or a deck.',
    steps: [
      'Open Flashcards from the sidebar (or press ⌘4).',
      'Click "+ New card" and write a question and an answer.',
      'Or generate them from a note with AI.',
    ],
  },
  {
    id: 'review-flashcards',
    title: 'How do I review flashcards?',
    category: 'Flashcards',
    view: 'flashcards',
    action: 'start-review',
    cta: 'Start reviewing',
    keywords: ['review', 'study flashcards', 'spaced repetition', 'srs', 'due', 'revision'],
    aliases: ['practice cards', 'drill', 'quiz cards'],
    summary: 'Review mode uses spaced repetition: each card is scheduled by how well you recalled it, so the ones you are about to forget come back first. Pro only.',
    steps: [
      'Open Flashcards.',
      'Click "Study" to start a review session.',
      'Flip the card, then rate how well you did — the next due date is set for you.',
    ],
  },
  {
    id: 'due-flashcards',
    title: 'How do I see which flashcards are due?',
    category: 'Flashcards',
    view: 'flashcards',
    keywords: ['due', 'due cards', 'due today', 'what to review', 'ready to review'],
    aliases: ['cards to review', 'pending cards'],
    summary: 'The Flashcards page opens on the cards that are due today; the stats row shows how many are due, how many you have learned and how many are new.',
    steps: [
      'Open Flashcards.',
      'Look at the stats row at the top for due counts.',
      'Click "Study" to review exactly those.',
    ],
  },
  {
    id: 'card-difficulty',
    title: 'How do I change how hard a card is?',
    category: 'Flashcards',
    view: 'flashcards',
    keywords: ['difficulty', 'hard', 'easy', 'medium', 'rate card', 'card difficulty'],
    aliases: ['again', 'good', 'easy card'],
    summary: 'During a review you rate each card (Again, Hard, Good or Easy) and that sets when it comes back. The Difficulty distribution chart shows the mix.',
    steps: [
      'Open Flashcards → Study.',
      'Reveal the answer and rate the card.',
      'Check the Difficulty distribution chart to see how your cards are spread.',
    ],
  },

  // ── Timer ─────────────────────────────────────────────────────────────────
  {
    id: 'start-timer',
    title: 'How do I start a focus timer?',
    category: 'Timer',
    view: 'timer',
    action: 'start-timer',
    cta: 'Start a timer',
    keywords: ['timer', 'pomodoro', 'focus session', 'focus', 'stopwatch', 'countdown'],
    aliases: ['work session', 'study session', 'timed session'],
    summary: 'The Timer page runs a focus session with a break after it. The ring shows the time left and every finished session feeds your streak.',
    steps: [
      'Open Timer from the sidebar.',
      'Press start — the ring begins counting down.',
      'Adjust the length in Settings → Study Timer if you want a different session.',
    ],
  },
  {
    id: 'timer-settings',
    title: 'How do I change the timer length?',
    category: 'Timer',
    view: 'settings',
    keywords: ['timer length', 'timer settings', 'pomodoro length', 'session length', 'break length', 'focus duration'],
    aliases: ['how long', 'duration'],
    summary: 'Focus and break lengths are set in Settings → Study Timer, so your sessions match how you actually work.',
    steps: [
      'Open Settings.',
      'Find the Study Timer card.',
      'Set your focus and break lengths — they apply from the next session.',
    ],
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'ask-tutor',
    title: 'How do I ask the AI Tutor a question?',
    category: 'AI',
    view: 'tutor',
    action: 'ask-tutor',
    cta: 'Ask the tutor',
    keywords: ['tutor', 'ai tutor', 'ask a question', 'explain', 'help me understand', 'lesson'],
    aliases: ['teach me', 'explain this', 'ai help'],
    summary: 'The AI Tutor explains any topic. You can ask for a lesson, ask for something simpler, go deeper, or turn it into a quiz — and save the answer as a note.',
    steps: [
      'Open AI Tutor from the sidebar.',
      'Type your question.',
      'Use Lesson, Simpler, Deeper or Quiz to shape the answer, then save it as a note.',
    ],
  },
  {
    id: 'connect-ai',
    title: 'How do I turn on AI features?',
    category: 'AI',
    view: 'settings',
    keywords: ['ai', 'connect ai', 'gemini', 'openai', 'api key', 'ai provider', 'enable ai'],
    aliases: ['set up ai', 'ai settings', 'connect provider'],
    summary: 'Settings → AI Features stores your own provider key (Gemini or OpenAI). Nothing is sent to any provider until you connect one. Pro only.',
    steps: [
      'Open Settings.',
      'Find the AI Features card.',
      'Choose Gemini or OpenAI, paste your API key and save.',
    ],
  },

  // ── Together ──────────────────────────────────────────────────────────────
  {
    id: 'study-room',
    title: 'How do I use the Study Room?',
    category: 'Together',
    view: 'studyRoom',
    keywords: ['study room', 'together', 'voice', 'call', 'group', 'live', 'room'],
    aliases: ['voice chat', 'study together', 'meet'],
    summary: 'The Study Room is a live space with voice — open one and share the link so anyone can join you while you work.',
    steps: [
      'Open Study Room from the sidebar.',
      'Create a room or join one with a code.',
      'Share the invite so friends can drop in.',
    ],
  },
  {
    id: 'quiz-battle',
    title: 'How do I play Quiz Battle?',
    category: 'Together',
    view: 'multiplayer',
    keywords: ['quiz', 'battle', 'multiplayer', 'compete', 'versus', 'vs', 'game'],
    aliases: ['quiz battle', 'challenge', 'head to head'],
    summary: 'Quiz Battle is the head-to-head mode: create a room, join with a code, and answer questions against whoever else is in the room.',
    steps: [
      'Open Quiz Battle from the sidebar.',
      'Create a room, or enter a code to join one.',
      'Answer fastest to take the round.',
    ],
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    id: 'upgrade',
    title: 'How do I upgrade to Pro?',
    category: 'Account',
    view: 'pricing',
    keywords: ['upgrade', 'pro', 'upgrade to pro', 'premium', 'subscribe', 'subscription', 'plan'],
    aliases: ['buy pro', 'get pro', 'paid'],
    summary: 'The Pricing page lists every plan side by side, with a monthly/yearly toggle and the Pro plan recommended. Pro unlocks spaced repetition, unlimited items and every AI feature.',
    steps: [
      'Open Pricing from the sidebar (or press ⌘5).',
      'Choose monthly or yearly billing.',
      'Click Upgrade — you are taken through to checkout.',
    ],
  },
  {
    id: 'contact-support',
    title: 'How do I contact support?',
    category: 'Account',
    view: 'settings',
    keywords: ['support', 'contact support', 'help', 'complaint', 'problem', 'bug', 'report', 'ticket'],
    aliases: ['customer service', 'get in touch', 'raise an issue'],
    summary: 'Settings → Contact Support sends a message straight to the team. Anything you send shows up under "Your requests", with the reply underneath it.',
    steps: [
      'Open Settings.',
      'Find the Contact Support card.',
      'Write a subject and your message, then click "Send message".',
      'Replies appear in the same card under Your requests.',
    ],
  },
  {
    id: 'export-data',
    title: 'How do I back up my data?',
    category: 'Account',
    view: 'settings',
    action: 'export-data',
    cta: 'Export my data',
    keywords: ['export', 'backup', 'back up', 'download data', 'save my data', 'json'],
    aliases: ['export json', 'take a backup'],
    summary: 'Export writes everything — notes, people, flashcards, folders, practice questions and saved searches — to a single JSON file you can keep. Pro only.',
    steps: [
      'Open Settings → Data & Storage.',
      'Click Export, or use the export button at the bottom of the sidebar.',
      'Keep the downloaded file somewhere safe.',
    ],
  },
  {
    id: 'import-data',
    title: 'How do I restore a backup?',
    category: 'Account',
    view: 'settings',
    keywords: ['import', 'restore', 'load data', 'backup restore', 'bring back'],
    aliases: ['import json', 'upload data', 'restore backup'],
    summary: 'Import reads a StudyWorks JSON export and merges it into your library. Nothing is deleted — matching items are updated, new ones are added. Pro only.',
    steps: [
      'Open Settings → Data & Storage.',
      'Choose a JSON export file to import.',
      'Your library is merged with what was in the file.',
    ],
  },
  {
    id: 'cloud-sync',
    title: 'How do I sync across devices?',
    category: 'Account',
    view: 'settings',
    action: 'sync-now',
    cta: 'Sync now',
    keywords: ['sync', 'cloud', 'across devices', 'backup to cloud', 'multiple devices'],
    aliases: ['cloud backup', 'sync now'],
    summary: 'Sync pushes your library to the server and pulls it back down, so a second device starts with everything already there.',
    steps: [
      'Open Settings → Data & Storage.',
      'Use "Sync now" to push and pull in one go.',
      'The syncing chip in the top bar shows it working.',
    ],
  },
  {
    id: 'change-theme',
    title: 'How do I switch between light and dark?',
    category: 'Account',
    view: 'settings',
    action: 'toggle-theme',
    cta: 'Switch theme',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'toggle theme', 'night mode'],
    aliases: ['colour scheme', 'switch theme'],
    summary: 'There are three theme modes — light, dark and the one your system asks for. The theme button at the bottom of the sidebar cycles between them.',
    steps: [
      'Click the theme button at the bottom of the sidebar.',
      'It cycles light → dark → system.',
      'You can also pick one directly in Settings → Appearance.',
    ],
  },
  {
    id: 'change-accent',
    title: 'How do I change the accent colour?',
    category: 'Account',
    view: 'settings',
    keywords: ['accent', 'accent colour', 'accent color', 'theme colour', 'colour', 'color'],
    aliases: ['change colour', 'highlight colour'],
    summary: 'The five dots in the top bar set the accent colour instantly. Settings → Appearance has all eighteen themes if you want more choice.',
    steps: [
      'Click a coloured dot in the top bar for an instant change.',
      'Or open Settings → Appearance for the full palette.',
    ],
  },
  {
    id: 'notifications',
    title: 'How do I turn on notifications and reminders?',
    category: 'Account',
    view: 'settings',
    keywords: ['notifications', 'reminders', 'alerts', 'browser notifications', 'notify me'],
    aliases: ['push notifications', 'reminder alerts'],
    summary: 'Settings → Notifications & Reminders turns on browser notifications and controls what StudyWorks is allowed to remind you about.',
    steps: [
      'Open Settings → Notifications & Reminders.',
      'Allow notifications in your browser when asked.',
      'Choose which reminders you want.',
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'What keyboard shortcuts are there?',
    category: 'Account',
    action: 'show-shortcuts',
    cta: 'Show shortcuts',
    keywords: ['shortcut', 'shortcuts', 'keyboard', 'hotkey', 'key bindings', 'speed up'],
    aliases: ['keyboard reference', 'accelerators'],
    summary: 'The shortcuts sheet lists every binding. You can also rebind them yourself in Settings → Keyboard Shortcuts — the change takes effect immediately.',
    steps: [
      'Press ? to open the shortcut sheet at any time.',
      'Or go to Settings → Keyboard Shortcuts to rebind them.',
    ],
  },
  {
    id: 'command-palette',
    title: 'How do I jump straight to a page?',
    category: 'Account',
    action: 'command-palette',
    cta: 'Open the palette',
    keywords: ['command palette', 'quick jump', 'navigate fast', 'search commands', 'cmd k'],
    aliases: ['command menu', 'go to anything'],
    summary: 'The command palette (⌘K) jumps to any page and runs any action from one search box — no hunting through the sidebar.',
    steps: [
      'Press ⌘K (Ctrl+K on Windows).',
      'Type a page name or an action.',
      'Press Enter to run it.',
    ],
  },
];

/** Normalise a string for matching: lowercase, strip punctuation, collapse spaces. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that carry no signal in a question.
 *
 * Without this, "where do I find flashcards" scores every "How do I…" article
 * on the word "how", and short words like "do" and "my" match as substrings
 * inside unrelated keywords. Every result would look relevant and none would
 * be.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'get', 'give', 'has', 'have', 'how', 'i',
  'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'should',
  'so', 'some', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'use', 'want', 'was', 'what', 'when', 'where', 'which',
  'will', 'with', 'you', 'your',
]);

/**
 * A result must score at least this much to be shown.
 *
 * Low enough that one exact keyword hit ("pomodoro" → the timer) still finds
 * its article; the relative cutoff below then trims the rest.
 */
const MIN_SCORE = 8;

/**
 * A result must also score at least this fraction of the best match.
 *
 * Without it, a question like "where do I find flashcards" keeps the article
 * that happens to own the generic keyword "find" — a legitimate match, but
 * not an answer to the question. Scoring relative to the best hit drops it
 * while keeping every genuine alternative ("How do I review flashcards?").
 */
const RELATIVE_CUTOFF = 0.5;

export interface CopilotMatch {
  article: CopilotArticle;
  score: number;
}

/**
 * Score one article against a query.
 *
 * The whole query is worth more than its individual words — "save a note from
 * a web page" should find "Save from URL" rather than three weak matches — so
 * exact-phrase hits are weighted heavily.
 */
export function scoreArticle(article: CopilotArticle, rawQuery: string): number {
  const query = normalise(rawQuery);
  if (!query) return 0;

  const title    = normalise(article.title);
  const summary  = normalise(article.summary);
  const keywords = article.keywords.map(normalise);
  const aliases  = (article.aliases ?? []).map(normalise);
  const steps    = (article.steps ?? []).map(normalise).join(' ');

  let score = 0;

  // Whole-phrase matches.
  if (title === query) score += 40;
  else if (title.includes(query)) score += 22;

  if (keywords.some(k => k === query)) score += 26;
  else if (keywords.some(k => k.includes(query))) score += 16;

  if (aliases.some(a => a === query)) score += 20;
  else if (aliases.some(a => a.includes(query))) score += 12;

  if (summary.includes(query)) score += 8;

  // Per-word matches.
  for (const token of query.split(' ')) {
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;

    // Substring matching needs a longer word — "up" is inside "backup" and
    // "do" is inside "download", which matches half the library. Exact
    // keyword matches are still allowed at two characters ("qa").
    const mayMatchInside = token.length >= 3;

    if (mayMatchInside && title.includes(token)) score += 6;
    if (keywords.some(k => k === token)) score += 8;
    else if (mayMatchInside && keywords.some(k => k.includes(token))) score += 4;
    if (aliases.some(a => a === token)) score += 6;
    else if (mayMatchInside && aliases.some(a => a.includes(token))) score += 3;
    if (mayMatchInside && summary.includes(token)) score += 2;
    if (mayMatchInside && steps.includes(token)) score += 1;
  }

  return score;
}

/**
 * Rank articles against a query. Returns the best matches first, and nothing
 * at all when the query matches nothing (the UI turns that into a fallback).
 */
export function matchCopilot(
  rawQuery: string,
  articles: CopilotArticle[] = COPILOT_ARTICLES,
): CopilotMatch[] {
  const query = normalise(rawQuery);
  if (!query) return [];

  const scored = articles
    .map(article => ({ article, score: scoreArticle(article, query) }))
    .filter(m => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));

  if (scored.length === 0) return [];

  const cutoff = Math.max(MIN_SCORE, scored[0].score * RELATIVE_CUTOFF);
  return scored.filter(m => m.score >= cutoff).slice(0, 6);
}
