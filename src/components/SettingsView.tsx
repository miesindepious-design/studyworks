import { useState, useEffect } from 'react';
import type { UseNotificationsResult } from '../hooks/useNotifications';
import type { Folder } from '../types';
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
}

export default function SettingsView({ notif, tier, onAddToast, onShowShortcuts, onAISaved, folders }: SettingsViewProps) {
  const [testing, setTesting] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);

  // AI config state
  const [aiConfig, setAiConfigState] = useState<AIConfig>({ provider: 'gemini', apiKey: '', model: 'gemini-1.5-flash', enabled: false });
  const [showKey, setShowKey]     = useState(false);
  const [savingAI, setSavingAI]   = useState(false);
  const [testingAI, setTestingAI] = useState(false);

  useEffect(() => {
    getAIConfig().then(setAiConfigState);

    // Estimate storage usage
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage !== undefined && quota !== undefined) {
          const usedMB  = (usage  / 1024 / 1024).toFixed(1);
          const quotaMB = (quota  / 1024 / 1024).toFixed(0);
          setStorageUsed(`${usedMB} MB used of ~${quotaMB} MB available`);
        }
      });
    }
  }, []);

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
          const apiKey = aiConfig.apiKey && aiConfig.apiKey !== '(saved on server)' ? aiConfig.apiKey : undefined;
          await serverAI.saveAISettings({
            provider:             aiConfig.provider,
            model:                aiConfig.model,
            enabled:              aiConfig.enabled,
            apiKey,
            customSummaryPrompt:   aiConfig.customSummaryPrompt,
            customFlashcardPrompt: aiConfig.customFlashcardPrompt,
            customQAPrompt:        aiConfig.customQAPrompt,
          });
          onAddToast(apiKey ? '🔒 AI key saved (encrypted on server).' : '✅ AI settings saved.', 'success');
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

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      {/* ── AI Configuration ── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">🤖 AI Features</span>
          <span className={`tag ${aiConfig.enabled && aiConfig.apiKey ? 'success' : ''}`}>
            {aiConfig.enabled && aiConfig.apiKey ? '✅ Active' : '⏸️ Not configured'}
          </span>
        </div>

        <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.7 }}>
          Connect an AI provider to unlock real AI summaries, flashcard generation,
          practice questions, and Smart Q&A. {tier === 'pro'
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

          {/* API Key */}
          <div>
            <label className="form-label" style={{ display: 'block', marginBottom: '0.375rem' }}>
              API Key
              {aiConfig.apiKey === '(saved on server)' && (
                <span className="tag success" style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>🔒 Saved on server</span>
              )}
              <a
                href={PROVIDERS.find(p => p.id === aiConfig.provider)?.getKeyUrl}
                target="_blank" rel="noopener noreferrer"
                style={{ marginLeft: '0.5rem', color: 'var(--accent)', fontSize: '0.75rem' }}
              >
                Get free key →
              </a>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type={showKey ? 'text' : 'password'}
                className="input"
                placeholder={aiConfig.apiKey === '(saved on server)'
                  ? '••••••••• (enter a new key to replace)'
                  : (aiConfig.provider === 'gemini' ? 'AIza...' : 'sk-...')}
                value={aiConfig.apiKey === '(saved on server)' ? '' : aiConfig.apiKey}
                onChange={e => setAiConfigState(p => ({ ...p, apiKey: e.target.value }))}
                style={{ flex: 1, fontFamily: aiConfig.apiKey && !showKey ? 'monospace' : undefined }}
              />
              <button className="btn btn-secondary btn-sm" onClick={() => setShowKey(s => !s)}>
                {showKey ? '🙈 Hide' : '👁️ Show'}
              </button>
            </div>
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
                width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
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
            <div style={{ background: '#fff1f2', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem' }}>
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

      {/* ── PWA Install ── */}
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

      {/* ── Data ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">💾 Storage</span>
          {storageUsed && <span className="tag text-xs">{storageUsed}</span>}
        </div>
        <p className="text-sm text-muted" style={{ marginBottom: '0.75rem', lineHeight: 1.7 }}>
          All data is stored locally in <strong>IndexedDB</strong> — no cloud sync, no servers.
          Your data stays on your device. Use Export (📤) to back it up or move it to another browser.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.625rem 1rem', border: '1px solid var(--border)' }}>
            <p className="text-xs text-muted">Storage engine</p>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>IndexedDB</p>
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.625rem 1rem', border: '1px solid var(--border)' }}>
            <p className="text-xs text-muted">Sync</p>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Local only</p>
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.625rem 1rem', border: '1px solid var(--border)' }}>
            <p className="text-xs text-muted">Plan</p>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{tier === 'pro' ? '⭐ Pro' : '🆓 Free'}</p>
          </div>
          {storageUsed && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.625rem 1rem', border: '1px solid var(--border)' }}>
              <p className="text-xs text-muted">Browser quota</p>
              <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{storageUsed}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
          ⚠️ Storage is managed by your browser. Large file attachments (PDFs, audio) consume quota fastest.
          Export your library regularly to avoid data loss if the browser clears storage.
        </p>
      </div>

      {/* ── Keyboard shortcuts ── */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-secondary btn-sm" onClick={onShowShortcuts}>
            View all shortcuts
          </button>
        </div>
        <p className="text-sm text-muted">
          Use <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>?</kbd> anywhere
          to open the shortcuts reference, or <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>⌘1–5</kbd> to
          jump between views.
        </p>
      </div>
    </div>
  );
}
