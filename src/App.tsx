import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import './compat.css';
import './design.css';
import { productProfile } from './config/product';
import AppShell from './components/AppShell';
import Dashboard from './components/Dashboard';
import NotesView from './components/NotesView';
import ContactsView from './components/ContactsView';
import FlashcardsView from './components/FlashcardsView';
import PricingView from './components/PricingView';
import Toast from './components/Toast';
import StudyTimer from './components/StudyTimer';
import Onboarding from './components/Onboarding';
import ShortcutsModal from './components/ShortcutsModal';
import LoadingScreen from './components/LoadingScreen';
import OpeningSequence from './components/OpeningSequence';
import SettingsView from './components/SettingsView';
import StudyRoom from './components/StudyRoom';
import TutorView from './components/TutorView';
import MultiplayerQuiz from './components/MultiplayerQuiz';
import AuthPage from './components/AuthPage';
import ConfirmModal from './components/ConfirmModal';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useShortcutOverrides } from './hooks/useShortcuts';
import { SHORTCUT_BY_ID, isShortcutCaptureActive, matchesCombo, resolveCombo } from './config/shortcuts';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useDB } from './hooks/useDB';
import { useSession } from './hooks/useSession';
import { useNotifications } from './hooks/useNotifications';
import { useReminderScheduler } from './hooks/useReminderScheduler';
import { useAI } from './hooks/useAI';
import { signOut } from './api/auth';
import CommandPalette, { type Command } from './components/CommandPalette';
import Copilot from './components/Copilot';
import type { CopilotActionId } from './config/copilot';
import { pullSync, pushSync } from './api/sync';
import { syncStreak } from './db/streaks';
import { mergeByLWW, mergeTier } from './utils/merge';
import { buildExportPayload, downloadJSON } from './utils/dataExport';
import { getAccent, accentCssVars, accentGlow } from './config/accents';
import Achievements from './components/Achievements';
import AdminDashboard from './components/AdminDashboard';
import { NAV_ITEMS, PAGE_TITLES, type View } from './config/nav';
import { fetchStudentProfile } from './api/ai';
import { describeProfile } from './config/studentProfile';
import { IconDownload, IconUpload, IconSpinner } from './components/icons';

type Theme = 'light' | 'dark' | 'system';
type Tier  = 'free' | 'pro';

const THEME_CYCLE: Theme[]               = ['system', 'light', 'dark'];
const THEME_ICON:  Record<Theme, string> = { system: '💻', light: '☀️', dark: '🌙' };
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function getSystemScheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function resolveTheme(t: Theme): 'light' | 'dark' {
  return t === 'system' ? getSystemScheme() : t;
}

interface ToastMessage { id: number; message: string; type: 'success' | 'error' | 'info'; }

