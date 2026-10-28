/**
 * Celebration — a brief confetti burst shown when a study session completes.
 *
 * Purely decorative: auto-dismisses after `duration` ms (or on click/any key).
 * Honors prefers-reduced-motion by skipping the confetti animation.
 */
import { useEffect, useState } from 'react';

interface Props {
  emoji: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

const COLORS = ['#FF5136', '#FFC531', '#1FA97A', '#4F8CFF', '#FFD9CC', '#8B5CF6'];

export default function Celebration({ emoji, title, subtitle, onClose }: Props) {
  const [pieces, setPieces] = useState<{ left: number; color: string; delay: number; dur: number }[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      setPieces(Array.from({ length: 36 }, () => ({
        left: Math.random() * 100,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 0.25,
        dur: 1.6 + Math.random() * 1.2,
      })));
    }
    const t = setTimeout(onClose, 2600);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div className="celebrate-overlay" onClick={onClose}>
      <div className="celebrate-card" onClick={e => e.stopPropagation()}>
        {pieces.map((p, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
            }}
          />
        ))}
        <div className="celebrate-emoji">{emoji}</div>
        <div className="celebrate-title">{title}</div>
        {subtitle && <div className="celebrate-sub">{subtitle}</div>}
        <button className="btn btn-primary" style={{ marginTop: '1.25rem' }} onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}
