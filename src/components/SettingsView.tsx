import { useState, useEffect, useCallback } from 'react';
import type { UseNotificationsResult } from '../hooks/useNotifications';
import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';
import { ACCENT_THEMES } from '../config/accents';
import { getAIConfig, saveAIConfig, PROVIDERS, MODELS_BY_PROVIDER, DEFAULT_PROMPTS } from '../db/aiSettings';
import type { AIConfig, AIProvider } from '../db/aiSettings';
import { chatComplete } from '../ai/client';
import * as serverAI from '../api/ai';
import Phase2Tools from './Phase2Tools';
import HeroDock from './HeroDock';
import Reveal from './Reveal';
import TimerSettingsPanel from './TimerSettingsPanel';
import ShortcutEditor from './ShortcutEditor';
import { useTimerSettings } from '../hooks/useTimerSettings';
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
  theme, onThemeChange, accent, onAccentChange, data, displayName,
}: SettingsViewProps) {
  const [testing, setTesting] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);
  const [storageDetail, setStorageDetail] = useState<{ used: number; quota: number } | null>(null);

  // Study timer settings — shared with the Timer tab (one store, one UI).
  const { settings: timerSettings, update: updateTimer } = useTimerSettings();

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
          const quotaMB = (quota  / 1024 / 1024).toFixed(0);
          setStorageUsed(`${usedMB} MB used of ~${quotaMB} MB available`);
          setStorageDetail({ used: usage, quota });
        }
      });
    }
  }, []);

  // Load the saved student profile so the card reflects reality instead of
  // always starting blank.
  useEffect(() => {
    serverAI.fetchStudentProfile().then(res => {
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

      // Also save to the server when the user is Pro. The server will
      // encrypt and store the key; subsequent AI calls will go through
      // the server proxy, which lets us rate-limit, count usage, and
      // follow the user across devices.
      if (tier === 'pro') {
        try {
          const apiKey = aiConfig.apiKey && aiConfig.apiKey !== '(saved on server)' ? aiConfig.apiKey : '';
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
          onAddToast(result.serverManaged ? '🖥️ Using backend-managed AI key.' : apiKey ? '🔒 AI key saved (encrypted on server).' : '✅ AI settings saved.', 'success');
        } catch (serverErr: any) {
          onAddToast(`Saved locally; server save failed: ${serverErr.message}`, 'error');
        }
      } else {
        onAddToast('AI settings saved locally. Upgrade to Pro to sync your key across devices.', 'info');
      }

      onAISaved?.();
    } catch {
      onAddToast('Failed to save AI settings.', 'error');
    } finally {
      setSavingAI(false);
    }
  };

  const handleTestAI = async () => {
    // If the user already has a server-stored key, prefer testing via the
    // server proxy (the key may be hidden from the client).
    if (tier === 'pro' && (aiConfig.apiKey === '(saved on server)' || !aiConfig.apiKey)) {
      setTestingAI(true);
      try {
        await serverAI.serverSummary('ping', 'Reply with exactly: "StudyWorks AI is working!"');
        onAddToast('✅ StudyWorks AI is working! (via server proxy)', 'success');
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
      const result = await chatComplete({
        provider: aiConfig.provider,
        apiKey:   aiConfig.apiKey,
        model:    aiConfig.model,
        messages: [{ role: 'user', content: 'Reply with exactly: "StudyWorks AI is working!"' }],
        maxTokens: 20,
      });
      onAddToast(`✅ ${result.trim()}`, 'success');
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
  const classOptions = classesForStage(profile.schoolStage);
  const totalItems = data.notes.length + data.contacts.length + data.flashcards.length;

  // Stable callbacks so the shortcut editor's key-capture listener isn't torn
  // down and re-registered on every render.
  const shortcutError = useCallback((msg: string) => onAddToast(msg, 'error'), [onAddToast]);
  const shortcutSuccess = useCallback((msg: string) => onAddToast(msg, 'success'), [onAddToast]);

  return (
    <div className="animate-in">
      {/* Hero — flies into the top-left corner on scroll, exactly like the
          dashboard welcome banner. */}
      <HeroDock
        side="left"
        chipIcon="⚙️"
        chipLabel="Settings"
        chipMeta={displayName || undefined}
        bannerClassName="settings-hero"
      >
        <div>
          <span className="sw-label">Account</span>
          <h2 className="settings-hero-title">Your workspace</h2>
          <p className="text-muted" style={{ marginTop: '0.35rem', fontSize: '0.9375rem' }}>
            Profile, appearance, AI, reminders and data — make StudyWorks yours.
          </p>
          <div className="settings-hero-stats" style={{ marginTop: '0.875rem' }}>
            <span className="settings-hero-stat">🎓 {profileSummary}</span>
            <span className="settings-hero-stat">⭐ {tier === 'pro' ? 'Pro plan' : 'Free plan'}</span>
            <span className="settings-hero-stat">📚 {totalItems} items</span>
          </div>
        </div>
      </HeroDock>

      {/* ── Student Profile ────────────────────────────────────────────────── */}
      <Reveal>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">🎓 Student Profile</span>
            <span className="tag success">{profileSummary}</span>
          </div>

          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            This is the only place your study level is set. The AI Tutor, flashcard generator
            and Quiz Battle all read it, so lessons match your exact class or year instead of
            guessing.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.875rem', marginBottom: '1rem' }}>
            {/* Stage */}
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Education stage</label>
              <select
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
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Your class</label>
                <select
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
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Your year</label>
                <select
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
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Department</label>
                <select
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
                    style={{ marginTop: '0.5rem' }}
                    placeholder="Type your department"
                    value={profile.departmentCustom}
                    onChange={e => setProfile(p => ({ ...p, departmentCustom: e.target.value }))}
                  />
                )}
              </div>
            )}

            {/* Generic study level */}
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Study level</label>
              <select
                className="select"
                value={profile.educationLevel}
                onChange={e => { setLevelTouched(true); setProfile(p => ({ ...p, educationLevel: e.target.value })); }}
              >
                <option value="">Select level…</option>
                {EDUCATION_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={handleSaveProfile}
            disabled={savingProfile || !profile.schoolStage}
          >
            {savingProfile ? 'Saving…' : '💾 Save student profile'}
          </button>
          {!profile.schoolStage && (
            <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>
              Pick your education stage to enable saving.
            </p>
          )}
        </div>
      </Reveal>

      {/* ── Appearance ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">🎨 Appearance</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Theme</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(['system', 'light', 'dark'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => onThemeChange(t)}
                    style={{
                      padding: '0.5rem 0.875rem',
                      borderRadius: 'var(--r)',
                      border: `1px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`,
                      background: theme === t ? 'var(--accent-soft)' : 'var(--surface-1)',
                      color: theme === t ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.875rem',
                    }}
                  >
                    {t === 'system' ? '💻 System' : t === 'light' ? '☀️ Light' : '🌙 Dark'}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent colour — works independently of light/dark mode */}
            {accent !== undefined && onAccentChange && (
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Accent colour</p>
                <p className="text-xs text-muted" style={{ marginBottom: '0.625rem' }}>
                  Changes buttons, highlights and glows — combines with Light/Dark mode for {ACCENT_THEMES.length * 2} total looks.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem' }}>
                  {ACCENT_THEMES.map(t => {
                    const active = accent === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => onAccentChange(t.id)}
                        title={t.label}
                        aria-pressed={active}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          padding: '0.45rem 0.6rem',
                          borderRadius: 'var(--r)',
                          border: `1.5px solid ${active ? t.a : 'var(--border)'}`,
                          background: active ? `color-mix(in srgb, ${t.a} 12%, var(--surface-1))` : 'var(--surface-1)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        {/* Dual-colour swatch: primary + gradient partner */}
                        <span style={{
                          width: '1.05rem',
                          height: '1.05rem',
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: `linear-gradient(135deg, ${t.a} 55%, ${t.b} 55%)`,
                          boxShadow: active ? `0 0 8px color-mix(in srgb, ${t.a} 55%, transparent)` : 'none',
                        }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </Reveal>

      {/* ── AI Configuration ── */}
      <Reveal delay={120}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">🤖 AI Features</span>
            <span className={`tag ${aiConfig.enabled && (aiConfig.apiKey || serverHasApiKey) ? 'success' : ''}`}>
              {serverManaged ? '🖥️ Backend managed' : serverHasApiKey ? '🔒 Saved on server' : aiConfig.enabled && aiConfig.apiKey ? '✅ Active' : '⏸️ Not configured'}
            </span>
          </div>

          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            Connect an AI provider to unlock real AI summaries, flashcard generation,
            practice questions, and Smart Q&A. {serverManaged
              ? 'This instance uses a backend-managed key, so you don’t need to enter one.'
              : tier === 'pro'
                ? 'Pro users: your key is stored encrypted on the server so it follows you across devices.'
                : 'Your key is stored locally in your browser and used only to call the provider directly.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.25rem' }}>

            {/* Provider picker */}
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>AI Provider</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.625rem' }}>
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const defaultModel = MODELS_BY_PROVIDER[p.id][0].id;
                      setAiConfigState(prev => ({ ...prev, provider: p.id as AIProvider, model: defaultModel }));
                    }}
                    style={{
                      padding: '0.875rem 1rem',
                      borderRadius: 'var(--radius)',
                      border: `2px solid ${aiConfig.provider === p.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: aiConfig.provider === p.id ? 'var(--accent-soft)' : 'var(--surface-2)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all var(--transition)',
                    }}
                  >
                    <p style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem', color: aiConfig.provider === p.id ? 'var(--accent)' : 'var(--text)' }}>
                      {p.id === 'gemini' ? '🌟' : '⚡'} {p.label}
                      {p.id === 'gemini' && <span className="tag success" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>Recommended</span>}
                    </p>
                    <p className="text-xs text-muted">{p.free}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Tutor level — read-only pointer to the Student Profile card.
                The editable dropdown lives there, so it isn't duplicated here. */}
            <div style={{ background: 'var(--surface-2)', padding: '0.875rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>🎓 AI Tutor level</p>
              <p className="text-xs text-muted" style={{ lineHeight: 1.6 }}>
                Lessons are pitched at <strong style={{ color: 'var(--text-2)' }}>{levelLabel}</strong>
                {profile.schoolStage ? ` · ${profileSummary}` : ''}.
              </p>
              <p className="text-xs text-muted" style={{ marginTop: '0.375rem', lineHeight: 1.6 }}>
                Change your level or class in the <strong style={{ color: 'var(--accent)' }}>Student Profile</strong> card above.
              </p>
            </div>

            {/* API Key */}
            <div>
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
                  style={{ marginLeft: '0.5rem', color: 'var(--accent)', fontSize: '0.75rem' }}
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

            {/* Model picker */}
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>Model</label>
              <select
                className="select"
                value={aiConfig.model}
                onChange={e => setAiConfigState(p => ({ ...p, model: e.target.value }))}
                style={{ maxWidth: '320px' }}
              >
                {MODELS_BY_PROVIDER[aiConfig.provider].map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Enable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={() => setAiConfigState(p => ({ ...p, enabled: !p.enabled }))}
                style={{
                  width: '44px', height: '24px', borderRadius: '9999px', border: 'none',
                  background: aiConfig.enabled ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}
                role="switch" aria-checked={aiConfig.enabled}
                aria-label="AI features enabled"
              >
                <div style={{
                  width: '18px', height: '18px', borderRadius: '50%', background: 'var(--surface-0)',
                  position: 'absolute', top: '3px',
                  left: aiConfig.enabled ? '23px' : '3px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
              <span className="text-sm">{aiConfig.enabled ? 'AI features enabled' : 'AI features disabled'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleSaveAI} disabled={savingAI}>
              {savingAI ? 'Saving…' : '💾 Save AI Settings'}
            </button>
            {aiConfig.apiKey && (
              <button className="btn btn-secondary" onClick={handleTestAI} disabled={testingAI}>
                {testingAI ? 'Testing…' : '🧪 Test Connection'}
              </button>
            )}
          </div>

          {/* Custom prompts accordion */}
          {tier === 'pro' && (
            <div style={{ marginTop: '1rem' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPrompts(s => !s)}
                style={{ padding: '0.375rem 0', color: 'var(--accent)', fontWeight: 600 }}
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

          {/* Cost / free tier note */}
          {aiConfig.provider === 'gemini' && (
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted" style={{ lineHeight: 1.6 }}>
                🌟 <strong>Gemini free tier:</strong> 15 requests/min · 1 million tokens/day · no credit card required.
                Perfect for all StudyWorks features at zero cost.
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ marginLeft: '0.375rem', color: 'var(--accent)' }}>Get your free key →</a>
              </p>
            </div>
          )}
          {aiConfig.provider === 'openai' && (
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted" style={{ lineHeight: 1.6 }}>
                ⚡ <strong>OpenAI cost estimate:</strong> GPT-4o Mini ≈ $0.00015/1K tokens.
                A typical summary costs &lt;$0.001. Smart Q&A with 10 notes ≈ $0.002.
              </p>
            </div>
          )}
        </div>
      </Reveal>

      {/* ── Study Timer Settings ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">⏱️ Study Timer</span>
            <span className="tag success">Pomodoro</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            Configure your focus and break sessions. These are the same settings the Timer tab
            uses — change them here and the timer picks them up.
          </p>
          <TimerSettingsPanel settings={timerSettings} onChange={updateTimer} />
        </div>
      </Reveal>

      {/* ── Notifications & Reminders ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">🔔 Notifications & Reminders</span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: permColor[notif.permission] }}>
              {permLabel[notif.permission]}
            </span>
          </div>

          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            StudyWorks can notify you when notes and contacts are due for review.
            Reminders fire even when the browser tab is in the background — and if you've
            closed the tab, the service worker will check every hour and fire them automatically.
          </p>

          {/* How it works */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
            {[
              { icon: '📝', title: 'Note reminders', desc: 'Set a "Revisit" date on any note via the ⏰ button.' },
              { icon: '👥', title: 'Contact reminders', desc: 'Schedule a follow-up when adding or editing a person.' },
              { icon: '🌙', title: 'Background checks', desc: 'Service worker checks hourly even when the app is closed.' },
              { icon: '🖱️', title: 'Click to navigate', desc: 'Clicking a notification opens the relevant view directly.' },
            ].map(item => (
              <div key={item.title} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.875rem', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '1.25rem', marginBottom: '0.375rem' }}>{item.icon}</p>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{item.title}</p>
                <p className="text-xs text-muted">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {notif.permission !== 'granted' && notif.permission !== 'denied' && notif.supported && (
              <button className="btn btn-primary" onClick={handleEnable}>
                🔔 Enable Notifications
              </button>
            )}
            {notif.permission === 'granted' && (
              <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
                {testing ? 'Sending…' : '🧪 Send Test Notification'}
              </button>
            )}
            {notif.permission === 'denied' && (
              <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem' }}>
                <p className="text-sm" style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.25rem' }}>Notifications are blocked</p>
                <p className="text-xs text-muted">
                  To re-enable: click the 🔒 icon in your browser's address bar → Notifications → Allow.
                </p>
              </div>
            )}
            {!notif.supported && (
              <p className="text-sm text-muted">Your browser doesn't support the Notifications API.</p>
            )}
          </div>
        </div>
      </Reveal>

      {/* ── Phase 2: sharing, email-to-save, support ──
          Each tool cascades in on its own (Phase2Tools handles the reveal). */}
      <Phase2Tools folders={folders} tier={tier} onAddToast={onAddToast} reveal />

      {/* ── Install App ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">📱 Install App</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem', lineHeight: 1.7 }}>
            StudyWorks is a Progressive Web App. Install it on your device for a native-like
            experience — no app store required.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.875rem', marginBottom: '1rem' }}>
            {[
              { platform: '🖥️ Desktop (Chrome/Edge)', steps: ['Click the ⊞ icon in the address bar', 'Click "Install"'] },
              { platform: '📱 iOS (Safari)',           steps: ['Tap the Share button', 'Tap "Add to Home Screen"'] },
              { platform: '🤖 Android (Chrome)',        steps: ['Tap the ⋮ menu', 'Tap "Add to Home Screen" or "Install app"'] },
            ].map(p => (
              <div key={p.platform} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.875rem', border: '1px solid var(--border)' }}>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>{p.platform}</p>
                <ol style={{ paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {p.steps.map(s => <li key={s} className="text-xs text-muted">{s}</li>)}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ── Data Management ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">💾 Data &amp; Storage</span>
            {storageUsed && <span className="tag text-xs">{storageUsed}</span>}
          </div>

          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            All data is stored locally in <strong>IndexedDB</strong>. Your data never leaves your device unless you enable cloud sync.
            Export regularly to back up your library.
          </p>

          {/* Storage detail grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted">Engine</p>
              <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>IndexedDB</p>
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted">Plan</p>
              <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{tier === 'pro' ? '⭐ Pro' : '🆓 Free'}</p>
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted">Items stored</p>
              <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{totalItems}</p>
            </div>
            {storageDetail && (
              <>
                <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
                  <p className="text-xs text-muted">Data used</p>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{formatBytes(storageDetail.used)}</p>
                </div>
                <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
                  <p className="text-xs text-muted">Browser quota</p>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{formatBytes(storageDetail.quota)}</p>
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
              <div style={{ height: '6px', background: 'var(--surface-3)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 'var(--r-full)',
                  background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                  width: `${Math.min(100, (storageDetail.used / storageDetail.quota) * 100)}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleExportPDF} title="Opens a printable view — use your browser's Save as PDF">
              📄 Export as PDF
            </button>
            <button className="btn btn-secondary" onClick={handleExportJSON}>
              📤 Export as JSON
            </button>
            <button className="btn btn-danger" onClick={handleClearCache}>
              🗑️ Clear all local data
            </button>
          </div>

          <p className="text-xs text-muted" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
            ⚠️ Storage is managed by your browser. Large file attachments (PDFs, audio) consume quota fastest.
            Export your library regularly to avoid data loss.
          </p>
        </div>
      </Reveal>

      {/* ── Keyboard Shortcuts ── */}
      <Reveal delay={60}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="card-title">⌨️ Keyboard Shortcuts</span>
            <button className="btn btn-secondary btn-sm" onClick={onShowShortcuts}>View all</button>
          </div>

          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
            Rebind any shortcut here — the change takes effect immediately across the app.
            <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>⌘K</kbd> opens the command palette anytime.
          </p>

          <ShortcutEditor
            onError={shortcutError}
            onSuccess={shortcutSuccess}
          />
        </div>
      </Reveal>
    </div>
  );
}
