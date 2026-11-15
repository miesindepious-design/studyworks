import { useState, useEffect, useCallback } from 'react';
import type { ProductProfile } from '../config/product';
import { fetchAISettings } from '../api/ai';
import AIKeySetup from './AIKeySetup';

interface OnboardingProps {
  onComplete: () => void;
  product?: ProductProfile;
  onLoadStarterPack?: () => void;
  /** Refresh the AI config after the user connects their key. */
  onAISaved?: () => void;
}

export default function Onboarding({ onComplete, product, onLoadStarterPack, onAISaved }: OnboardingProps) {
  const name     = product?.name ?? 'StudyWorks';
  const audience = product?.audience ?? 'students';
  const [step, setStep] = useState(0);

  // Final phase: the registration-time "connect your AI key" step. Every new
  // user is prompted for their Google AI Studio API key here — even those who
  // skipped the marketing carousel.
  const [aiPhase, setAiPhase]   = useState(false);
  // The server already holds a key for this account (e.g. signing in on a
  // second device) — then the key step is not needed.
  const [aiDone, setAiDone]     = useState(false);

  useEffect(() => {
    fetchAISettings().then(s => {
      if (s && (s.hasOwnKey || s.serverManaged)) setAiDone(true);
    }).catch(() => {});
  }, []);

  const STEPS = [
    {
      icon: '📚', emoji: '📚',
      title: `Welcome to ${name}`,
      body: `Your all-in-one study companion for ${audience}. Capture notes, track people, master flashcards — and let AI help you learn faster.`,
      features: [
        { emoji: '📝', label: 'Notes & Knowledge Base' },
        { emoji: '💡', label: 'Smart Flashcards' },
        { emoji: '🎓', label: 'AI Tutor' },
      ],
      cta: 'Get started',
    },
    {
      icon: '📝', emoji: '📝',
      title: 'Capture everything',
      body: 'Save lecture notes, articles, ideas and projects. Tag them, highlight key passages, and attach files (Pro). AI can summarise any note in one click.',
      features: [
        { emoji: '🏷️', label: 'Smart tagging' },
        { emoji: '🔍', label: 'Full-text search' },
        { emoji: '🤖', label: 'AI summaries' },
      ],
      cta: 'Next',
    },
    {
      icon: '💡', emoji: '💡',
      title: 'Study smarter with flashcards',
      body: 'Create flashcards manually or auto-generate them from your notes. The built-in SM-2 spaced repetition algorithm schedules reviews so you never forget.',
      features: [
        { emoji: '🔄', label: 'Spaced repetition' },
        { emoji: '🎯', label: 'Adaptive scheduling' },
        { emoji: '📊', label: 'Progress tracking' },
      ],
      cta: 'Next',
    },
    {
      icon: '👥', emoji: '👥',
      title: 'Stay in touch',
      body: 'Track professors, classmates, and collaborators. Set follow-up reminders and the app will flag overdue contacts so nobody slips through the cracks.',
      features: [
        { emoji: '⏰', label: 'Follow-up reminders' },
        { emoji: '🏷️', label: 'Contact tagging' },
        { emoji: '🔔', label: 'Smart notifications' },
      ],
      cta: 'Next',
    },
    {
      icon: '🚀', emoji: '🚀',
      title: `You're all set!`,
      body: `Your 7-day free Pro trial starts now — unlimited notes, AI Tutor, cloud sync and file uploads. No credit card needed. After the trial you keep the free plan: 50 items and 20 AI summaries/month.`,
      features: [
        { emoji: '🎁', label: '7-day Pro trial' },
        { emoji: '⭐', label: 'Pro: Unlimited' },
        { emoji: '🆓', label: 'Free: 50 items' },
      ],
      cta: aiDone ? `Let's go ->` : 'Next ->',
    },
  ];

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;
  const totalDots = STEPS.length + (aiDone ? 0 : 1); // + the AI key step

  const finish = useCallback(() => { onComplete(); }, [onComplete]);

  /** Move to the AI key step — or straight out when no key step is needed. */
  const enterAiPhase = useCallback(() => {
    if (aiDone) { finish(); return; }
    setAiPhase(true);
  }, [aiDone, finish]);

  const advance = useCallback(() => {
    if (aiPhase) return;             // the key step is button-driven
    if (isLast) { enterAiPhase(); return; }
    setStep(s => s + 1);
  }, [aiPhase, isLast, enterAiPhase]);

  // "Skip" on the marketing carousel still lands on the AI key step — every
  // new user is prompted for their API key, they just skip the tour.
  const skip = useCallback(() => {
    if (aiPhase) { finish(); return; }
    enterAiPhase();
  }, [aiPhase, finish, enterAiPhase]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (aiPhase) {
        if (e.key === 'Escape' && !typing) { e.preventDefault(); finish(); }
        return; // no arrow/space navigation while the form is on screen
      }
      if (e.key === 'ArrowRight' || e.key === ' ') { if (!typing) { e.preventDefault(); advance(); } }
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [advance, skip, finish, aiPhase]);

  const handleKeySaved = useCallback(() => {
    onAISaved?.();
    finish();
  }, [onAISaved, finish]);

  // ── AI key step ──────────────────────────────────────────────────────────
  if (aiPhase) {
    return (
      <div className="modal-backdrop">
      <div className="modal-panel" style={{
        maxWidth: '600px', width: '100%', position: 'relative',
        maxHeight: '90vh', overflowY: 'auto',   // the key step is tall — let it scroll, never clip
      }}>
        <div style={{ padding: '1.5rem 1.75rem 1.25rem', textAlign: 'center' }}>
        <div style={{
          fontSize: '2.75rem', marginBottom: '0.75rem',
          animation: 'pop 0.5s ease both', display: 'inline-block',
          alignSelf: 'center', pointerEvents: 'none',
        }}>🔑</div>

          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{
              display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.625rem',
            }}>
              {Array.from({ length: totalDots }).map((_, i) => (
                <div key={i} className="progress-fill" style={{
                  width: i === totalDots - 1 ? '1.75rem' : '0.5rem',
                  height: '0.5rem', borderRadius: 'var(--r-full)',
                  background: i === totalDots - 1 ? 'var(--accent)' : 'var(--border)',
                  transition: 'all 0.35s cubic-bezier(0.4, 0, .2, 1)',
                }} />
              ))}
            </div>
            <p className="text-xs text-muted">Last step · connect your AI</p>
          </div>

          <h2 style={{
            fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem',
            letterSpacing: '-0.02em', textAlign: 'center',
          }}>
            Connect your AI
          </h2>
          <p className="text-muted" style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
            One free key unlocks every AI feature in {name}.
          </p>

          <AIKeySetup onSaved={handleKeySaved} onSkip={finish} />

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { onLoadStarterPack?.(); finish(); }}
            style={{ width: '100%', marginTop: '1rem' }}
          >
            ⚡ Skip & load exam-prep starter pack
          </button>
        </div>
      </div>
    </div>
    );
  }

  // ── Marketing carousel ───────────────────────────────────────────────────
  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: '520px', textAlign: 'center', position: 'relative' }}>

        {!isLast && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={skip}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              color: 'var(--text-3)', fontWeight: 600,
              padding: '0.4rem 0.75rem',
            }}
          >
            {aiDone ? 'Skip >>' : 'Skip tour >>'}
          </button>
        )}

        <div style={{
          fontSize: '3.5rem', marginBottom: '1.25rem',
          animation: 'pop 0.5s ease both',
          display: 'inline-block',
          alignSelf: 'center',   // don't stretch: a full-width box swallowed clicks on the skip button
          pointerEvents: 'none',
        }}>
          {current.emoji}
        </div>

        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.625rem',
          }}>
            {Array.from({ length: totalDots }).map((_, i) => (
              <div
                key={i}
                className="progress-fill"
                style={{
                  width: i === step ? '1.75rem' : '0.5rem',
                  height: '0.5rem',
                  borderRadius: 'var(--r-full)',
                  background: i <= step ? 'var(--accent)' : 'var(--border)',
                  transition: 'all 0.35s cubic-bezier(0.4, 0, .2, 1)',
                  cursor: 'pointer',
                }}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <p className="text-xs text-muted">
            Step {step + 1} of {totalDots}
          </p>
        </div>

        <h2 style={{
          fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.75rem',
          letterSpacing: '-0.02em',
          animation: 'slideUp 0.3s ease both',
        }}>
          {current.title}
        </h2>
        <p className="text-muted" style={{
          lineHeight: 1.75, marginBottom: '1.75rem', fontSize: '0.9375rem',
          animation: 'slideUp 0.3s 0.05s ease both',
        }}>
          {current.body}
        </p>

        <div className="grid" style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem', marginBottom: '2rem',
          animation: 'slideUp 0.3s 0.1s ease both',
        }}>
          {current.features.map(f => (
            <div
              key={f.label}
              className="stat-card"
              style={{ flexDirection: 'column', alignItems: 'center', gap: '0.375rem', padding: '0.875rem 0.625rem' }}
            >
              <span style={{ fontSize: '1.5rem' }}>{f.emoji}</span>
              <span className="text-xs" style={{ fontWeight: 600, color: 'var(--text-2)', lineHeight: 1.3 }}>
                {f.label}
              </span>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary btn-lg"
          style={{
            width: '100%',
            animation: 'slideUp 0.3s 0.15s ease both',
          }}
          onClick={advance}
        >
          {current.cta}
        </button>

        <p className="text-xs text-muted" style={{ marginTop: '0.75rem', animation: 'slideUp 0.3s 0.2s ease both' }}>
          Press <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>&rarr;</kbd> or <kbd style={{ padding: '0.1rem 0.4rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>Space</kbd> to continue &middot; <kbd style={{ padding: '0.1rem 0.3rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: '0.8rem' }}>Esc</kbd> to skip
        </p>

        {isLast && onLoadStarterPack && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: '0.75rem', animation: 'slideUp 0.3s 0.25s ease both' }}
            onClick={() => { onLoadStarterPack(); skip(); }}
          >
            ⚡ Load exam-prep starter pack
          </button>
        )}
      </div>
    </div>
  );
}
