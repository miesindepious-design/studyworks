import { useState } from 'react';
import type { ProductProfile } from '../config/product';

interface OnboardingProps {
  onComplete: () => void;
  product?: ProductProfile;
  onLoadStarterPack?: () => void;
}

export default function Onboarding({ onComplete, product, onLoadStarterPack }: OnboardingProps) {
  const name = product?.name ?? 'StudyWorks';
  const audience = product?.audience ?? 'students';

  const STEPS = [
    {
      icon: '📚',
      title: `Welcome to ${name}`,
      body: `Your all-in-one study companion for ${audience}. Capture notes, track people, master flashcards — and let AI help you learn faster.`,
      cta: 'Get started',
    },
    {
      icon: '📝',
      title: 'Capture everything',
      body: 'Save lecture notes, articles, ideas and projects. Tag them, highlight key passages, and attach files (Pro). AI can summarise any note in one click.',
      cta: 'Next',
    },
    {
      icon: '💡',
      title: 'Study smarter with flashcards',
      body: 'Create flashcards manually or auto-generate them from your notes. The built-in SM-2 spaced repetition algorithm schedules reviews so you never forget.',
      cta: 'Next',
    },
    {
      icon: '👥',
      title: 'Stay in touch',
      body: 'Track professors, classmates, and collaborators. Set follow-up reminders and the app will flag overdue contacts so nobody slips through the cracks.',
      cta: 'Next',
    },
    {
      icon: '🚀',
      title: "You're all set!",
      body: 'Start on the free plan — 50 items, 20 AI summaries/month. Upgrade to Pro anytime for unlimited everything, file uploads, and smart Q&A.',
      cta: "Let's go →",
    },
  ];

  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  const advance = () => {
    if (isLast) { onComplete(); return; }
    setStep(s => s + 1);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div className="card animate-in" style={{
        maxWidth: '480px', width: '100%', textAlign: 'center',
        padding: '2.5rem 2rem', position: 'relative',
      }}>
        {/* Skip */}
        {!isLast && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onComplete}
            style={{ position: 'absolute', top: '1rem', right: '1rem', color: 'var(--text-3)' }}
          >
            Skip
          </button>
        )}

        {/* Icon */}
        <div style={{ fontSize: '3rem', marginBottom: '1.25rem' }}>{current.icon}</div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.375rem', marginBottom: '1.75rem' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? '1.5rem' : '0.5rem',
                height: '0.5rem',
                borderRadius: 'var(--radius-full)',
                background: i === step ? 'var(--accent)' : 'var(--border)',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
              }}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <h2 style={{ fontSize: '1.375rem', fontWeight: 800, marginBottom: '0.75rem' }}>
          {current.title}
        </h2>
        <p className="text-muted" style={{ lineHeight: 1.7, marginBottom: '2rem', fontSize: '0.9375rem' }}>
          {current.body}
        </p>

        <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={advance}>
          {current.cta}
        </button>

        {isLast && onLoadStarterPack && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: '0.75rem' }}
            onClick={() => { onLoadStarterPack(); onComplete(); }}
          >
            ⚡ Load exam-prep starter pack
          </button>
        )}
      </div>
    </div>
  );
}
