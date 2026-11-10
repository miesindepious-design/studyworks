import { useEffect, useRef, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Delay (ms) before the panel slides in — use to stagger a group. */
  delay?: number;
  /** Extra class on the wrapper. */
  className?: string;
  /** Make the wrapped element fill the wrapper (needed inside grids). */
  fill?: boolean;
}

/**
 * Wraps a panel so it slides in from the right edge the first time it comes
 * into view. Panels below the fold therefore feel like they are being dealt
 * onto the page from the right as you scroll down.
 */
export default function Reveal({ children, delay = 0, className = '', fill = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Already on screen at load — show it straight away, no entrance animation.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      el.classList.add('is-in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.06, rootMargin: '0px 0px -4% 0px' },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  const classes = [
    'reveal-wrap',
    'reveal-right',
    fill ? 'reveal-fill' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={classes} style={delay ? { '--rv-delay': `${delay}ms` } as React.CSSProperties : undefined}>
      {children}
    </div>
  );
}
