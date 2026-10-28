import { useState, useEffect, useCallback } from 'react';
import type { ProductProfile } from '../config/product';

interface OnboardingProps {
  onComplete: () => void;
  product?: ProductProfile;
  onLoadStarterPack?: () => void;
}

export default function Onboarding({ onComplete, product, onLoadStarterPack }: OnboardingProps) {
  const name     = product?.name ?? 'StudyWorks';
  const audience = product?.audience ?? 'students';
  const [step, setStep] = useState(0);

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
      body: 'Start on the free plan — 50 items, 20 AI summaries/month. Upgrade to Pro anytime for unlimited everything, file uploads, and smart Q&A.',
      features: [
        { emoji: '🆓', label: 'Free: 50 items' },
        { emoji: '⭐', label: 'Pro: Unlimited' },
        { emoji: '☁️', label: 'Cloud sync (Pro)' },
      ],
      cta: `Let's go ->`,
    },
  ];

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  const advance = useCallback(() => {
    if (isLast) { onComplete(); return; }
    setStep(s => s + 1);
  }, [isLast, onComplete]);

  const skip = useCallback(() => { onComplete(); }, [onComplete]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [advance, skip]);

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: '520px', textAlign: 'center' }}>

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
            Skip &gt;&gt;
          </button>
        )}

        <div style={{
          fontSize: '3.5rem', marginBottom: '1.25rem',
          animation: 'pop 0.5s ease both',
          display: 'inline-block',
        }}>
          {current.emoji}
        </div>

        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.625rem',
          }}>
            {STEPS.map((_, i) => (
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
            Step {step + 1} of {STEPS.length}
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
          gridTemplateColumns: 'repeat(3, 1fr)',
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
            onClick={() => { onLoadStarterPack(); onComplete(); }}
          >
            ⚡ Load exam-prep starter pack
          </button>
        )}
      </div>
    </div>
  );
}
