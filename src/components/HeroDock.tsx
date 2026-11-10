import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Scroll offset (px) at which the banner starts flying to the corner. */
const DOCK_START = 16;
/** Scroll distance (px) the flight takes to complete. */
const DOCK_DIST = 380;
/** Corner parking spot for the docked chip (px from the viewport edges). */
const CORNER_RIGHT = 18;
const CORNER_TOP = 72;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (n: number) => n * n * (3 - 2 * n);

interface HeroDockProps {
  greeting: string;
  displayName: string;
  trialDaysLeft?: number;
  children: ReactNode;
}

/**
 * The dashboard welcome banner.
 *
 * On arrival it sits in the normal dashboard flow. The moment you start
 * scrolling it flies up and to the right, shrinking as it goes, and parks
 * itself in the top-right corner as a compact glass chip. Scroll back to the
 * top and it returns to its original place — the flight is driven directly by
 * scroll position, so it always tracks your thumb exactly.
 */
export default function HeroDock({
  greeting,
  displayName,
  trialDaysLeft = 0,
  children,
}: HeroDockProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const box = useRef({ top: 0, left: 0, width: 1 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /** Cache the banner's resting geometry in document coordinates. */
  const measure = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    box.current = {
      top: r.top + window.scrollY,
      left: r.left,
      width: Math.max(1, r.width),
    };
  }, []);

  /** Position the banner + chip for the current scroll offset. */
  const apply = useCallback(() => {
    const fly = flyRef.current;
    const chip = chipRef.current;
    if (!fly || !chip) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fly.style.transform = '';
      fly.style.opacity = '';
      chip.style.opacity = '0';
      chip.style.pointerEvents = 'none';
      return;
    }

    const m = box.current;
    const y = window.scrollY;

    // 0 = banner still in place, 1 = fully parked in the corner.
    const p = smoothstep(clamp01((y - DOCK_START) / DOCK_DIST));

    const chipW = chip.offsetWidth || 210;
    const cornerLeft = window.innerWidth - chipW - CORNER_RIGHT;

    // Vector from the banner's current position to the corner.
    const dx = cornerLeft - m.left;
    const dy = CORNER_TOP - (m.top - y);
    const scale = Math.max(0.16, Math.min(1, chipW / m.width));

    fly.style.transform =
      `translate3d(${(dx * p).toFixed(2)}px, ${(dy * p).toFixed(2)}px, 0) ` +
      `scale(${(1 + (scale - 1) * p).toFixed(4)})`;
    // The banner stays fully legible through the first half of the flight,
    // then hands over to the chip.
    fly.style.opacity = String(1 - clamp01((p - 0.5) / 0.5));
    fly.style.pointerEvents = p > 0.4 ? 'none' : '';

    chip.style.opacity = String(clamp01((p - 0.55) / 0.45));
    chip.style.transform =
      `translate3d(${((1 - p) * chipW * 0.8).toFixed(2)}px, 0, 0) ` +
      `scale(${(0.93 + 0.07 * p).toFixed(4)})`;
    chip.style.pointerEvents = p > 0.7 ? 'auto' : 'none';
  }, []);

  // ── Scroll + resize driving (rAF throttled) ────────────────────────────────
  useEffect(() => {
    let frame: number | null = null;

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        apply();
      });
    };

    measure();
    apply();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [apply, measure]);

  // Re-measure when the banner itself changes size (text wraps, buttons wrap).
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      measure();
      apply();
    });
    ro.observe(slot);
    return () => ro.disconnect();
  }, [apply, measure]);

  const initial = (displayName.trim()[0] || '👋').toUpperCase();

  const chip = (
    <div
      className="hero-dock-chip"
      ref={chipRef}
      role="button"
      tabIndex={-1}
      title="Back to top"
      aria-hidden="true"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <span className="hero-dock-chip-avatar" aria-hidden>{initial}</span>
      <span className="hero-dock-chip-text">
        <span className="hero-dock-chip-greeting">{greeting}</span>
        {displayName && <span className="hero-dock-chip-name">, {displayName}</span>}
      </span>
      {trialDaysLeft > 0 && (
        <span
          className="hero-dock-chip-badge"
          title={`Free Pro trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`}
        >
          🎁 {trialDaysLeft}d
        </span>
      )}
    </div>
  );

  return (
    <div className="hero-dock-slot" ref={slotRef}>
      {/* The banner that flies — transform is applied here, never on .dash-hero
          (which owns its own entrance animation). */}
      <div className="hero-dock-fly" ref={flyRef}>
        <div className="dash-hero">{children}</div>
      </div>

      {/* The chip it parks as. It is portalled to <body> on purpose: the page
          container carries a transform (its view-transition animation), and a
          transformed ancestor becomes the containing block for fixed
          positioning — the chip would scroll away with the page instead of
          staying pinned to the viewport corner. */}
      {mounted && createPortal(chip, document.body)}
    </div>
  );
}