// ── Notification permission banner ────────────────────────────────────────────
function NotifBanner({ onEnable }: { onEnable: () => void }) {
  const [dismissed, setDismissed] = useState(() => !!sessionStorage.getItem('notif-banner-dismissed'));
  if (dismissed) return null;
  return (
    <div className="animate-in" style={{
      display: 'flex', alignItems: 'center', gap: '0.875rem', flexWrap: 'wrap',
      padding: '0.875rem 1.125rem', marginBottom: '1.5rem',
      background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    }}>
      <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>🔔</span>
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>Enable reminders</p>
        <p className="text-xs text-muted">Get notified when notes and contacts are due for review, even when the tab is closed.</p>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={onEnable}>Enable</button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { sessionStorage.setItem('notif-banner-dismissed', '1'); setDismissed(true); }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // ── Session ───────────────────────────────────────────────────────────────
  const session = useSession();

  // ── IndexedDB layer ───────────────────────────────────────────────────────
  const db = useDB();

  // ── Cloud sync — pull on login ────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  // Trial window (ISO string from the server). `null` = no trial started yet.
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  // Toasts (used by Stripe checkout handler below; declared early to avoid
  // "used before declaration" lint when other hooks reference them).
  const [toasts, setToasts]   = useState<ToastMessage[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  // Custom keyboard-shortcut overrides (rebound in Settings).
  const { overrides } = useShortcutOverrides();

  // Command palette — bound separately so it still opens while the user is
  // typing in a note. Uses the same rebindable combo as everything else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutCaptureActive()) return;
      const combo = resolveCombo(overrides, 'general.palette', SHORTCUT_BY_ID['general.palette'].combo);
      if (matchesCombo(e, combo)) {
        e.preventDefault();
        setCmdkOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overrides]);
  const addToast    = useCallback((message: string, type: 'success'|'error'|'info' = 'info') =>
    setToasts(p => [...p, { id: Date.now(), message, type }]), []);
  const removeToast = (id: number) => setToasts(p => p.filter(t => t.id !== id));
  const doPullSync = useCallback(async () => {
    setSyncing(true);
    try {
      const remote = await pullSync();
      // LWW merge — never clobber local edits that are newer than the
      // server's. Earlier versions did `db.setNotes(remote.notes)` which
      // silently dropped offline edits when the user signed in on a
      // second device. The merge key is each record's `updatedAt` (server
      // has it; locally we fall back to `createdAt`).
      db.setNotes(mergeByLWW(db.notes, remote.notes));
      db.setContacts(mergeByLWW(db.contacts, remote.contacts));
      db.setFlashcards(mergeByLWW(db.flashcards, remote.flashcards));
      db.setFolders(mergeByLWW(db.folders, remote.folders.length
        ? remote.folders
        : [{ id: 'default', name: 'All Items', createdAt: new Date() }]));
      db.setPracticeQuestions(mergeByLWW(db.practiceQuestions, remote.practiceQuestions));
      db.setSavedSearches(mergeByLWW(db.savedSearches, remote.savedSearches));
      // Tier — server is authoritative for billing (Stripe webhook updates it).
      // The server sends `effectiveTier` (PRO subscription OR active 7-day
      // trial); fall back to the raw tier for older servers.
      db.setTier(mergeTier(db.tier, (remote as any).effectiveTier ?? remote.tier));
      setTrialEndsAt((remote as any).trialEndsAt ?? null);
      // Cross-device streak sync (Phase 2) — merge local streak with server.
      syncStreak().catch(() => {});
    } catch (err) {
      console.warn('[StudyWorks] Sync pull failed (offline?):', err);
    } finally {
      setSyncing(false);
    }
  }, [db.setNotes, db.setContacts, db.setFlashcards, db.setFolders, db.setPracticeQuestions, db.setSavedSearches, db.setTier]);

  useEffect(() => {
    if (session.status !== 'authenticated' || db.status !== 'ready') return;
    doPullSync();
  }, [session.status, db.status, doPullSync]);

  // ── Handle ?checkout=success|cancel coming back from Stripe ──────────────
  // The server's Stripe Checkout routes redirect to /?checkout=success or
  // /?checkout=cancel. On success, the webhook will have already updated
  // the user's tier server-side — re-pull sync to pick it up.
  const handleCheckoutResult = useCallback((result: 'success' | 'cancel') => {
    if (result === 'success') {
      addToast('🎉 Payment successful! Refreshing your plan…', 'success');
      doPullSync();
    } else {
      addToast('Checkout cancelled.', 'info');
    }
  }, [addToast, doPullSync]);

  // ── Handle sign out ───────────────────────────────────────────────────────
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {}
    session.setUser(null);
    // Don't clear IDB — keeps offline data
  };

  // ── Push sync — whenever data changes push to server ─────────────────────
  const pushTimeout = useCallback(
    (() => {
      let timer: ReturnType<typeof setTimeout>;
      return (fn: () => void) => { clearTimeout(timer); timer = setTimeout(fn, 3000); };
    })(),
    []
  );
  const [currentView, setCurrentView] = useState<View>('dashboard');

  // ── Theme (apply immediately from IDB value once loaded) ──────────────────
  const theme = (db.theme as Theme) || 'system';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) =>
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    db.setTheme(next);
  };

  // ── Accent colour theme (independent of light/dark mode) ──────────────────
  // Applies CSS-variable overrides on <html> for the chosen accent pair,
  // recomputed per resolved surface mode so accent × light/dark = 2× combos.
  const accentId = (db.accent as string) || 'sunset';
  useEffect(() => {
    const resolved = resolveTheme(theme);
    const accent = getAccent(accentId);
    const root = document.documentElement;
    root.setAttribute('data-accent', accent.id);
    const vars = accentCssVars(accent, resolved);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const glow = accentGlow(accent, resolved);
    root.style.setProperty('--accent-glow', glow);
    root.style.setProperty('--shadow-glow', `0 12px 44px ${glow}`);
  }, [accentId, theme]);

  // ── Undo / Redo (wraps IDB setters) ──────────────────────────────────────
  const notesUR      = useUndoRedo(db.notes);
  const contactsUR   = useUndoRedo(db.contacts);
  const flashcardsUR = useUndoRedo(db.flashcards);

  // Seed undo/redo stacks once IDB finishes loading, then keep them in sync.
  // Using a ref so we only seed once even if db.notes reference changes.
  const seededRef = useRef(false);
  useEffect(() => {
    if (db.status === 'ready' && !seededRef.current) {
      seededRef.current = true;
      // Replace the initial [] history with the real loaded data
      notesUR.set(db.notes);
      contactsUR.set(db.contacts);
      flashcardsUR.set(db.flashcards);
    }
  }, [db.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write-through: persist undo/redo state changes to IDB (only after seed)
  useEffect(() => { if (db.status === 'ready' && seededRef.current) db.setNotes(notesUR.state); },      [notesUR.state]);      // eslint-disable-line
  useEffect(() => { if (db.status === 'ready' && seededRef.current) db.setContacts(contactsUR.state); }, [contactsUR.state]);   // eslint-disable-line
  useEffect(() => { if (db.status === 'ready' && seededRef.current) db.setFlashcards(flashcardsUR.state); }, [flashcardsUR.state]); // eslint-disable-line

  // Push to server 3 seconds after any data change (debounced)
  useEffect(() => {
    if (session.status !== 'authenticated' || !seededRef.current) return;
    pushTimeout(() => {
      pushSync({
        notes:             notesUR.state,
        contacts:          contactsUR.state,
        flashcards:        flashcardsUR.state,
        folders:           db.folders,
        practiceQuestions: db.practiceQuestions,
        savedSearches:     db.savedSearches,
      }).catch(err => console.warn('[StudyWorks] Push sync failed:', err));
    });
  }, [notesUR.state, contactsUR.state, flashcardsUR.state, db.folders, db.practiceQuestions, db.savedSearches]); // eslint-disable-line

  // ── Helpers ───────────────────────────────────────────────────────────────
  const navigateTo  = (view: string) => setCurrentView(view as View);
  const tier        = (db.tier as Tier) || 'free';
  // Days remaining in the 7-day trial (0 once it's over or never started).
  const trialDaysLeft = (() => {
    if (!trialEndsAt) return 0;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
  })();
  const userName = session.user?.name?.trim() || session.user?.email?.split('@')[0] || 'there';
  const totalItems  = notesUR.state.length + contactsUR.state.length + flashcardsUR.state.length;
  const dueFlashcards = flashcardsUR.state.filter(c => !c.nextReview || new Date(c.nextReview) <= new Date()).length;

  const incrementAiSummaries = () => db.setAiSummariesThisMonth(db.aiSummariesThisMonth + 1);
  const incrementQaQueries   = () => db.setQaQueriesThisMonth(db.qaQueriesThisMonth + 1);

  // ── Notifications + reminder scheduler ───────────────────────────────────
  const notif = useNotifications();
  const ai    = useAI();

  // ── Weekly insights ───────────────────────────────────────────────────────
  const [weeklyInsights, setWeeklyInsights] = useState<import('./hooks/useAI').WeeklyInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // ── Student profile (shown under the name in the sidebar) ────────────────
  const [profileSummary, setProfileSummary] = useState<string>('');
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    let alive = true;
    fetchStudentProfile()
      .then(res => {
        if (!alive || !res) return;
        const u = res.user;
        const summary = describeProfile({
          schoolStage: u.schoolStage ?? null,
          schoolClass: u.schoolClass ?? null,
          universityYear: u.universityYear ?? null,
          department: u.department ?? null,
        });
        setProfileSummary(summary === 'Not set yet' ? '' : summary);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [session.status]);

  const handleGenerateInsights = useCallback(async () => {
    if (!ai.isReady) { addToast('Configure AI in Settings first.', 'info'); return; }
    setInsightsLoading(true);
    try {
      const insights = await ai.generateWeeklyInsights(notesUR.state, flashcardsUR.state);
      setWeeklyInsights(insights);
      addToast('Weekly insights generated!', 'success');
    } catch (err: any) {
      addToast(`Insights failed: ${err.message}`, 'error');
    } finally {
      setInsightsLoading(false);
    }
  }, [ai, notesUR.state, flashcardsUR.state, addToast]);

  useReminderScheduler({
    notes:    notesUR.state,
    contacts: contactsUR.state,
    enabled:  notif.permission === 'granted',
    notify:   notif.notify,
  });

  // ── Deep-link routing from SW notification clicks ─────────────────────────
  useEffect(() => {
    // Handle ?view= param on initial load (SW opens /?view=contacts etc.)
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as View | null;
    if (viewParam && PAGE_TITLES[viewParam]) {
      setCurrentView(viewParam);
      // Clean the URL without reload
      window.history.replaceState({}, '', '/');
    }

    // Save-from-URL deep link (browser extension / share target):
    // /?save=<encoded-url> switches to Notes and stashes the URL for the
    // NotesView to clip once the app is ready.
    const saveParam = params.get('save');
    if (saveParam) {
      try { sessionStorage.setItem('studyworks:pendingSaveUrl', saveParam); } catch {}
      setCurrentView('notes');
      window.history.replaceState({}, '', '/');
    }

    // Handle SW postMessage clicks when tab is already open
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === 'contact') setCurrentView('contacts');
      if (detail?.type === 'note')    setCurrentView('notes');
    };
    window.addEventListener('sw-reminder-click', handler);
    return () => window.removeEventListener('sw-reminder-click', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Built from the shared registry (src/config/shortcuts.ts) so a rebind in
  // Settings changes the real behaviour, not just a label.
  const shortcutMap = useMemo<Record<string, (e: KeyboardEvent) => void>>(() => {
    const combo = (id: string) => resolveCombo(overrides, id, SHORTCUT_BY_ID[id].combo);
    const map: Record<string, (e: KeyboardEvent) => void> = {};
    const bind = (id: string, fn: () => void) => {
      map[combo(id)] = (e) => { e.preventDefault(); fn(); };
    };

    bind('edit.undo', () => { notesUR.undo(); contactsUR.undo(); flashcardsUR.undo(); addToast('Undone', 'info'); });
    bind('edit.redo', () => { notesUR.redo(); contactsUR.redo(); flashcardsUR.redo(); addToast('Redone', 'info'); });
    bind('nav.dashboard',  () => setCurrentView('dashboard'));
    bind('nav.notes',      () => setCurrentView('notes'));
    bind('nav.contacts',   () => setCurrentView('contacts'));
    bind('nav.flashcards', () => setCurrentView('flashcards'));
    bind('nav.pricing',    () => setCurrentView('pricing'));
    bind('nav.settings',   () => setCurrentView('settings'));
    bind('general.help',   () => setShowShortcuts(s => !s));
    bind('general.escape', () => setShowShortcuts(false));
    bind('general.copilot', () => setCopilotOpen(o => !o));

    return map;
    // `notesUR.undo` etc. are stable callbacks — depending on them instead of
    // the whole object keeps the listener from being re-registered on every
    // render.
  }, [overrides, notesUR.undo, contactsUR.undo, flashcardsUR.undo, notesUR.redo, contactsUR.redo, flashcardsUR.redo, addToast]);

  // NOTE: the previous flag was inverted — shortcuts were enabled *while*
  // onboarding and never worked for a normal signed-in user.
  useKeyboardShortcuts(shortcutMap, db.onboardingDone && db.status === 'ready');

  // ── Tier management ───────────────────────────────────────────────────────
  // Upgrades are now real Stripe flows triggered inside PricingView. The
  // only thing App-level tier logic handles is the free-tier downgrade
  // (a local IDB flag flip) and the post-Stripe sync re-pull above.
  const [downgradeModal, setDowngradeModal] = useState(false);

  const handleDowngradeRequest = () => {
    if (totalItems > 50) { addToast('You have more than 50 items. Delete some first.', 'error'); return; }
    setDowngradeModal(true);
  };
  const handleDowngradeConfirm = () => {
    db.setTier('free');
    addToast('Downgraded to Free plan', 'info');
    setDowngradeModal(false);
  };

  // ── Import / Export ───────────────────────────────────────────────────────
  const handleImportFile = (file: File) => {
    if (tier !== 'pro' && trialDaysLeft <= 0) { addToast('Import is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        const imported = {
          notes: Array.isArray(data.notes) ? data.notes : [],
          contacts: Array.isArray(data.contacts) ? data.contacts : [],
          flashcards: Array.isArray(data.flashcards) ? data.flashcards : [],
        };
        // LWW-merge with existing data so an import never deletes anything.
        db.setNotes(mergeByLWW(notesUR.state, imported.notes));
        db.setContacts(mergeByLWW(contactsUR.state, imported.contacts));
        db.setFlashcards(mergeByLWW(flashcardsUR.state, imported.flashcards));
        const count = imported.notes.length + imported.contacts.length + imported.flashcards.length;
        addToast(`Imported ${count} items (merged with existing).`, 'success');
      } catch {
        addToast('Import failed: not a valid StudyWorks export file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  // ── Export / Import ───────────────────────────────────────────────────────
  const exportData = () => {
    if (tier !== 'pro') { addToast('Export is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    downloadJSON(buildExportPayload({
      notes:             notesUR.state,
      contacts:          contactsUR.state,
      flashcards:        flashcardsUR.state,
      folders:           db.folders,
      practiceQuestions: db.practiceQuestions,
      savedSearches:     db.savedSearches,
    }));
    addToast('Data exported!', 'success');
  };

  // ── Copilot actions ───────────────────────────────────────────────────────
  // The Copilot can run a task on the user's behalf, not just point at a page.
  // Tasks that need a control on another page click it after the view has
  // switched — the page wrapper is keyed by view, so the button is remounted
  // and only exists once React has painted the new page.
  const handleCopilotAction = (action: CopilotActionId) => {
    const clickOn = (selector: string) =>
      setTimeout(() => document.querySelector<HTMLElement>(selector)?.click(), 140);

    switch (action) {
      case 'new-note':
        setCurrentView('notes');
        clickOn('[data-copilot="new-note"]');
        break;
      case 'start-review':
        setCurrentView('flashcards');
        clickOn('[data-copilot="start-review"]');
        break;
      case 'start-timer':
        setCurrentView('timer');
        break;
      case 'ask-tutor':
        setCurrentView('tutor');
        break;
      case 'toggle-theme':
        cycleTheme();
        break;
      case 'export-data':
        exportData();
        break;
      case 'show-shortcuts':
        setShowShortcuts(true);
        break;
      case 'command-palette':
        setCmdkOpen(true);
        break;
      case 'sync-now':
        doPullSync();
        break;
      default: {
        // Exhaustiveness guard: adding an action to COPILOT_ACTION_IDS without
        // handling it here fails the type-check instead of silently doing
        // nothing when the user clicks it.
        const unhandled: never = action;
        void unhandled;
      }
    }
  };

  // ── Loading / error / auth gate ──────────────────────────────────────────
  // IMPORTANT: all hooks (useState/useEffect/useMemo/useRef/useCallback) MUST be
  // declared before these early returns, otherwise the hook call order changes
  // between the auth/loading render and the authenticated render and React
  // throws "change in the order of Hooks" → blank screen.
  const commands = useMemo<Command[]>(() => ([
    ...NAV_ITEMS.map(item => {
      const Icon = item.icon;
      return {
        id: `nav-${item.view}`,
        label: `Go to ${item.label}`,
        icon: <Icon size={16} />,
        group: 'Navigate',
        run: () => setCurrentView(item.view),
      };
    }),
    { id: 'action-new-note', label: 'New note', icon: '📝', group: 'Actions', hint: 'N', run: () => { setCurrentView('notes'); setTimeout(() => document.querySelector<HTMLButtonElement>('button.btn-primary')?.click(), 50); } },
    { id: 'action-review', label: 'Start flashcard review', icon: '🎯', group: 'Actions', run: () => setCurrentView('flashcards') },
    { id: 'action-theme', label: `Toggle theme (${THEME_LABEL[theme]})`, icon: THEME_ICON[theme], group: 'Actions', run: () => cycleTheme() },
    { id: 'action-shortcuts', label: 'Keyboard shortcuts', icon: '⌨️', group: 'Actions', run: () => setShowShortcuts(true) },
    { id: 'action-sync', label: 'Sync now', icon: '☁️', group: 'Actions', run: () => doPullSync() },
    { id: 'action-export', label: 'Export data (JSON)', icon: '📤', group: 'Actions', run: () => exportData() },
    { id: 'action-signout', label: 'Sign out', icon: '↪', group: 'Actions', danger: true, run: () => handleSignOut() },
  ]), [theme]);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (db.status === 'loading' || session.status === 'loading') {
    return <OpeningSequence reducedMotion={prefersReducedMotion} productName={productProfile.name} />;
  }
  if (db.status === 'error')   return <LoadingScreen error />;
  if (session.status === 'unauthenticated') {
    return <AuthPage onAuth={user => { session.setUser(user); }} />;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isAdmin = !!(session.user && import.meta.env.VITE_ADMIN_EMAIL &&
    session.user.email.toLowerCase() === (import.meta.env.VITE_ADMIN_EMAIL as string).toLowerCase());

  return (
    <div className="app">
      <AppShell
        currentView={currentView}
        onNavigate={navigateTo}
        pageTitle={PAGE_TITLES[currentView]}
        userName={userName}
        userEmail={session.user?.email}
        userSub={profileSummary || undefined}
        tier={tier}
        trialDaysLeft={trialDaysLeft}
        totalItems={totalItems}
        notesCount={notesUR.state.length}
        dueFlashcards={dueFlashcards}
        accentId={accentId}
        onAccentChange={db.setAccent}
        onOpenCommandPalette={() => setCmdkOpen(true)}
        onOpenPricing={() => setCurrentView('pricing')}
        onSignOut={handleSignOut}
        isAdmin={isAdmin}
        topbarExtra={(
          <>
            {syncing && (
              <span className="sw-chip" title="Syncing with the server">
                <IconSpinner /> Syncing
              </span>
            )}
            <Achievements />
          </>
        )}
        sidebarExtra={(
          <div className="sw-row-wrap" style={{ gap: 6, padding: '0 8px' }}>
            <button
              type="button"
              className="sw-btn secondary sm"
              onClick={cycleTheme}
              title={`Theme: ${THEME_LABEL[theme]} — click to cycle`}
              style={{ flex: 1 }}
            >
              {THEME_ICON[theme]} {THEME_LABEL[theme]}
            </button>
            <button type="button" className="sw-btn secondary sm" onClick={exportData} title="Export JSON">
              <IconDownload size={14} />
            </button>
            {tier === 'pro' && (
              <label className="sw-btn secondary sm" style={{ cursor: 'pointer' }} title="Import data (JSON export file)">
                <IconUpload size={14} />
                <input type="file" accept=".json" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.target.value = ''; // allow re-selecting the same file
                }} style={{ display: 'none' }} />
              </label>
            )}
            <button
              type="button"
              className="sw-btn ghost sm"
              onClick={() => setShowShortcuts(true)}
              style={{ flex: 1 }}
            >
              Shortcuts
            </button>
          </div>
        )}
      >

        {/* Pages — keyed wrapper animates on view switch */}
        <div className="page-content view-enter" key={currentView}>
          {/* Notification permission nudge — shows once until granted or
              dismissed. Hidden on Settings, which owns a full Notifications
              card, so the two don't compete. */}
          {notif.supported && notif.permission === 'default' && currentView !== 'settings' && (
            <NotifBanner onEnable={async () => {
              const result = await notif.request();
              if (result === 'granted') addToast('🔔 Reminders enabled! You\'ll get notified when items are due.', 'success');
            }} />
          )}
          {currentView === 'dashboard' && (
            <Dashboard
              userName={userName}
              trialDaysLeft={trialDaysLeft}
              notes={notesUR.state} contacts={contactsUR.state} flashcards={flashcardsUR.state}
              tier={tier} totalItems={totalItems}
              aiSummariesThisMonth={db.aiSummariesThisMonth} qaQueriesThisMonth={db.qaQueriesThisMonth}
              folders={db.folders} practiceQuestions={db.practiceQuestions}
              setCurrentView={navigateTo}
              aiReady={ai.isReady} aiProvider={ai.config.provider}
              onGenerateInsights={handleGenerateInsights}
              weeklyInsights={weeklyInsights}
              insightsLoading={insightsLoading}
            />
          )}
          {currentView === 'notes' && (
            <NotesView
              notes={notesUR.state} setNotes={notesUR.set}
              flashcards={flashcardsUR.state} setFlashcards={flashcardsUR.set}
              tier={tier} setCurrentView={navigateTo} addToast={addToast}
              totalItems={totalItems}
              incrementAiSummaries={incrementAiSummaries} aiSummariesThisMonth={db.aiSummariesThisMonth}
              folders={db.folders} setFolders={db.setFolders}
              practiceQuestions={db.practiceQuestions} setPracticeQuestions={db.setPracticeQuestions}
              incrementQaQueries={incrementQaQueries} qaQueriesThisMonth={db.qaQueriesThisMonth}
              savedSearches={db.savedSearches} setSavedSearches={db.setSavedSearches}
              ai={ai}
              loadStarterPack={db.loadStarterPack}
            />
          )}
          {currentView === 'contacts' && (
            <ContactsView
              contacts={contactsUR.state} setContacts={contactsUR.set}
              addToast={addToast} tier={tier} setCurrentView={navigateTo}
              totalItems={totalItems} folders={db.folders} setFolders={db.setFolders}
            />
          )}
          {currentView === 'flashcards' && (
            <FlashcardsView
              flashcards={flashcardsUR.state} setFlashcards={flashcardsUR.set}
              addToast={addToast} tier={tier} setCurrentView={navigateTo}
              totalItems={totalItems} folders={db.folders} setFolders={db.setFolders}
              practiceQuestions={db.practiceQuestions} setPracticeQuestions={db.setPracticeQuestions}
            />
          )}
          {currentView === 'pricing' && (
            <PricingView
              currentTier={tier}
              onDowngrade={handleDowngradeRequest}
              onCheckoutResult={handleCheckoutResult}
              addToast={addToast}
            />
          )}
          {currentView === 'studyRoom' && (
            <StudyRoom
              userId={session.user!.id}
              userName={session.user!.name || session.user!.email.split('@')[0]}
              tier={tier}
              setCurrentView={navigateTo}
              addToast={addToast}
              signalingUrl={typeof import.meta.env.VITE_VOICE_SIGNALING_URL === 'string' && import.meta.env.VITE_VOICE_SIGNALING_URL ? import.meta.env.VITE_VOICE_SIGNALING_URL : window.location.origin}
            />
          )}
          {currentView === 'tutor' && (
            <TutorView
              tier={tier}
              setCurrentView={navigateTo}
              addToast={addToast}
              notes={notesUR.state}
              onSaveNote={(note) => {
                notesUR.set([{
                  id: crypto.randomUUID(),
                  title: note.title,
                  content: note.content,
                  tags: note.tags || [],
                  type: 'note',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  files: [],
                  highlights: [],
                  personalNotes: [],
                }, ...notesUR.state]);
              }}
            />
          )}
          {currentView === 'settings' && (
            <SettingsView
              notif={notif} tier={tier} onAddToast={addToast}
              onShowShortcuts={() => setShowShortcuts(true)}
              onAISaved={ai.reloadConfig}
              folders={db.folders}
              theme={theme} onThemeChange={db.setTheme}
              accent={db.accent} onAccentChange={db.setAccent}
              data={{
                notes:             notesUR.state,
                contacts:          contactsUR.state,
                flashcards:        flashcardsUR.state,
                practiceQuestions: db.practiceQuestions,
                savedSearches:     db.savedSearches,
              }}
              displayName={userName}
            />
          )}
          {currentView === 'multiplayer' && (
            <MultiplayerQuiz
              db={db}
              userId={session.user!.id}
              userName={session.user!.name || session.user!.email.split('@')[0]}
              tier={tier}
              setCurrentView={navigateTo}
              addToast={addToast}
            />
          )}
          {currentView === 'timer' && (
            <StudyTimer />
          )}
          {currentView === 'admin' && (
            <AdminDashboard
              adminEmail={session.user!.email}
              addToast={addToast}
            />
          )}
        </div>
      </AppShell>

      {/* Toasts */}
      <div className="toast-stack">
        {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />)}
      </div>

      {/* Modals */}
      {!db.onboardingDone && <Onboarding onComplete={db.setOnboardingDone} product={productProfile} onLoadStarterPack={db.loadStarterPack} />}
      {showShortcuts      && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {downgradeModal && (
        <ConfirmModal
          title="Downgrade to Free?"
          description="You'll lose access to Pro features. Your data will be kept; items beyond the 50-item free limit will be hidden until you delete some."
          confirmLabel="Downgrade"
          cancelLabel="Stay on Pro"
          danger
          onConfirm={handleDowngradeConfirm}
          onCancel={() => setDowngradeModal(false)}
        />
      )}

      {/* Command palette */}
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        commands={commands}
      />

      {/* Copilot — the in-app guide */}
      <Copilot
        open={copilotOpen}
        onOpen={() => setCopilotOpen(true)}
        onClose={() => setCopilotOpen(false)}
        currentView={currentView}
        onNavigate={navigateTo}
        onAction={handleCopilotAction}
      />
    </div>
  );
}
