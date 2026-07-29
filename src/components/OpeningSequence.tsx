import { useEffect, useState } from 'react';

interface OpeningSequenceProps {
  /** Wordmark to draw in (defaults to "StudyWorks"). */
  productName?: string;
  /** When true, skip the motion and show the final frame immediately. */
  reducedMotion?: boolean;
  /** Called when the sequence finishes or is skipped. */
  onDone?: () => void;
}

/**
 * OpeningSequence — the app's animated intro.
 *
 * Timeline (skippable, reduced-motion-safe):
 *   1. aurora  — a duotone aurora sweep blooms across the near-black field.
 *   2. mark    — the 📚 mark scales/rotates in with a glow ring.
 *   3. word    — the product name draws in (letter fade-up) under the mark.
 *   4. settle  — holds briefly, then crossfades out → onDone().
 *
 * Clicking or pressing Esc skips straight to the end. Users who prefer
 * reduced motion get the final composed frame with no animation.
 */
export default function OpeningSequence({
  productName = 'StudyWorks',
  reducedMotion = false,
  onDone,
}: OpeningSequenceProps) {
  const [stage, setStage] = useState<'aurora' | 'mark' | 'word' | 'settle' | 'done'>(
    reducedMotion ? 'settle' : 'aurora'
  );

  // Advance through the timeline.
  useEffect(() => {
    if (reducedMotion) {
      const t = setTimeout(() => onDone?.(), 400);
      return () => clearTimeout(t);
    }
    const timings: Record<string, number> = {
      aurora: 650,
      mark: 750,
      word: 850,
      settle: 750,
    };
    const order = ['aurora', 'mark', 'word', 'settle', 'done'] as const;
    let cancelled = false;
    let acc = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    order.forEach((s, i) => {
      if (i === 0) return;
      acc += timings[order[i - 1]] ?? 0;
      timers.push(setTimeout(() => { if (!cancelled) setStage(s); }, acc));
    });
    // Final → call onDone after settle.
    timers.push(setTimeout(() => { if (!cancelled) onDone?.(); }, acc + (timings.settle ?? 0)));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [reducedMotion, onDone]);

  // Skip handler.
  const skip = () => { setStage('done'); onDone?.(); };

  useEffect(() => {
    if (reducedMotion) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') skip(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', skip);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', skip); };
  }, [reducedMotion]);

  const show = stage !== 'done';

  return (
    <div
      className="opening-sequence"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--bg)',
        backgroundImage: 'var(--bg-grad)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1.4rem',
        opacity: show ? 1 : 0,
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 480ms ease',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
      role="status"
      aria-label={`Loading ${productName}`}
    >
      {/* Aurora layer */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background:
            'radial-gradient(600px 420px at 30% 30%, var(--accent-glow), transparent 60%),' +
            'radial-gradient(520px 380px at 72% 68%, rgb(56 189 248 / .18), transparent 60%),' +
            'radial-gradient(420px 320px at 50% 90%, rgb(129 140 248 / .14), transparent 60%)',
          opacity: stage === 'done' ? 0 : stage === 'aurora' ? 1 : 0.55,
          transform: stage === 'aurora' ? 'scale(1.15)' : 'scale(1)',
          filter: 'blur(8px)',
          transition: 'opacity 650ms ease, transform 1100ms ease',
        }}
      />

      {/* Mark */}
      <div
        aria-hidden
        style={{
          position: 'relative',
          fontSize: '4.2rem',
          lineHeight: 1,
          transform: stage === 'done'
            ? 'scale(0.9)'
            : stage === 'aurora'
              ? 'scale(0.4) rotate(-18deg)'
              : 'scale(1) rotate(0deg)',
          opacity: stage === 'aurora' ? 0 : 1,
          filter: 'drop-shadow(0 0 22px var(--accent-glow))',
          transition: 'transform 720ms cubic-bezier(.2,.9,.25,1), opacity 520ms ease',
        }}
      >
        📚
        {/* Glow ring that pulses in on the mark stage */}
        <span style={{
          position: 'absolute', left: '50%', top: '50%',
          width: '120px', height: '120px', marginLeft: '-60px', marginTop: '-60px',
          borderRadius: '50%',
          border: '2px solid var(--accent-glow)',
          opacity: stage === 'mark' ? 0.9 : stage === 'done' ? 0 : 0.35,
          transform: stage === 'mark' ? 'scale(1.12)' : 'scale(1)',
          transition: 'opacity 600ms ease, transform 900ms ease',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Wordmark */}
      <div
        aria-hidden
        style={{
          display: 'flex', gap: '0.02em', fontWeight: 800, fontSize: '2.1rem',
          letterSpacing: '0.01em',
          background: 'linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3))',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          opacity: stage === 'done' ? 0 : stage === 'word' || stage === 'settle' ? 1 : 0,
          transform: stage === 'word' || stage === 'settle' || stage === 'done' ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 520ms ease, transform 520ms ease',
        }}
      >
        {productName.split('').map((ch, i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: stage === 'word' || stage === 'settle' || stage === 'done' ? 1 : 0,
              transform:
                stage === 'word' || stage === 'settle' || stage === 'done'
                  ? 'translateY(0)' : 'translateY(8px)',
              transition:
                `opacity 360ms ease ${stage === 'word' ? i * 32 : 0}ms,` +
                `transform 360ms ease ${stage === 'word' ? i * 32 : 0}ms`,
            }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </div>

      {/* Tagline (settles in last) */}
      <p
        style={{
          color: 'var(--text-2)', fontSize: '0.85rem', letterSpacing: '0.04em',
          opacity: stage === 'settle' || stage === 'done' ? 0.9 : 0,
          transform: stage === 'settle' || stage === 'done' ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 420ms ease, transform 420ms ease',
          textAlign: 'center', maxWidth: '280px',
        }}
      >
        Your study companion
      </p>

      <style>{`
        .opening-sequence::after {
          content: '';
          position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%);
          font-size: 0.7rem; color: var(--text-2); opacity: 0.5;
          letter-spacing: 0.06em;
        }
      `}</style>
    </div>
  );
}
