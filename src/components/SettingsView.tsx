import { useState, useEffect, useCallback, useMemo } from 'react';
import type { UseNotificationsResult } from '../hooks/useNotifications';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';
import { ACCENT_THEMES } from '../config/accents';
import { getAIConfig, saveAIConfig, PROVIDERS, MODELS_BY_PROVIDER, DEFAULT_PROMPTS } from '../db/aiSettings';
import type { AIConfig, AIProvider } from '../db/aiSettings';
import * as serverAI from '../api/ai';
import Phase2Tools from './Phase2Tools';
import HeroDock from './HeroDock';
import FocusDial from './FocusDial';
import TimerSettingsPanel from './TimerSettingsPanel';
import ShortcutEditor from './ShortcutEditor';
import { useTimerSettings } from '../hooks/useTimerSettings';
import { useStudyGoals } from '../hooks/useStudyGoals';
import { useDeckSettings } from '../hooks/useDeckSettings';
import { MAX_LIMIT } from '../utils/deckSettings';
import {
  EDUCATION_LEVELS,
  SCHOOL_STAGES,
  UNIVERSITY_DEPARTMENTS,
  UNIVERSITY_YEARS,
  classesForStage,
  describeProfile,
  levelForStage,
  type SchoolStage,
} from '../config/studentProfile';
import { buildExportPayload, downloadJSON, openPrintableExport } from '../utils/dataExport';
import AnkiPanel from './AnkiPanel';
import { getDigestPreferences, saveDigestPreferences, sendDigestNow, DIGEST_DAY_NAMES } from '../api/digest';
import {
  IconBell, IconPeople, IconTimer, IconSparkles, IconTutor,
  IconDownload, IconLock, IconSearch,
  IconTarget,
} from './icons';

interface SettingsViewProps {
  notif: UseNotificationsResult;
  tier: string;
  onAddToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onShowShortcuts: () => void;
  onAISaved?: () => void;
  folders: Folder[];
  theme: string;
  onThemeChange: (v: string) => void;
  accent?: string;
  onAccentChange?: (v: string) => void;
  /** The real library — the export buttons must not ship empty arrays. */
  data: {
    notes: Note[];
    contacts: Contact[];
    flashcards: Flashcard[];
    practiceQuestions: PracticeQuestion[];
    savedSearches: SavedSearch[];
  };
  /** Persists flashcards — the Anki import writes into the real deck. */
  setFlashcards?: (next: Flashcard[]) => void;
  /** Shown on the docked chip once the hero flies into the corner. */
  displayName?: string;
}

interface ProfileState {
  schoolStage: SchoolStage | '';
  schoolClass: string;
  universityYear: string;
  department: string;
  departmentCustom: string;
  educationLevel: string;
}

const EMPTY_PROFILE: ProfileState = {
  schoolStage: '',
  schoolClass: '',
  universityYear: '',
  department: '',
  departmentCustom: '',
  educationLevel: '',
};

