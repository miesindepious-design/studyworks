import { useState, useEffect } from 'react';
import type { UseNotificationsResult } from '../hooks/useNotifications';
import type { Folder } from '../types';
import type { TimerSettings } from './StudyTimer';
import { getAIConfig, saveAIConfig, PROVIDERS, MODELS_BY_PROVIDER, DEFAULT_PROMPTS } from '../db/aiSettings';
import type { AIConfig, AIProvider } from '../db/aiSettings';
import { chatComplete } from '../ai/client';
import * as serverAI from '../api/ai';
import Phase2Tools from './Phase2Tools';

interface SettingsViewProps {
  notif: UseNotificationsResult;
  tier: string;
  onAddToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onShowShortcuts: () => void;
  onAISaved?: () => void;
  folders: Folder[];
  theme: string;
  onThemeChange: (v: string) => void;
}

export default function SettingsView({ notif, tier, onAddToast, onShowShortcuts, onAISaved, folders, theme, onThemeChange }: SettingsViewProps) {
  const [testing, setTesting] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);
  const [storageDetail, setStorageDetail] = useState<{ used: number; quota: number } | null>(null);

  // Study timer settings
  const [timerSettings, setTimerSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('studyworks:timerSettings');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { focusDuration: 25, breakDuration: 5, autoStartBreak: false, soundEnabled: true };
  });

  // Custom keyboard shortcuts editor
  const [shortcuts, setShortcuts]     = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('studyworks:shortcuts');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      'mod+1': 'Dashboard', 'mod+2': 'Notes', 'mod+3': 'People',
      'mod+4': 'Flashcards', 'mod+5': 'Pricing', 'mod+6': 'Settings',
    };
  });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyCapture, setKeyCapture] = useState(false);

  // AI config state
  const [aiConfig, setAiConfigState] = useState<AIConfig>({ provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash', enabled: false });
  const [showKey, setShowKey]     = useState(false);
  const [savingAI, setSavingAI]   = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [serverManaged, setServerManaged] = useState(false);
  const [serverHasApiKey, setServerHasApiKey] = useState(false);

  useEffect(() => {
    getAIConfig().then(setAiConfigState);
    serverAI.fetchAISettings().then(s => {
      if (s) {
        setServerManaged(s.serverManaged);
        setServerHasApiKey(s.hasApiKey);
        // If the server has a key, reflect that in the local config
        // so the Settings UI shows the correct saved-on-server state.
        if (s.hasApiKey) {
          setAiConfigState(prev => prev ? { ...prev, apiKey: '(saved on server)' } : prev);
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

  // Persist timer settings
  useEffect(() => {
    localStorage.setItem('studyworks:timerSettings', JSON.stringify(timerSettings));
  }, [timerSettings]);

  // Persist shortcuts
  useEffect(() => {
    localStorage.setItem('studyworks:shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

  // Keyboard capture for shortcut editor
  useEffect(() => {
    if (!keyCapture) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push('mod');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey)   parts.push('alt');
      let key = e.key.toLowerCase();
      if (key === ' ') key = 'space';
      parts.push(key);
      const combo = parts.join('+');
      if (editingKey) {
        setShortcuts(prev => {
          const conflict = Object.entries(prev).find(([k]) => k !== editingKey && k === combo);
          if (conflict) {
            onAddToast(`"${combo}" is already assigned to "${conflict[1]}". Remove it first.`, 'error');
            return prev;
          }
          return { ...prev, [combo]: prev[editingKey] || '', [editingKey]: combo };
        });
      }
      setKeyCapture(false);
      setEditingKey(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyCapture, editingKey, onAddToast]);

  const startCapture = (key: string) => { setEditingKey(key); setKeyCapture(true); };
  const resetShortcuts = () => setShortcuts({ 'mod+1': 'Dashboard', 'mod+2': 'Notes', 'mod+3': 'People', 'mod+4': 'Flashcards', 'mod+5': 'Pricing', 'mod+6': 'Settings' });

  // Data management helpers
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

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

  const handleExportPDF = () => {
    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) { onAddToast('Pop-up blocked. Please allow pop-ups for PDF export.', 'error'); return; }
    const exportDate = new Date().toLocaleString();
    printWin.document.write(`<!DOCTYPE html>
<html><head><title>StudyWorks Export — ${exportDate}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 2.5rem; color: #111; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; border-bottom: 2px solid #0d9488; padding-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin-top: 1.75rem; color: #0f766e; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  th { background: #f0fdfa; text-align: left; padding: 0.5rem; border: 1px solid #ccfbf1; color: #0f766e; }
  td { padding: 0.5rem; border: 1px solid #e5e7eb; vertical-align: top; }
  .meta { color: #6b7280; font-size: 0.8rem; margin-bottom: 1.5rem; }
  .badge { display: inline-block; background: #ccfbf1; color: #0f766e; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>📚 StudyWorks Data Export</h1>
<p class="meta">Exported ${exportDate} · Plan: ${tier === 'pro' ? '⭐ Pro' : '🆓 Free'}</p>
<h2>📝 Notes</h2>
<table><tr><th>Title</th><th>Type</th><th>Tags</th><th>Updated</th></tr>
<tr><td colspan="4">Open this export from the Notes view to see full data. JSON export available in Settings.</td></tr>
</table>
<h2>👥 Contacts</h2>
<table><tr><th>Name</th><th>Role</th><th>Email</th></tr>
<tr><td colspan="3">See full contact list in the People view.</td></tr>
</table>
<h2>💡 Flashcards</h2>
<table><tr><th>Question</th><th>Difficulty</th></tr>
<tr><td colspan="2">See full flashcard list in the Flashcards view.</td></tr>
</table>
<script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body></html>`);
    printWin.document.close();
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
          const apiKey = aiConfig.apiKey && aiConfig.apiKey !== '(saved on server)' ? aiConfig.apiKey : ''
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

  const [profileLevel, setProfileLevel] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    // Load profile from server if possible
    (async () => {
      try {
        const res = await fetch('/api/ai/profile', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setProfileLevel(data.user?.educationLevel ?? null);
        }
      } catch {}
    })();
  }, []);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch('/api/ai/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ educationLevel: profileLevel }),
      });
      if (!res.ok) throw new Error('Failed to save profile');
      onAddToast('Profile saved.', 'success');
    } catch (err: any) {
      onAddToast(err.message || 'Failed to save profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      {/* ── Study Timer Settings ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">⏱️ Study Timer</span>
          <span className="tag success">Pomodoro</span>
        </div>
        <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
          Configure your focus and break sessions. Navigate to the Timer tab to start a Pomodoro session.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label">Focus session duration</label>
              <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>{timerSettings.focusDuration} min</span>
            </div>
            <input type="range" min="5" max="60" step="5" value={timerSettings.focusDuration}
              onChange={e => setTimerSettings((s: TimerSettings) => ({ ...s, focusDuration: +e.target.value }))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-xs text-muted">5 min</span>
              <span className="text-xs text-muted">60 min</span>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label">Break duration</label>
              <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>{timerSettings.breakDuration} min</span>
            </div>
            <input type="range" min="1" max="30" step="1" value={timerSettings.breakDuration}
              onChange={e => setTimerSettings((s: TimerSettings) => ({ ...s, breakDuration: +e.target.value }))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-xs text-muted">1 min</span>
              <span className="text-xs text-muted">30 min</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Auto-start breaks</p>
              <p className="text-xs text-muted">Automatically start the break timer after each focus session.</p>
            </div>
            <button onClick={() => setTimerSettings((s: TimerSettings) => ({ ...s, autoStartBreak: !s.autoStartBreak }))} style={{
              width: '48px', height: '26px', borderRadius: '9999px', border: 'none',
              background: timerSettings.autoStartBreak ? 'var(--accent)' : 'var(--border)',
              cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }} role="switch" aria-checked={timerSettings.autoStartBreak}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: 'var(--surface-0)',
                position: 'absolute', top: '3px',
                left: timerSettings.autoStartBreak ? '25px' : '3px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>🔔 Sound notification</p>
              <p className="text-xs text-muted">Play a chime when each focus/break session ends.</p>
            </div>
            <button onClick={() => {
              const next = !timerSettings.soundEnabled;
              setTimerSettings((s: TimerSettings) => ({ ...s, soundEnabled: next }));
              if (next) playBeep();
            }} style={{
              width: '48px', height: '26px', borderRadius: '9999px', border: 'none',
              background: timerSettings.soundEnabled ? 'var(--accent)' : 'var(--border)',
              cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }} role="switch" aria-checked={timerSettings.soundEnabled}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: 'var(--surface-0)',
                position: 'absolute', top: '3px',
                left: timerSettings.soundEnabled ? '25px' : '3px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Appearance ── */}
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
        </div>
      </div>

      {/* ── AI Configuration ── */}
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

          {/* AI Tutor level */}
          <div style={{ background: 'var(--surface-2)', padding: '0.875rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>🎓 AI Tutor level</p>
            <p className="text-xs text-muted" style={{ marginBottom: '0.5rem', lineHeight: 1.6 }}>This sets the base lesson complexity for the AI Tutor.</p>
            <select
              className="select"
              value={profileLevel ?? ''}
              onChange={e => setProfileLevel(e.target.value || null)}
              style={{ width: '100%' }}
            >
              <option value="">Select level…</option>
              {[
                { v: 'high-school', l: 'High School' },
                { v: 'college-freshman', l: 'College Freshman' },
                { v: 'college-sophomore', l: 'College Sophomore' },
                { v: 'college-junior', l: 'College Junior' },
                { v: 'college-senior', l: 'College Senior / Final Year' },
                { v: 'university', l: 'University' },
                { v: 'graduate', l: 'Graduate' },
                { v: 'phd', l: 'PhD / Research' },
              ].map(item => (
                <option key={item.v} value={item.v}>{item.l}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem', width: '100%' }} onClick={handleSaveProfile} disabled={savingProfile || !profileLevel}>
              {savingProfile ? 'Saving…' : 'Save tutor level'}
            </button>
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
                  { key: 'customSummaryPrompt'   as const, label: '✨ Summary prompt',            def: DEFAULT_PROMPTS.summary,   hint: 'Controls how AI summarises your notes.' },
                  { key: 'customFlashcardPrompt' as const, label: '📝 Flashcard prompt',          def: DEFAULT_PROMPTS.flashcard, hint: 'Use {{count}} for the card count. Must request JSON with "flashcards" array.' },
                  { key: 'customQAPrompt'        as const, label: '🤖 Q&A system instruction',    def: DEFAULT_PROMPTS.qa,        hint: 'Added after the base instruction. Controls answer style.' },
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

      {/* ── Phase 2: sharing, email-to-save, support ── */}
      <Phase2Tools folders={folders} tier={tier} onAddToast={onAddToast} />
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

      {/* ── Data Management ── */}
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
          <button className="btn btn-secondary" onClick={() => {
            const payload = {
              notes: [], contacts: [], flashcards: [], folders,
              practiceQuestions: [], savedSearches: [],
              exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `studyworks-export-${new Date().toISOString().split('T')[0]}.json`; a.click();
            URL.revokeObjectURL(url);
            onAddToast('Data exported as JSON!', 'success');
          }}>
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

      {/* ── Keyboard Shortcuts ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-secondary btn-sm" onClick={onShowShortcuts}>View all</button>
        </div>

        <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
          Customise shortcut keys for common actions. Click any row, then press the new key combination.
          <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>⌘K</kbd> opens the command palette anytime.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {[
            { key: 'mod+1', label: 'Go to Dashboard' },
            { key: 'mod+2', label: 'Go to Notes' },
            { key: 'mod+3', label: 'Go to People' },
            { key: 'mod+4', label: 'Go to Flashcards' },
            { key: 'mod+5', label: 'Go to Pricing' },
            { key: 'mod+6', label: 'Go to Settings' },
            { key: 'mod+t', label: 'Start / Pause Timer' },
            { key: 'mod+n', label: 'New Note' },
            { key: 'mod+/', label: 'Command Palette' },
          ].map(({ key, label }) => {
            const currentKey = shortcuts[key] || key;
            const isEditing = keyCapture && editingKey === key;
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.625rem 0.875rem', borderRadius: 'var(--radius)',
                background: isEditing ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: `1px solid ${isEditing ? 'rgb(45 212 191 / .35)' : 'var(--border)'}`,
                transition: 'all 0.2s ease',
              }}>
                <span className="text-sm" style={{ fontWeight: 500 }}>{label}</span>
                <button
                  onClick={() => startCapture(key)}
                  style={{
                    padding: '0.25rem 0.65rem', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: isEditing ? 'var(--accent)' : 'var(--surface-3)',
                    color: isEditing ? 'var(--accent-ink)' : 'var(--text)',
                    fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit', minWidth: '5.5rem', textAlign: 'center',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isEditing ? 'Press keys…' : currentKey}
                </button>
              </div>
            );
          })}
        </div>

        {keyCapture && (
          <p className="text-xs text-muted" style={{ marginBottom: '0.75rem', fontStyle: 'italic' }}>
            Press any key combination (e.g. ⌘T). Press <kbd style={{ padding: '0.05rem 0.3rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>Esc</kbd> to cancel.
          </p>
        )}

        <button className="btn btn-secondary btn-sm" onClick={resetShortcuts}>↺ Reset to defaults</button>
      </div>

      {/* ── Phase 2: sharing, email-to-save, support ── */}
      <Phase2Tools folders={folders} tier={tier} onAddToast={onAddToast} />
    </div>
  );
}

// Reuse the Web Audio chime from StudyTimer
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 880 : 660, now + offset);
      gain.gain.setValueAtTime(0.3, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}
