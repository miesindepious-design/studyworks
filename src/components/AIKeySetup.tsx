/**
 * AIKeySetup — the "connect your AI" panel.
 *
 * Shown to every new user at the end of the onboarding flow (and reachable
 * later from Settings). It walks the student through getting a free Google
 * AI Studio API key step by step, validates the key with one tiny provider
 * call, and saves it encrypted on the server.
 *
 * Why a key? The AI Tutor, summaries, flashcards, practice questions and
 * Smart Q&A all run on Gemini. With the student's own key, calls bill to
 * their free Google quota instead of a shared backend key — so AI features
 * are unlocked on any plan (BYOK: bring your own key).
 */

import { useState } from 'react';
import { saveAISettings, testAIKey } from '../api/ai';
import type { ServerAIConfig } from '../api/ai';
import { MODELS_BY_PROVIDER } from '../db/aiSettings';

const AI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';

interface AIKeySetupProps {
  /** Called after the key was saved (encrypted) on the server. */
  onSaved: (config: ServerAIConfig) => void;
  /** Called when the user chooses to skip for now. */
  onSkip: () => void;
  /** Hide the skip button (e.g. when embedded in Settings). */
  hideSkip?: boolean;
}

export default function AIKeySetup({ onSaved, onSkip, hideSkip }: AIKeySetupProps) {
  const [apiKey, setApiKey]     = useState('');
  const [model, setModel]       = useState(MODELS_BY_PROVIDER.gemini[0].id);
  const [showKey, setShowKey]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [tested, setTested]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);

  const trimmed = apiKey.trim();
  const looksLikeGeminiKey = /^AIza[\w-]{30,}$/.test(trimmed);

  const handleTest = async () => {
    setError(null); setSuccess(null);
    if (!trimmed) { setError('Paste your API key first.'); return; }
    setTesting(true);
    try {
      const r = await testAIKey({ provider: 'gemini', model, apiKey: trimmed });
      if (r.ok) {
        setTested(true);
        setSuccess('Connection works! Your key is valid.');
      } else {
        setTested(false);
        setError(r.error || 'Google rejected this key. Double-check that you copied the whole key.');
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setError(null); setSuccess(null);
    if (!trimmed) { setError('Paste your API key first.'); return; }
    setSaving(true);
    try {
      const config = await saveAISettings({
        provider: 'gemini',
        model,
        enabled:  true,
        apiKey:   trimmed,
      });
      onSaved(config);
    } catch (err: any) {
      setError(err.message || 'Could not save your key. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="sw-aikey">
      {/* Why */}
      <p className="sw-aikey-why">
        Unlock the <strong>AI Tutor</strong>, note <strong>summaries</strong>,{' '}
        <strong>flashcards</strong>, <strong>practice questions</strong> and{' '}
        <strong>Smart Q&A</strong> with your own free Google AI Studio key —
        no credit card, and it works on every plan.
      </p>

      {/* Step-by-step instructions */}
      <div className="sw-aikey-steps">
        <div className="sw-aikey-steps-title">Get your free key — about 1 minute</div>
        <ol className="sw-aikey-steps-list">
          <li>
            Open Google AI Studio{' '}
            <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className="sw-aikey-link">
              aistudio.google.com/app/apikey ↗
            </a>
          </li>
          <li>Sign in with your Google account (any Gmail works).</li>
          <li>Click <strong>Get API key</strong> (or <strong>Create API key</strong>).</li>
          <li>
            Choose a project — pick an existing one or click{' '}
            <strong>Create project</strong> and name it anything, e.g. "StudyWorks".
          </li>
          <li>Click <strong>Create</strong>, then copy the key it shows you.</li>
          <li>Paste the key below — it starts with <code>AIza</code>.</li>
        </ol>
      </div>

      {/* Model + key input */}
      <div className="sw-aikey-form">
        <div className="form-group">
          <label className="form-label" htmlFor="sw-aikey-model">Model</label>
          <select
            id="sw-aikey-model"
            className="select"
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            {MODELS_BY_PROVIDER.gemini.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="sw-aikey-input">Your API key</label>
          <div className="sw-aikey-input-row">
            <input
              id="sw-aikey-input"
              type={showKey ? 'text' : 'password'}
              className="input"
              placeholder="AIza..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTested(false); setError(null); setSuccess(null); }}
              autoComplete="off"
              spellCheck={false}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowKey(s => !s)}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? '🙈 Hide' : '👁️ Show'}
            </button>
          </div>
          {trimmed && !looksLikeGeminiKey && (
            <p className="text-xs" style={{ color: 'var(--warning)', marginTop: '0.375rem' }}>
              Gemini keys usually start with <code>AIza</code> and are ~39 characters. Make sure you copied the whole key.
            </p>
          )}
        </div>
      </div>

      {/* Feedback */}
      {error && (
        <div className="sw-aikey-feedback error">
          <span>❌</span> <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="sw-aikey-feedback success">
          <span>✅</span> <span>{success}</span>
        </div>
      )}

      {/* Actions */}
      <div className="sw-aikey-actions">
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={testing || saving || !trimmed}
        >
          {testing ? 'Testing…' : '🔌 Test connection'}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || testing || !trimmed}
        >
          {saving ? 'Saving…' : tested ? '🔒 Save & continue' : '🔒 Save & continue'}
        </button>
      </div>

      <p className="text-xs text-muted" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
        🔐 Your key is encrypted before it is stored and is only used to run your own AI calls.
        Google's free tier gives plenty of daily usage for studying.
        {!hideSkip && (
          <>
            {' '}Changed your mind?{' '}
            <button type="button" className="btn btn-ghost btn-xs" onClick={onSkip} style={{ color: 'var(--sw-accent)', padding: 0, fontWeight: 600 }}>
              Skip for now
            </button>{' '}
            — you can add it any time in Settings.
          </>
        )}
      </p>
    </div>
  );
}
