import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import { productProfile } from './config/product';
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
import { useUndoRedo } from './hooks/useUndoRedo';
import { useDB } from './hooks/useDB';
import { useSession } from './hooks/useSession';
import { useNotifications } from './hooks/useNotifications';
import { useReminderScheduler } from './hooks/useReminderScheduler';
import { useAI } from './hooks/useAI';
import { signOut } from './api/auth';
import CommandPalette, { type Command } from './components/CommandPalette';
import { pullSync, pushSync } from './api/sync';
import { syncStreak } from './db/streaks';
import { mergeByLWW, mergeTier } from './utils/merge';
import Achievements from './components/Achievements';
import GoalTracker from './components/GoalTracker';

type View  = 'dashboard' | 'notes' | 'contacts' | 'flashcards' | 'pricing' | 'settings' | 'multiplayer' | 'studyRoom' | 'tutor' | 'timer';
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

const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'dashboard',  icon: '⊞',  label: 'Dashboard'  },
  { view: 'notes',      icon: '📝', label: 'Notes'       },
  { view: 'contacts',   icon: '👥', label: 'People'      },
  { view: 'flashcards', icon: '💡', label: 'Flashcards'  },
  { view: 'pricing',    icon: '💎', label: 'Pricing'     },
  { view: 'tutor',      icon: '🎓', label: 'AI Tutor'    },
  { view: 'studyRoom',  icon: '📹', label: 'Study Room'  },
  { view: 'multiplayer',icon: '🎮', label: 'Quiz Battle' },
  { view: 'timer',      icon: '⏱️', label: 'Timer'       },
  { view: 'settings',   icon: '⚙️', label: 'Settings'    },
];