export default function SettingsView({
  notif, tier, onAddToast, onShowShortcuts, onAISaved, folders,
  theme, onThemeChange, accent, onAccentChange, data, setFlashcards, displayName,
}: SettingsViewProps) {
  const [testing, setTesting] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);
  const [storageDetail, setStorageDetail] = useState<{ used: number; quota: number } | null>(null);

  // Settings search — typing filters the cards in place.
  const [query, setQuery] = useState('');
  // Anti-autofill guard: browsers "helpfully" type the user's saved email
  // into this box right after login, which instantly filters every card out
  // ("0 matches"). While the field is locked (readonly) nothing can be
  // injected into it on page load — it unlocks the moment the user actually
  // focuses or starts typing.
  const [searchLocked, setSearchLocked] = useState(true);
  // Bumped to force a re-render when an injection is rejected, so React
  // wipes the injected value out of the controlled input.
  const [, bumpSearchRender] = useState(0);

  // Study timer settings — shared with the Timer tab (one store, one UI).
  const { settings: timerSettings, update: updateTimer } = useTimerSettings();

  // Daily study targets — shared with the Dashboard.
  const { goals, updateGoal } = useStudyGoals();
  const { limits, setLimits, decks, setDeckLimit } = useDeckSettings();
  // Which folder the student is about to give its own limits. Kept apart
  // from the overrides themselves so the picker does not reset every time
  // one is changed.
  const [deckToAdd, setDeckToAdd] = useState('');

  // Weekly email digest — off until the student turns it on.
  const [digestOn, setDigestOn] = useState(false);
  const [digestDay, setDigestDay] = useState(1);
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestSending, setDigestSending] = useState(false);

  // AI config state
  const [aiConfig, setAiConfigState] = useState<AIConfig>({ provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash', enabled: false });
  const [showKey, setShowKey]     = useState(false);
  const [savingAI, setSavingAI]   = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [serverManaged, setServerManaged] = useState(false);
  const [serverHasApiKey, setServerHasApiKey] = useState(false);

  // Student profile — the single place level/credentials are edited.
  const [profile, setProfile] = useState<ProfileState>(EMPTY_PROFILE);
  const [levelTouched, setLevelTouched] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    getAIConfig().then(setAiConfigState);
    // The digest preference lives on the server so it follows the student
    // between devices.
    getDigestPreferences()
      .then(p => { setDigestOn(p.enabled); setDigestDay(p.day); })
      .catch(() => {});
    serverAI.fetchAISettings().then(s => {
      if (s) {
        setServerManaged(s.serverManaged);
        setServerHasApiKey(s.hasApiKey);
        // If the server has a key, reflect that in the local config
        // so the Settings UI shows the correct saved-on-server state.
        if (s.hasApiKey) {
          setAiConfigState(prev => ({ ...prev, apiKey: '(saved on server)' }));
        }
      }
    }).catch(() => {});

    // Estimate storage usage
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage !== undefined && quota !== undefined) {
          const usedMB  = (usage  / 1024 / 1024).toFixed(1);
          const quotaMB = (quota / 1024 / 1024).toFixed(0);
          setStorageUsed(`${usedMB} MB used of ~${quotaMB} MB available`);
          setStorageDetail({ used: usage, quota });
        }
      });
    }
  }, []);

  // Load the saved student profile so the card reflects reality instead of
  // always starting blank.
  useEffect(() => {    serverAI.fetchStudentProfile().then(res => {
      if (!res) return;
      const u = res.user;
      const known = UNIVERSITY_DEPARTMENTS.includes(u.department ?? '');
      setProfile({
        schoolStage: (u.schoolStage ?? '') as SchoolStage | '',
        schoolClass: u.schoolClass ?? '',
        universityYear: u.universityYear ?? '',
        department: u.department ? (known ? u.department : 'Other') : '',
        departmentCustom: u.department && !known ? u.department : '',
        educationLevel: u.educationLevel ?? (u.schoolStage ? levelForStage(u.schoolStage as SchoolStage) : ''),
      });
    }).catch(() => {});
  }, []);

  // ── Student profile handlers ──────────────────────────────────────────────
  const applyStage = (stage: SchoolStage | '') => {
    setProfile(p => ({
      ...p,
      schoolStage: stage,
      schoolClass: stage === 'primary' || stage === 'secondary' ? p.schoolClass : '',
      universityYear: stage === 'university' ? p.universityYear : '',
      department: stage === 'university' ? p.department : '',
      departmentCustom: stage === 'university' ? p.departmentCustom : '',
      educationLevel: levelTouched ? p.educationLevel : levelForStage(stage),
    }));
  };

  const applyYear = (year: string) => {
    setProfile(p => ({
      ...p,
      universityYear: year,
      educationLevel: levelTouched
        ? p.educationLevel
        : (year === 'Postgraduate' ? 'graduate' : 'university'),
    }));
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const department = profile.department === 'Other' ? profile.departmentCustom.trim() : profile.department;
      await serverAI.saveFullStudentProfile({
        educationLevel: profile.educationLevel || null,
        schoolStage: profile.schoolStage || null,
        schoolClass:
          profile.schoolStage === 'primary' || profile.schoolStage === 'secondary'
            ? (profile.schoolClass || null)
            : null,
        universityYear: profile.schoolStage === 'university' ? (profile.universityYear || null) : null,
        department: profile.schoolStage === 'university' ? (department || null) : null,
      });
      onAddToast('Student profile saved — your AI now teaches at your level.', 'success');
    } catch (err: any) {
      onAddToast(err.message || 'Failed to save profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Data management helpers ───────────────────────────────────────────────
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const exportBundle = useCallback(() => ({
    notes:             data.notes,
    contacts:          data.contacts,
    flashcards:        data.flashcards,
    folders,
    practiceQuestions: data.practiceQuestions,
    savedSearches:     data.savedSearches,
  }), [data.notes, data.contacts, data.flashcards, folders, data.practiceQuestions, data.savedSearches]);

  const handleClearCache = async () => {
    if (!confirm('Clear all local data? This removes notes, contacts, flashcards, and settings. You will be signed out. This cannot be undone.')) return;
    try {
      const dbsPromise = indexedDB.databases?.() || Promise.resolve([]);
      const dbs = await dbsPromise;
      for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
      localStorage.clear();
      sessionStorage.clear();
      onAddToast('Local data cleared. Reloading…', 'success');
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      onAddToast(`Clear failed: ${err.message}`, 'error');
    }
  };

  const handleExportJSON = () => {
    downloadJSON(buildExportPayload(exportBundle()));
    onAddToast('Data exported as JSON!', 'success');
  };

  const handleExportPDF = () => {
    const ok = openPrintableExport(exportBundle(), tier);
    if (!ok) onAddToast('Pop-up blocked. Please allow pop-ups for PDF export.', 'error');
  };

  const handleSaveAI = async () => {
    setSavingAI(true);
    try {
      // Save to local IDB so the client-side fallback path still works
      // for users who opt out of cloud AI.
      await saveAIConfig(aiConfig);

      // Save to the server for EVERY user — since the BYOK flow, any
      // authenticated user may store their own key encrypted server-side.
      // Subsequent AI calls go through the server proxy (rate-limited, and
      // the key follows the user across devices).
      try {
        const apiKey = aiConfig.apiKey && aiConfig.apiKey !== '(saved on server)' ? aiConfig.apiKey : undefined;
        const result = await serverAI.saveAISettings({
          provider:             aiConfig.provider,
          model:                aiConfig.model,
          enabled:              aiConfig.enabled,
          apiKey,
          customSummaryPrompt:   aiConfig.customSummaryPrompt,
          customFlashcardPrompt: aiConfig.customFlashcardPrompt,
          customQAPrompt:        aiConfig.customQAPrompt,
        });
        setServerManaged(result.serverManaged);
        setServerHasApiKey(result.hasApiKey);
        onAddToast(result.serverManaged ? '🖥️ Using backend-managed AI key.' : apiKey ? '🔒 AI key saved (encrypted on server).' : '✅ AI settings saved.', 'success');
      } catch (serverErr: any) {
        onAddToast(`Saved locally; server save failed: ${serverErr.message}`, 'error');
      }

      onAISaved?.();
    } catch {
      onAddToast('Failed to save AI settings.', 'error');
    } finally {
      setSavingAI(false);
    }
  };

  const handleTestAI = async () => {
    // If the key is stored on the server (or this deployment is backend-
    // managed), test through the server proxy — the key may be hidden here.
    if (aiConfig.apiKey === '(saved on server)' || (!aiConfig.apiKey && serverHasApiKey)) {
      setTestingAI(true);
      try {
        const r = await serverAI.testAIKey({});
        onAddToast(r.ok ? '✅ StudyWorks AI is working! (via server proxy)' : `AI test failed: ${r.error}`, r.ok ? 'success' : 'error');
      } catch (err: any) {
        onAddToast(`AI test failed: ${err.message}`, 'error');
      } finally {
        setTestingAI(false);
      }
      return;
    }
    if (!aiConfig.apiKey) { onAddToast('Enter an API key first.', 'info'); return; }
    setTestingAI(true);
    try {
      const r = await serverAI.testAIKey({
        provider: aiConfig.provider,
        model:    aiConfig.model,
        apiKey:   aiConfig.apiKey,
      });
      onAddToast(r.ok ? `✅ Key works! (${r.model ?? aiConfig.model})` : `AI test failed: ${r.error}`, r.ok ? 'success' : 'error');
    } catch (err: any) {
      onAddToast(`AI test failed: ${err.message}`, 'error');
    } finally {
      setTestingAI(false);
    }
  };

  const handleEnable = async () => {
    const result = await notif.request();
    if (result === 'granted') {
      onAddToast('🔔 Notifications enabled!', 'success');
    } else if (result === 'denied') {
      onAddToast('Notifications blocked. Allow them in your browser settings.', 'error');
    } else {
      onAddToast('Permission not granted.', 'info');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTimeout(() => {
      notif.notify('📝 Test Reminder — StudyWorks', {
        body: 'This is a test notification. Reminders will look like this.',
        tag:  'test-notif',
      });
      setTesting(false);
      onAddToast('Test notification sent!', 'success');
    }, 500);
  };

  const permColor: Record<string, string> = {
    granted:     'var(--success)',
    denied:      'var(--danger)',
    default:     'var(--accent)',
    unsupported: 'var(--text-3)',
  };

  const permLabel: Record<string, string> = {
    granted:     '✅ Granted',
    denied:      '❌ Blocked',
    default:     '⏳ Not asked yet',
    unsupported: '🚫 Not supported',
  };

  const profileSummary = describeProfile(profile);
  const levelLabel = EDUCATION_LEVELS.find(l => l.value === profile.educationLevel)?.label ?? 'Not set';
  const activeAccent = ACCENT_THEMES.find(t => t.id === accent);
  const classOptions = classesForStage(profile.schoolStage);
  const totalItems = data.notes.length + data.contacts.length + data.flashcards.length;

  // Stable callbacks so the shortcut editor's key-capture listener isn't torn
  // down and re-registered on every render.
  const shortcutError = useCallback((msg: string) => onAddToast(msg, 'error'), [onAddToast]);
  const shortcutSuccess = useCallback((msg: string) => onAddToast(msg, 'success'), [onAddToast]);

  /** Does a card's keyword list match the current search? */
  const matches = useCallback((...keywords: string[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return keywords.some(k => k.toLowerCase().includes(q));
  }, [query]);

  const visibleCount = useMemo(() => {
    const cards: boolean[] = [
      matches('profile', 'student', 'stage', 'class', 'department', 'level', 'education', 'account'),
      matches('timer', 'focus', 'break', 'pomodoro', 'study preferences'),
      matches('daily goal', 'goal', 'target', 'minutes', 'hours', 'study preferences'),
      matches('notification', 'reminder', 'permission', 'background'),
      matches('appearance', 'theme', 'accent', 'colour', 'color', 'light', 'dark'),
      matches('install', 'pwa', 'desktop', 'ios', 'android'),
      matches('ai', 'gemini', 'openai', 'api key', 'model', 'provider', 'prompt'),
      matches('keyboard', 'shortcut', 'rebind', 'command palette'),
      matches('data', 'storage', 'export', 'pdf', 'json', 'clear', 'privacy', 'quota'),
      matches('share', 'sharing', 'email', 'support', 'ticket', 'folder'),
    ];
    return cards.filter(Boolean).length;
  }, [matches]);

  const goalHours = goals.dailyStudyMinutes / 60;
  const goalHoursLabel = Number.isInteger(goalHours)
    ? `${goalHours}`
    : goalHours.toFixed(1);
  const goalUnit = goalHours === 1 ? 'hr' : 'hrs';

  const timerPresets = [15, 25, 45, 60];

  const initials = (displayName || 'S').trim().charAt(0).toUpperCase();

  return (
    <div className="sw-settings animate-in">
      <div className="sw-settings-shell">

        {/* ── Page ────────────────────────────────────────────────────── */}
        <div className="sw-settings-main">

          {/* Header — the title flies into the corner on scroll, the search
              field stays put. */}
          <div className="sw-settings-head">
            <HeroDock
              side="right"
              chipIcon="⚙️"
              chipLabel="Settings"
              chipMeta={displayName || undefined}
              bannerClassName="sw-settings-hero"
            >
              <div>
                <span className="sw-label">Your workspace</span>
                <h1 className="sw-settings-title">Settings</h1>
                <p className="sw-settings-sub">
                  Shape StudyWorks around the way you actually study.
                </p>
                <div className="sw-id-tags" style={{ marginTop: '0.875rem' }}>
                  <span className="tag">🎓 {profileSummary}</span>
                  <span className="tag">⭐ {tier === 'pro' ? 'Pro plan' : 'Free plan'}</span>
                  <span className="tag">📚 {totalItems} items</span>
                </div>
              </div>
            </HeroDock>

            <div className="sw-settings-search">
              <IconSearch size={15} />
              <input
                type="search"
                name="sw-settings-search"
                value={query}
                onChange={e => {
                  if (searchLocked) {
                    e.target.value = '';          // wipe anything a browser/extension injected
                    bumpSearchRender(t => t + 1); // and force React to re-sync the controlled value
                    return;
                  }
                  setQuery(e.target.value);
                }}
                onFocus={() => setSearchLocked(false)}
                onKeyDown={() => setSearchLocked(false)}
                readOnly={searchLocked}
                placeholder="Search settings"
                aria-label="Search settings"
                // Browsers ignore plain "off" and offer saved emails here —
                // an unrecognized token suppresses autofill suggestions.
                autoComplete="sw-settings-search"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                role="searchbox"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
              {query && (
                <span className="sw-settings-search-count">
                  {visibleCount} match{visibleCount === 1 ? '' : 'es'}
                </span>
              )}
            </div>
          </div>

          <div className="sw-settings-grid">

            {/* ── Student profile ─────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-2${matches('profile', 'student', 'stage', 'class', 'department', 'level', 'education', 'account') ? '' : ' is-filtered'}`}
              id="settings-account"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🎓 Student Profile</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>The one place your study level is set</p>
                  </div>
                  <span className="sw-glyph" aria-hidden="true"><IconPeople size={14} /></span>
                </div>

                <div className="sw-id">
                  <div className="sw-id-avatar">{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="sw-id-name">{displayName || 'Your account'}</div>
                    <div className="sw-id-mail">{levelLabel}</div>
                    <div className="sw-id-tags">
                      <span className="tag success">{profileSummary}</span>
                    </div>
                  </div>
                </div>

                <p className="card-note">
                  The AI Tutor, flashcard generator and Quiz Battle all read this, so lessons
                  match your exact class or year instead of guessing.
                </p>

                <div className="sw-field-list">
                  {/* Stage */}
                  <div className="sw-field">
                    <label className="form-label" htmlFor="sw-profile-stage">Education stage</label>
                    <select
                      id="sw-profile-stage"
                      className="select"
                      value={profile.schoolStage}
                      onChange={e => applyStage(e.target.value as SchoolStage | '')}
                    >
                      <option value="">Select stage…</option>
                      {SCHOOL_STAGES.map(s => (
                        <option key={s.value} value={s.value}>{s.label} — {s.hint}</option>
                      ))}
                    </select>
                  </div>

                  {/* Exact class (primary / secondary) */}
                  {classOptions.length > 0 && (
                    <div className="sw-field">
                      <label className="form-label" htmlFor="sw-profile-class">Your class</label>
                      <select
                        id="sw-profile-class"
                        className="select"
                        value={profile.schoolClass}
                        onChange={e => setProfile(p => ({ ...p, schoolClass: e.target.value }))}
                      >
                        <option value="">Select class…</option>
                        {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}

                  {/* University year */}
                  {profile.schoolStage === 'university' && (
                    <div className="sw-field">
                      <label className="form-label" htmlFor="sw-profile-year">Your year</label>
                      <select
                        id="sw-profile-year"
                        className="select"
                        value={profile.universityYear}
                        onChange={e => applyYear(e.target.value)}
                      >
                        <option value="">Select year…</option>
                        {UNIVERSITY_YEARS.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Department */}
                  {profile.schoolStage === 'university' && (
                    <div className="sw-field">
                      <label className="form-label" htmlFor="sw-profile-dept">Department</label>
                      <select
                        id="sw-profile-dept"
                        className="select"
                        value={profile.department}
                        onChange={e => setProfile(p => ({ ...p, department: e.target.value }))}
                      >
                        <option value="">Select department…</option>
                        {UNIVERSITY_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {profile.department === 'Other' && (
                        <input
                          className="input"
                          style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}
                          placeholder="Type your department"
                          value={profile.departmentCustom}
                          onChange={e => setProfile(p => ({ ...p, departmentCustom: e.target.value }))}
                        />
                      )}
                    </div>
                  )}

                  {/* Generic study level */}
                  <div className="sw-field">
                    <label className="form-label" htmlFor="sw-profile-level">Study level</label>
                    <select
                      id="sw-profile-level"
                      className="select"
                      value={profile.educationLevel}
                      onChange={e => { setLevelTouched(true); setProfile(p => ({ ...p, educationLevel: e.target.value })); }}
                    >
                      <option value="">Select level…</option>
                      {EDUCATION_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="sw-card-foot">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveProfile}
                    disabled={savingProfile || !profile.schoolStage}
                  >
                    {savingProfile ? 'Saving…' : '💾 Save student profile'}
                  </button>
                  {!profile.schoolStage && (
                    <p className="text-xs text-muted">
                      Pick your education stage to enable saving.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Focus timer ──────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-2${matches('timer', 'focus', 'break', 'pomodoro', 'study preferences') ? '' : ' is-filtered'}`}
              id="settings-study"
            >
              <div className="card sw-dark-card">
                <div className="card-header">
                  <div>
                    <span className="card-title">⏱️ Study Timer</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Pomodoro rhythm for deep work</p>
                  </div>
                  <span className="sw-glyph" aria-hidden="true"><IconTimer size={14} /></span>
                </div>

                <div className="sw-timer-card">
                  <FocusDial
                    seconds={timerSettings.focusDuration * 60}
                    total={timerSettings.focusDuration * 60}
                    color="var(--sw-accent)"
                    size={124}
                  >
                    <span className="sw-dial-tag">Focus</span>
                    <span className="sw-dial-readout" style={{ fontSize: '1.45rem' }}>
                      {timerSettings.focusDuration}:00
                    </span>
                    <span className="sw-dial-caption">per session</span>
                  </FocusDial>

                  {/* A read-only summary beside the dial — the editable
                      controls live in the shared panel below. */}
                  <div className="sw-timer-side">
                    <div className="sw-timer-fact">
                      <span className="sw-timer-fact-key">Focus session</span>
                      <span className="sw-timer-fact-val">{timerSettings.focusDuration} min</span>
                    </div>
                    <div className="sw-timer-fact">
                      <span className="sw-timer-fact-key">Break</span>
                      <span className="sw-timer-fact-val">{timerSettings.breakDuration} min</span>
                    </div>
                    <div className="sw-timer-presets">
                      {timerPresets.map(p => (
                        <button
                          key={p}
                          type="button"
                          className={`sw-timer-preset${timerSettings.focusDuration === p ? ' active' : ''}`}
                          onClick={() => updateTimer({ focusDuration: p })}
                          aria-pressed={timerSettings.focusDuration === p}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="sw-timer-panel">
                  <TimerSettingsPanel settings={timerSettings} onChange={updateTimer} />
                </div>
              </div>
            </div>

            {/* ── Daily goal ───────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-2${matches('daily goal', 'goal', 'target', 'minutes', 'hours', 'study preferences') ? '' : ' is-filtered'}`}
            >
              <div className="card sw-solid-card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🎯 Daily goal</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Hours of focus you aim for each day</p>
                  </div>
                  <span className="sw-glyph" aria-hidden="true"><IconTarget size={14} /></span>
                </div>

                <div className="sw-goal-hero">
                  <span className="sw-goal-hero-value">{goalHoursLabel}</span>
                  <span className="sw-goal-hero-unit">{goalUnit}</span>
                </div>

                <input
                  className="sw-range"
                  type="range"
                  min="15"
                  max="120"
                  step="15"
                  value={goals.dailyStudyMinutes}
                  onChange={e => updateGoal('dailyStudyMinutes', Number(e.target.value))}
                  aria-label="Daily focus goal in minutes"
                />
                <div className="sw-range-scale">
                  <span>15 min</span>
                  <span>2 hrs</span>
                </div>

                <div className="sw-kv sw-goal-rows">
                  <div className="sw-kv-row">
                    <span className="sw-kv-key">Flashcards per day</span>
                    <span className="sw-row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => updateGoal('dailyFlashcards', Math.max(1, goals.dailyFlashcards - 5))}
                        aria-label="Fewer flashcards per day"
                      >−</button>
                      <span className="sw-kv-val">{goals.dailyFlashcards}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => updateGoal('dailyFlashcards', goals.dailyFlashcards + 5)}
                        aria-label="More flashcards per day"
                      >+</button>
                    </span>
                  </div>
                  <div className="sw-kv-row">
                    <span className="sw-kv-key">Notes to revisit</span>
                    <span className="sw-row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => updateGoal('dailyNotes', Math.max(1, goals.dailyNotes - 1))}
                        aria-label="Fewer notes per day"
                      >−</button>
                      <span className="sw-kv-val">{goals.dailyNotes}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => updateGoal('dailyNotes', goals.dailyNotes + 1)}
                        aria-label="More notes per day"
                      >+</button>
                    </span>
                  </div>
                </div>

                <p className="card-note" style={{ margin: '1rem 0 0' }}>
                  The same targets drive your dashboard progress ring.
                </p>
              </div>
            </div>

            {/* ── Daily limits ─────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('limit', 'daily', 'backlog', 'cap', 'deck') ? '' : ' is-filtered'}`}
              id="settings-limits"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🧱 Daily Limits</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>
                      A small amount every day beats a mountain once
                    </p>
                  </div>
                  <div className="sw-card-aside">
                    <span className="sw-glyph" aria-hidden="true"><IconTarget size={14} /></span>
                  </div>
                </div>

                <p className="card-note" style={{ margin: '0 0 1rem' }}>
                  When a backlog builds up, these caps decide how much of it you tackle today.
                  The rest waits for tomorrow — it is not lost, and it is not overdue.
                </p>

                <div className="sw-kv sw-goal-rows">
                  <div className="sw-kv-row">
                    <span className="sw-kv-key">New cards per day</span>
                    <span className="sw-row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => setLimits({ newPerDay: Math.max(0, limits.newPerDay - 5) })}
                        aria-label="Fewer new cards per day"
                      >−</button>
                      <span className="sw-kv-val">{limits.newPerDay}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => setLimits({ newPerDay: Math.min(MAX_LIMIT, limits.newPerDay + 5) })}
                        aria-label="More new cards per day"
                      >+</button>
                    </span>
                  </div>
                  <div className="sw-kv-row">
                    <span className="sw-kv-key">Reviews per day</span>
                    <span className="sw-row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => setLimits({ reviewsPerDay: Math.max(0, limits.reviewsPerDay - 25) })}
                        aria-label="Fewer reviews per day"
                      >−</button>
                      <span className="sw-kv-val">{limits.reviewsPerDay}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => setLimits({ reviewsPerDay: Math.min(MAX_LIMIT, limits.reviewsPerDay + 25) })}
                        aria-label="More reviews per day"
                      >+</button>
                    </span>
                  </div>
                </div>

                <p className="card-note" style={{ margin: '1rem 0 0' }}>
                  The Study Plan and the flashcard review both stop at these limits.
                </p>

                {/* ── Per-deck overrides ────────────────────────────────── */}
                {/*
                  A student often wants to hammer one subject before an exam.
                  A deck's own limit replaces the global one for the material
                  filed in it, so "20 new Biology cards today, nothing else"
                  is one line rather than a whole second plan.
                */}
                <div className="sw-settings-decks">
                  <div className="sw-settings-decks-head">
                    <span className="sw-kv-key">Per-deck limits</span>
                    <span className="sw-row" style={{ gap: 8 }}>
                      <select
                        className="select"
                        value={deckToAdd}
                        onChange={e => setDeckToAdd(e.target.value)}
                        aria-label="Choose a deck to give its own limits"
                      >
                        <option value="">Choose a deck…</option>
                        {folders
                          .filter(f => f.id !== 'default')
                          .filter(f => !decks.some(d => d.folderId === f.id))
                          .map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={!deckToAdd}
                        onClick={() => {
                          const folder = folders.find(f => f.id === deckToAdd);
                          if (!folder) return;
                          // Start from the global numbers, so the deck starts
                          // at "the same as everything else" and the student
                          // adjusts from there.
                          setDeckLimit(folder.id, folder.name, { ...limits });
                          setDeckToAdd('');
                        }}
                      >
                        Add
                      </button>
                    </span>
                  </div>

                  {decks.length === 0 ? (
                    <p className="card-note" style={{ margin: '0.5rem 0 0' }}>
                      No deck has its own limits yet — every deck follows the numbers above.
                    </p>
                  ) : (
                    <div className="sw-settings-deck-list">
                      {decks.map(d => {
                        const deckNew = d.newPerDay ?? limits.newPerDay;
                        const deckReviews = d.reviewsPerDay ?? limits.reviewsPerDay;
                        const set = (next: { newPerDay?: number; reviewsPerDay?: number }) =>
                          setDeckLimit(d.folderId, d.name, next);
                        return (
                          <div key={d.folderId} className="sw-settings-deck">
                            <div className="sw-settings-deck-head">
                              <span className="sw-settings-deck-name">📁 {d.name || 'Folder'}</span>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => setDeckLimit(d.folderId, d.name, {})}
                              >
                                Use the global limits
                              </button>
                            </div>
                            <div className="sw-settings-deck-rows">
                              <div className="sw-kv-row">
                                <span className="sw-kv-key">New per day</span>
                                <span className="sw-row" style={{ gap: 8 }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    onClick={() => set({ newPerDay: Math.max(0, deckNew - 5) })}
                                    aria-label={`Fewer new cards in ${d.name}`}
                                  >−</button>
                                  <span className="sw-kv-val">{deckNew}</span>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    onClick={() => set({ newPerDay: Math.min(MAX_LIMIT, deckNew + 5) })}
                                    aria-label={`More new cards in ${d.name}`}
                                  >+</button>
                                </span>
                              </div>
                              <div className="sw-kv-row">
                                <span className="sw-kv-key">Reviews per day</span>
                                <span className="sw-row" style={{ gap: 8 }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    onClick={() => set({ reviewsPerDay: Math.max(0, deckReviews - 25) })}
                                    aria-label={`Fewer reviews in ${d.name}`}
                                  >−</button>
                                  <span className="sw-kv-val">{deckReviews}</span>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-xs"
                                    onClick={() => set({ reviewsPerDay: Math.min(MAX_LIMIT, deckReviews + 25) })}
                                    aria-label={`More reviews in ${d.name}`}
                                  >+</button>
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Notifications ────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('notification', 'reminder', 'permission', 'background') ? '' : ' is-filtered'}`}
              id="settings-notifications"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🔔 Notifications &amp; Reminders</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Gentle nudges, never noise</p>
                  </div>
                  <div className="sw-card-aside">
                    <span className="sw-glyph" aria-hidden="true"><IconBell size={14} /></span>
                    <span className="sw-card-status" style={{ color: permColor[notif.permission] }}>
                      {permLabel[notif.permission]}
                    </span>
                  </div>
                </div>

                <div className="sw-switch-row">
                  <div>
                    <div className="sw-switch-label">Reminders</div>
                    <div className="sw-switch-note">
                      Notes and contacts notify you when they fall due for review.
                    </div>
                  </div>
                  {notif.permission !== 'granted' && notif.permission !== 'denied' && notif.supported ? (
                    <button className="btn btn-primary btn-sm" onClick={handleEnable}>
                      🔔 Enable
                    </button>
                  ) : notif.permission === 'granted' ? (
                    <button className="btn btn-secondary btn-sm" onClick={handleTest} disabled={testing}>
                      {testing ? 'Sending…' : '🧪 Test'}
                    </button>
                  ) : (
                    <span className="tag danger">Blocked</span>
                  )}
                </div>

                <div className="sw-switch-row">
                  <div>
                    <div className="sw-switch-label">Background checks</div>
                    <div className="sw-switch-note">
                      The service worker checks every hour, even when the tab is closed.
                    </div>
                  </div>
                  <span className="tag success">Always on</span>
                </div>

                {notif.permission === 'denied' && (
                  <div className="sw-mini" style={{ marginTop: '0.75rem', borderColor: 'var(--danger)' }}>
                    <div className="sw-mini-title" style={{ color: 'var(--danger)' }}>Notifications are blocked</div>
                    <div className="sw-mini-body">
                      Click the 🔒 icon in your browser's address bar → Notifications → Allow.
                    </div>
                  </div>
                )}
                {!notif.supported && (
                  <p className="text-sm text-muted" style={{ marginTop: '0.75rem' }}>
                    Your browser doesn't support the Notifications API.
                  </p>
                )}

                <div className="sw-mini-grid" style={{ marginTop: '0.875rem' }}>
                  {[
                    { icon: '📝', title: 'Note reminders', desc: 'Set a "Revisit" date on any note via the ⏰ button.' },
                    { icon: '👥', title: 'Contact reminders', desc: 'Schedule a follow-up when adding or editing a person.' },
                    { icon: '🌙', title: 'Background checks', desc: 'Service worker checks hourly even when the app is closed.' },
                    { icon: '🖱️', title: 'Click to navigate', desc: 'Clicking a notification opens the relevant view directly.' },
                  ].map(item => (
                    <div key={item.title} className="sw-mini">
                      <div className="sw-mini-icon">{item.icon}</div>
                      <div className="sw-mini-title">{item.title}</div>
                      <div className="sw-mini-body">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Weekly digest ─────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('digest', 'email', 'weekly', 'newsletter') ? '' : ' is-filtered'}`}
              id="settings-digest"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">📬 Weekly digest</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>
                      One email a week: what you studied, what is waiting
                    </p>
                  </div>
                  <div className="sw-card-aside">
                    <span className="sw-glyph" aria-hidden="true"><IconBell size={14} /></span>
                    <span className="sw-card-status" style={{ color: digestOn ? 'var(--success)' : 'var(--muted-foreground)' }}>
                      {digestOn ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                <div className="sw-switch-row">
                  <div>
                    <div className="sw-switch-label">Email me my week</div>
                    <div className="sw-switch-note">
                      Off by default. Nothing is sent until you turn this on, and turning it
                      off stops it immediately.
                    </div>
                  </div>
                  <button
                    className="toggle"
                    onClick={async () => {
                      const next = !digestOn;
                      setDigestOn(next);
                      setDigestSaving(true);
                      try {
                        await saveDigestPreferences({ enabled: next, day: digestDay });
                        onAddToast(
                          next
                            ? `Weekly digest on — it will land every ${DIGEST_DAY_NAMES[digestDay]}.`
                            : 'Weekly digest off.',
                          'success',
                        );
                      } catch (err: any) {
                        setDigestOn(!next); // put the switch back
                        onAddToast(err.message || 'Could not save the digest setting.', 'error');
                      } finally {
                        setDigestSaving(false);
                      }
                    }}
                    role="switch"
                    aria-checked={digestOn}
                    aria-label="Email me my week"
                    disabled={digestSaving}
                  />
                </div>

                {digestOn && (
                  <>
                    <div className="sw-switch-row" style={{ marginTop: '0.75rem' }}>
                      <div>
                        <div className="sw-switch-label">Which day</div>
                        <div className="sw-switch-note">
                          The email arrives on this day, covering the week just gone.
                        </div>
                      </div>
                      <select
                        className="select select-sm"
                        value={digestDay}
                        onChange={async e => {
                          const day = Number(e.target.value);
                          setDigestDay(day);
                          try {
                            await saveDigestPreferences({ enabled: true, day });
                          } catch (err: any) {
                            onAddToast(err.message || 'Could not save the day.', 'error');
                          }
                        }}
                        style={{ width: 'auto' }}
                        aria-label="Day the digest arrives"
                      >
                        {DIGEST_DAY_NAMES.map((name, i) => (
                          <option key={name} value={i}>{name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="sw-switch-row" style={{ marginTop: '0.5rem' }}>
                      <div>
                        <div className="sw-switch-label">Send me one now</div>
                        <div className="sw-switch-note">
                          A preview of the real thing, so you know what you are signing up for.
                        </div>
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={digestSending}
                        onClick={async () => {
                          setDigestSending(true);
                          try {
                            await sendDigestNow();
                            onAddToast('Digest sent — check your inbox.', 'success');
                          } catch (err: any) {
                            onAddToast(err.message || 'Could not send the digest.', 'error');
                          } finally {
                            setDigestSending(false);
                          }
                        }}
                      >
                        {digestSending ? 'Sending…' : '📧 Send it'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Appearance ───────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('appearance', 'theme', 'accent', 'colour', 'color', 'light', 'dark') ? '' : ' is-filtered'}`}
              id="settings-appearance"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🎨 Appearance</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Pick a mood for your study space</p>
                  </div>
                  <span className="sw-glyph" aria-hidden="true"><IconSparkles size={14} /></span>
                </div>

                <div className="sw-theme-grid">
                  {([
                    { id: 'system', label: 'System', bg: 'linear-gradient(135deg,#FAF7F1 50%,#1B1815 50%)', ink: '#1B1815' },
                    { id: 'light',  label: 'Light',  bg: '#FAF7F1', ink: '#1B1815' },
                    { id: 'dark',   label: 'Dark',   bg: '#1B1815', ink: '#FAF7F1' },
                  ]).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      className={`sw-theme-tile${theme === t.id ? ' active' : ''}`}
                      onClick={() => onThemeChange(t.id)}
                      aria-pressed={theme === t.id}
                    >
                      <span className="sw-theme-swatch" style={{ background: t.bg, color: t.ink }}>
                        <i style={{ flex: 1 }} />
                        <i style={{ flex: 1.4 }} />
                        <i style={{ flex: 1 }} />
                      </span>
                      <span className="sw-theme-label">{t.label}</span>
                    </button>
                  ))}
                </div>

                {/* Accent colour — works independently of light/dark mode */}
                {accent !== undefined && onAccentChange && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Accent colour</p>
                    <p className="text-xs text-muted" style={{ marginBottom: '0.625rem' }}>
                      Changes buttons, highlights and glows — combines with Light/Dark mode for {ACCENT_THEMES.length * 2} total looks.
                    </p>
                    <div className="sw-accent-grid">
                      {ACCENT_THEMES.map(t => {
                        const active = accent === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`sw-accent-chip${active ? ' active' : ''}`}
                            onClick={() => onAccentChange(t.id)}
                            title={t.label}
                            aria-label={`Accent colour: ${t.label}`}
                            aria-pressed={active}
                          >
                            <span
                              className="sw-accent-dot"
                              style={{ background: `linear-gradient(135deg, ${t.a} 55%, ${t.b} 55%)` }}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <p className="sw-accent-caption">
                      <span
                        className="sw-accent-dot"
                        style={{
                          background: activeAccent
                            ? `linear-gradient(135deg, ${activeAccent.a} 55%, ${activeAccent.b} 55%)`
                            : 'var(--sw-line-strong)',
                        }}
                      />
                      {activeAccent ? activeAccent.label : 'Accent colour'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Install app ──────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('install', 'pwa', 'desktop', 'ios', 'android') ? '' : ' is-filtered'}`}
              id="settings-install"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">📱 Install App</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>A native-like app, no app store</p>
                  </div>
                  <span className="sw-glyph" aria-hidden="true"><IconDownload size={14} /></span>
                </div>

                <div className="sw-mini-grid">
                  {[
                    { platform: '🖥️ Desktop', sub: 'Chrome / Edge', steps: ['Click the ⊞ icon in the address bar', 'Click "Install"'] },
                    { platform: '📱 iOS', sub: 'Safari', steps: ['Tap the Share button', 'Tap "Add to Home Screen"'] },
                    { platform: '🤖 Android', sub: 'Chrome', steps: ['Tap the ⋮ menu', 'Tap "Install app"'] },
                  ].map(p => (
                    <div key={p.platform} className="sw-mini">
                      <div className="sw-mini-title">{p.platform}</div>
                      <div className="sw-mini-body" style={{ marginTop: 2 }}>{p.sub}</div>
                      <ol style={{ paddingLeft: '1.05rem', margin: '7px 0 0', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {p.steps.map(s => <li key={s} className="text-xs text-muted">{s}</li>)}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Keyboard shortcuts ───────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-3${matches('keyboard', 'shortcut', 'rebind', 'command palette') ? '' : ' is-filtered'}`}
              id="settings-shortcuts"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">⌨️ Keyboard Shortcuts</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Rebind anything — it applies instantly</p>
                  </div>
                  <div className="sw-card-aside">
                    <span className="sw-glyph" aria-hidden="true"><IconSearch size={14} /></span>
                    <button className="btn btn-secondary btn-sm" onClick={onShowShortcuts}>View all</button>
                  </div>
                </div>

                <p className="card-note">
                  Rebind any shortcut here — the change takes effect immediately across the app.
                  <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--sw-sunken)', border: '1px solid var(--sw-line)', borderRadius: 'var(--sw-r-xs)', fontFamily: 'inherit', fontSize: '0.8rem' }}>⌘K</kbd> opens the command palette anytime.
                </p>

                {/* The full list is long — it scrolls inside the card so the
                    board keeps its proportions instead of one runaway column. */}
                <div className="sw-shortcut-scroll">
                  <ShortcutEditor
                    onError={shortcutError}
                    onSuccess={shortcutSuccess}
                  />
                </div>
              </div>
            </div>

            {/* ── AI features ──────────────────────────────────────────── */}
            <div
              className={`sw-settings-cell sw-span-6${matches('ai', 'gemini', 'openai', 'api key', 'model', 'provider', 'prompt') ? '' : ' is-filtered'}`}
              id="settings-ai"
            >
              <div className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">🤖 AI Features</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>Summaries, flashcards, practice questions and Smart Q&amp;A</p>
                  </div>
                  <div className="sw-card-aside">
                    <span className="sw-glyph" aria-hidden="true"><IconTutor size={14} /></span>
                    <span className={`tag ${aiConfig.enabled && (aiConfig.apiKey || serverHasApiKey) ? 'success' : ''}`}>
                      {serverManaged ? '🖥️ Backend managed' : serverHasApiKey ? '🔒 Saved on server' : aiConfig.enabled && aiConfig.apiKey ? '✅ Active' : '⏸️ Not configured'}
                    </span>
                  </div>
                </div>

                <p className="card-note">
                  Connect an AI provider to unlock real AI summaries, flashcard generation,
                  practice questions, and Smart Q&amp;A. {serverManaged
                    ? 'This instance uses a backend-managed key, so you don’t need to enter one.'
                    : 'Your key is stored encrypted on the server, works on every plan, and follows you across devices.'}
                </p>

                {/* Compact step-by-step — same instructions as onboarding */}
                {!serverHasApiKey && (
                  <details className="sw-aikey-details" style={{ marginBottom: '1rem' }}>
                    <summary className="sw-aikey-steps-title">How to get a free Google AI Studio key</summary>
                    <ol className="sw-aikey-steps-list">
                      <li>Open <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sw-accent)' }}>aistudio.google.com/app/apikey ↗</a></li>
                      <li>Sign in with your Google account.</li>
                      <li>Click <strong>Get API key</strong> → <strong>Create API key</strong>.</li>
                      <li>Pick or create a project, then copy the <code>AIza…</code> key.</li>
                      <li>Paste it below and press <strong>💾 Save AI Settings</strong>.</li>
                    </ol>
                  </details>
                )}

                {/* Provider picker */}
                <div className="sw-provider-grid" style={{ marginBottom: '1.25rem' }}>
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={`sw-provider${aiConfig.provider === p.id ? ' active' : ''}`}
                      onClick={() => {
                        const defaultModel = MODELS_BY_PROVIDER[p.id][0].id;
                        setAiConfigState(prev => ({ ...prev, provider: p.id as AIProvider, model: defaultModel }));
                      }}
                      aria-pressed={aiConfig.provider === p.id}
                    >
                      <div className="sw-provider-name">
                        {p.id === 'gemini' ? '🌟' : '⚡'} {p.label}
                        {p.id === 'gemini' && <span className="tag success" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>Recommended</span>}
                      </div>
                      <div className="sw-provider-note">{p.free}</div>
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.875rem', marginBottom: '1rem' }}>

                  {/* AI Tutor level — read-only pointer to the Student Profile card. */}
                  <div className="sw-mini">
                    <div className="sw-mini-title">🎓 AI Tutor level</div>
                    <div className="sw-mini-body" style={{ marginTop: 6 }}>
                      Lessons are pitched at <strong style={{ color: 'var(--text-2)' }}>{levelLabel}</strong>
                      {profile.schoolStage ? ` · ${profileSummary}` : ''}.
                      Change it in the <strong style={{ color: 'var(--sw-accent)' }}>Student Profile</strong> card.
                    </div>
                  </div>

                  {/* Model picker */}
                  <div>
                    <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Model</label>
                    <select
                      className="select"
                      value={aiConfig.model}
                      onChange={e => setAiConfigState(p => ({ ...p, model: e.target.value }))}
                    >
                      {MODELS_BY_PROVIDER[aiConfig.provider].map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* API Key */}
                <div style={{ marginBottom: '1rem' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>
                    API Key
                    {serverManaged && (
                      <span className="tag success" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>🖥️ Backend managed</span>
                    )}
                    {!serverManaged && aiConfig.apiKey === '(saved on server)' && (
                      <span className="tag success" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>🔒 Saved on server</span>
                    )}
                    <a
                      href={PROVIDERS.find(p => p.id === aiConfig.provider)?.getKeyUrl}
                      target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: '0.5rem', color: 'var(--sw-accent)', fontSize: '0.75rem' }}
                    >
                      {serverManaged ? 'Use my own key instead →' : 'Get free key →'}
                    </a>
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type={showKey ? 'text' : 'password'}
                      className="input"
                      placeholder={serverManaged
                        ? 'Backend is providing the key automatically'
                        : aiConfig.apiKey === '(saved on server)'
                          ? '••••••••• (enter a new key to replace)'
                          : (aiConfig.provider === 'gemini' ? 'AIza...' : 'sk-...')}
                      value={serverManaged ? '' : aiConfig.apiKey === '(saved on server)' ? '' : aiConfig.apiKey}
                      onChange={e => setAiConfigState(p => ({ ...p, apiKey: e.target.value }))}
                      style={{ flex: 1, fontFamily: aiConfig.apiKey && !showKey ? 'monospace' : undefined }}
                      disabled={serverManaged}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowKey(s => !s)} disabled={serverManaged}>
                      {showKey ? '🙈 Hide' : '👁️ Show'}
                    </button>
                  </div>
                  {serverManaged && (
                    <p className="text-xs text-muted" style={{ marginTop: '0.375rem' }}>
                      AI is already active using the backend key. To use your own key instead, enter it in the field above and save.
                    </p>
                  )}
                </div>

                {/* Enable toggle */}
                <div className="sw-switch-row">
                  <div>
                    <div className="sw-switch-label">
                      {aiConfig.enabled ? 'AI features enabled' : 'AI features disabled'}
                    </div>
                    <div className="sw-switch-note">Turn the whole AI layer on or off.</div>
                  </div>
                  <button
                    className="toggle"
                    onClick={() => setAiConfigState(p => ({ ...p, enabled: !p.enabled }))}
                    role="switch"
                    aria-checked={aiConfig.enabled}
                    aria-label="AI features enabled"
                  />
                </div>

                {/* Custom prompts accordion */}
                {tier === 'pro' && (
                  <div style={{ marginTop: '1rem' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowPrompts(s => !s)}
                      style={{ padding: '0.375rem 0', color: 'var(--sw-accent)', fontWeight: 600 }}
                    >
                      {showPrompts ? '▲ Hide custom prompts' : '▼ Customize AI prompts'}
                    </button>
                    {showPrompts && (
                      <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' }}>
                        {[
                          { key: 'customSummaryPrompt'   as const, label: '✨ Summary prompt',         def: DEFAULT_PROMPTS.summary,   hint: 'Controls how AI summarises your notes.' },
                          { key: 'customFlashcardPrompt' as const, label: '📝 Flashcard prompt',       def: DEFAULT_PROMPTS.flashcard, hint: 'Use {{count}} for the card count. Must request JSON with "flashcards" array.' },
                          { key: 'customQAPrompt'        as const, label: '🤖 Q&A system instruction', def: DEFAULT_PROMPTS.qa,        hint: 'Added after the base instruction. Controls answer style.' },
                        ].map(p => (
                          <div key={p.key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                              <label className="form-label">{p.label}</label>
                              <button
                                className="btn btn-ghost btn-xs text-muted"
                                onClick={() => setAiConfigState(prev => ({ ...prev, [p.key]: undefined }))}
                                title="Reset to default"
                              >↺ Reset</button>
                            </div>
                            <textarea
                              className="textarea"
                              rows={3}
                              value={aiConfig[p.key] ?? p.def}
                              onChange={e => setAiConfigState(prev => ({ ...prev, [p.key]: e.target.value }))}
                              style={{ fontSize: '0.8125rem', fontFamily: 'monospace' }}
                            />
                            <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>{p.hint}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Save actions sit at the foot of the card, so they line up
                    with the other cards on the board. */}
                <div className="sw-card-foot">
                  <button className="btn btn-primary" onClick={handleSaveAI} disabled={savingAI}>
                    {savingAI ? 'Saving…' : '💾 Save AI Settings'}
                  </button>
                  {aiConfig.apiKey && (
                    <button className="btn btn-secondary" onClick={handleTestAI} disabled={testingAI}>
                      {testingAI ? 'Testing…' : '🧪 Test Connection'}
                    </button>
                  )}
                </div>

                {/* Cost / free tier note */}
                {aiConfig.provider === 'gemini' && (
                  <div className="sw-mini" style={{ marginTop: '1rem' }}>
                    <div className="sw-mini-body">
                      🌟 <strong>Gemini free tier:</strong> 15 requests/min · 1 million tokens/day · no credit card required.
                      Perfect for all StudyWorks features at zero cost.
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ marginLeft: '0.375rem', color: 'var(--sw-accent)' }}>Get your free key →</a>
                    </div>
                  </div>
                )}
                {aiConfig.provider === 'openai' && (
                  <div className="sw-mini" style={{ marginTop: '1rem' }}>
                    <div className="sw-mini-body">
                      ⚡ <strong>OpenAI cost estimate:</strong> GPT-4o Mini ≈ $0.00015/1K tokens.
                      A typical summary costs &lt;$0.001. Smart Q&amp;A with 10 notes ≈ $0.002.
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Sharing & support ───────────────────────────────────────
              Phase2Tools renders the three sharing/support cards, each in
              its own grid cell, in a grid below the main one. */}
          <div className="sw-settings-grid" id="settings-tools" style={{ marginTop: 18 }}>
            <Phase2Tools
              folders={folders}
              tier={tier}
              onAddToast={onAddToast}
              filtered={!matches('share', 'sharing', 'email', 'support', 'ticket', 'folder', 'link')}
            />
          </div>

          {/* ── Data & storage ─────────────────────────────────────────
              The closing band: one full-width row that owns every export
              and delete action, so the destructive ones sit together. */}
          <div className="sw-settings-grid" id="settings-data-row" style={{ marginTop: 18 }}>
            <div
              className={`sw-settings-cell sw-span-6${matches('data', 'storage', 'export', 'pdf', 'json', 'clear', 'privacy', 'quota') ? '' : ' is-filtered'}`}
              id="settings-data"
            >
              <div className="card sw-settings-data-card">
                <div className="sw-settings-data-head">
                  <span className="sw-settings-band-icon"><IconLock size={17} /></span>
                  <div className="sw-settings-band-body">
                    <span className="card-title">💾 Data &amp; Storage</span>
                    <p className="card-note" style={{ margin: '4px 0 0' }}>
                      All data is stored locally in <strong>IndexedDB</strong>. Export regularly to back up your library.
                    </p>
                  </div>
                  {storageUsed && <span className="tag text-xs sw-settings-data-tag">{storageUsed}</span>}
                </div>

                <div className="sw-stat-grid" style={{ margin: '1.125rem 0' }}>
                  <div className="sw-stat-tile">
                    <div className="sw-stat-tile-label">Engine</div>
                    <div className="sw-stat-tile-value">IndexedDB</div>
                  </div>
                  <div className="sw-stat-tile">
                    <div className="sw-stat-tile-label">Plan</div>
                    <div className="sw-stat-tile-value">{tier === 'pro' ? '⭐ Pro' : '🆓 Free'}</div>
                  </div>
                  <div className="sw-stat-tile">
                    <div className="sw-stat-tile-label">Items stored</div>
                    <div className="sw-stat-tile-value">{totalItems}</div>
                  </div>
                  {storageDetail && (
                    <>
                      <div className="sw-stat-tile">
                        <div className="sw-stat-tile-label">Data used</div>
                        <div className="sw-stat-tile-value">{formatBytes(storageDetail.used)}</div>
                      </div>
                      <div className="sw-stat-tile">
                        <div className="sw-stat-tile-label">Browser quota</div>
                        <div className="sw-stat-tile-value">{formatBytes(storageDetail.quota)}</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Storage usage bar */}
                {storageDetail && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span className="text-xs text-muted">Storage used</span>
                      <span className="text-xs" style={{ fontWeight: 600 }}>
                        {((storageDetail.used / storageDetail.quota) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="sw-range" style={{ height: 6, background: 'var(--sw-sunken)', cursor: 'default' }}>
                      <div style={{
                        height: '100%', width: `${Math.min(100, (storageDetail.used / storageDetail.quota) * 100)}%`,
                        borderRadius: 'var(--sw-r-full)',
                        background: 'linear-gradient(90deg, var(--sw-accent), var(--sw-accent-2))',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                )}

                <div className="sw-settings-data-foot">
                  <p className="text-xs text-muted">
                    ⚠️ Storage is managed by your browser. Large file attachments (PDFs, audio) consume quota fastest.
                    Export your library regularly to avoid data loss.
                  </p>
                  <div className="sw-settings-band-actions">
                    <button className="btn btn-danger" onClick={handleClearCache}>
                      🗑️ Clear all local data
                    </button>
                    <button className="btn btn-secondary" onClick={handleExportJSON}>
                      📤 Export as JSON
                    </button>
                    <button className="btn btn-primary" onClick={handleExportPDF} title="Opens a printable view — use your browser's Save as PDF">
                      📄 Export as PDF
                    </button>
                  </div>
                </div>

                {setFlashcards && (
                  <AnkiPanel
                    flashcards={data.flashcards}
                    setFlashcards={setFlashcards}
                    onToast={onAddToast}
                  />
                )}
              </div>
            </div>

            {/* ── No matches ──────────────────────────────────────────── */}
            {query.trim() && visibleCount === 0 && (
              <div className="sw-settings-empty">
                No settings match &ldquo;{query.trim()}&rdquo;.
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => setQuery('')}>
                  Clear search
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