const PAGE_TITLES: Record<View, string> = {
  dashboard:  'Dashboard',
  notes:      'Notes & Knowledge Base',
  contacts:   'People & Reminders',
  flashcards: 'Flashcards',
  pricing:    'Pricing',
  tutor:      'AI Tutor',
  multiplayer:'Quiz Battle',
  studyRoom:  'Study Room',
  timer:      'Study Timer',
  settings:   'Settings',
};

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

  // Toasts (used by Stripe checkout handler below; declared early to avoid
  // "used before declaration" lint when other hooks reference them).
  const [toasts, setToasts]   = useState<ToastMessage[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
      db.setTier(mergeTier(db.tier, remote.tier));
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
  const shortcuts = useCallback((): Record<string, (e: KeyboardEvent) => void> => ({
    'mod+z':       () => { notesUR.undo(); contactsUR.undo(); flashcardsUR.undo(); addToast('Undone', 'info'); },
    'mod+shift+z': () => { notesUR.redo(); contactsUR.redo(); flashcardsUR.redo(); addToast('Redone', 'info'); },
    'mod+1': () => setCurrentView('dashboard'),
    'mod+2': () => setCurrentView('notes'),
    'mod+3': () => setCurrentView('contacts'),
    'mod+4': () => setCurrentView('flashcards'),
    'mod+5': () => setCurrentView('pricing'),
    'mod+6': () => setCurrentView('settings'),
    '?':      () => setShowShortcuts(s => !s),
    'escape': () => setShowShortcuts(false),
  }), [notesUR, contactsUR, flashcardsUR, addToast]);

  useKeyboardShortcuts(shortcuts(), !db.onboardingDone || db.status !== 'ready');

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

  // ── Export / Import ───────────────────────────────────────────────────────
  const exportData = () => {
    if (tier !== 'pro') { addToast('Export is a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    const payload = {
      notes: notesUR.state, contacts: contactsUR.state, flashcards: flashcardsUR.state,
      folders: db.folders, practiceQuestions: db.practiceQuestions,
      savedSearches: db.savedSearches, exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `studyworks-export-${new Date().toISOString().split('T')[0]}.json`; a.click();
    URL.revokeObjectURL(url); addToast('Data exported!', 'success');
  };

  // ── Loading / error / auth gate ──────────────────────────────────────────
  // IMPORTANT: all hooks (useState/useEffect/useMemo/useRef/useCallback) MUST be
  // declared before these early returns, otherwise the hook call order changes
  // between the auth/loading render and the authenticated render and React
  // throws "change in the order of Hooks" → blank screen.
  const commands = useMemo<Command[]>(() => ([
    ...NAV_ITEMS.map(item => ({
      id: `nav-${item.view}`,
      label: `Go to ${item.label}`,
      icon: item.icon,
      group: 'Navigate',
      run: () => setCurrentView(item.view),
    })),
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
  return (
    <div className="app">
      <div className="app-shell">

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <img className="logo-mark" src="/logo.svg" alt="StudyWorks" />
            <h1>{productProfile.name}</h1>
          </div>


          <div className="nav-group">
            <p className="nav-group-label">Menu</p>
            {NAV_ITEMS.map(item => (
              <button
                key={item.view}
                className={`nav-item${currentView === item.view ? ' active' : ''}`}
                onClick={() => setCurrentView(item.view)}
              >
                <span className="nav-item-icon">{item.icon}</span>
                {item.label}
                {item.view === 'flashcards' && dueFlashcards > 0 && tier === 'pro' && (
                  <span className="badge">{dueFlashcards}</span>
                )}
                {item.view === 'settings' && notif.permission === 'default' && notif.supported && (
                  <span className="badge" style={{ background: 'var(--accent)' }}>!</span>
                )}
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            {/* User info */}
            {session.user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', marginBottom: '0.25rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0 }}>
                  {(session.user.name || session.user.email).charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.name || 'User'}</p>
                  <p className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.email}</p>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleSignOut}
                  title="Sign out"
                  style={{ flexShrink: 0, color: 'var(--text-2)' }}
                >
                  ↪ Sign out
                </button>
              </div>
            )}
            {syncing && <p className="text-xs text-muted" style={{ padding: '0 0.75rem', marginBottom: '0.25rem' }}>☁️ Syncing…</p>}
            <div className={`tier-badge${tier === 'pro' ? ' pro' : ''}`}>
              {tier === 'pro' ? <>⭐ Pro plan</> : <>🆓 Free plan</>}
            </div>
            {tier === 'free' && (
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: '0.25rem' }}>{totalItems}/50 items</p>
                <div className="usage-bar">
                  <div className="usage-bar-fill" style={{ width: `${Math.min(100, (totalItems / 50) * 100)}%` }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              <button
                className="icon-btn"
                onClick={cycleTheme}
                title={`Theme: ${THEME_LABEL[theme]} — click to cycle`}
                style={{ flex: 1, gap: '0.35rem', fontSize: '0.8rem', width: 'auto', paddingInline: '0.5rem' }}
              >
                {THEME_ICON[theme]} <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{THEME_LABEL[theme]}</span>
              </button>
              <button className="icon-btn" onClick={exportData} title="Export JSON" style={{ flex: 1 }}>📤</button>
              {tier === 'pro' && (
                <label className="icon-btn" style={{ flex: 1, cursor: 'pointer' }} title="Import data">
                  📥<input type="file" accept=".json" onChange={() => {}} style={{ display: 'none' }} />
                </label>
              )}
            </div>
            <button className="nav-item" onClick={() => setShowShortcuts(true)} style={{ marginTop: '0.25rem' }}>
              <span className="nav-item-icon">⌨️</span>Shortcuts
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="main-content">
          {/* Mobile nav */}
          <nav className="mobile-nav">
            {NAV_ITEMS.map(item => (
              <button key={item.view} className={`mobile-nav-btn${currentView === item.view ? ' active' : ''}`} onClick={() => setCurrentView(item.view)}>
                <span className="icon">{item.icon}</span>{item.label}
              </button>
            ))}
            <button className="mobile-nav-btn" onClick={cycleTheme}>
              <span className="icon">{THEME_ICON[theme]}</span>{THEME_LABEL[theme]}
            </button>
          </nav>

          {/* Top bar */}
          <div className="topbar">
            <span className="topbar-title">{PAGE_TITLES[currentView]}</span>
            <div className="topbar-actions">
              <button className="icon-btn" onClick={() => setCmdkOpen(true)} title="Command palette (⌘K)" style={{ fontSize: '1rem', position: 'relative' }}>
                ⌘K
                <span className="logo-mark" style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, padding: 0, fontSize: 0, boxShadow: 'none', background: 'var(--accent)', borderRadius: '50%' }} />
              </button>
              <button className="icon-btn" onClick={() => { notesUR.undo(); contactsUR.undo(); flashcardsUR.undo(); addToast('Undone', 'info'); }} disabled={!notesUR.canUndo && !contactsUR.canUndo && !flashcardsUR.canUndo} title="Undo (⌘Z)" style={{ fontSize: '1rem' }}>↩</button>
              <button className="icon-btn" onClick={() => { notesUR.redo(); contactsUR.redo(); flashcardsUR.redo(); addToast('Redone', 'info'); }} disabled={!notesUR.canRedo && !contactsUR.canRedo && !flashcardsUR.canRedo} title="Redo (⌘⇧Z)" style={{ fontSize: '1rem' }}>↪</button>
              {tier === 'pro'  && <span className="tag primary" style={{ fontSize: '0.75rem' }}>⭐ Pro</span>}
              {tier === 'free' && <button className="btn btn-primary btn-sm" onClick={() => setCurrentView('pricing')}>Upgrade</button>}
              <Achievements />
            </div>
          </div>

          {/* Pages — keyed wrapper animates on view switch */}
          <div className="page-content view-enter" key={currentView}>
            {/* Notification permission nudge — shows once until granted or dismissed */}
            {notif.supported && notif.permission === 'default' && (
              <NotifBanner onEnable={async () => {
                const result = await notif.request();
                if (result === 'granted') addToast('🔔 Reminders enabled! You\'ll get notified when items are due.', 'success');
              }} />
            )}
            {currentView === 'dashboard' && (
              <>
                <GoalTracker />
                <Dashboard
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
              </>
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
                signalingUrl={typeof import.meta.env.VITE_VOICE_SIGNALING_URL === 'string' ? import.meta.env.VITE_VOICE_SIGNALING_URL : ''}
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
              <SettingsView notif={notif} tier={tier} onAddToast={addToast} onShowShortcuts={() => setShowShortcuts(true)} onAISaved={ai.reloadConfig} folders={db.folders} theme={theme} onThemeChange={db.setTheme} />
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
          </div>
        </div>
      </div>

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
    </div>
  );
}
