import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Scroll offset (px) at which the banner starts flying to the corner. */
const DOCK_START = 16;
/** Scroll distance (px) the flight takes to complete. */
const DOCK_DIST = 380;
/** Corner parking spot for the docked chip (px from the viewport edges). */
const CORNER_EDGE = 18;
const CORNER_TOP = 72;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (n: number) => n * n * (3 - 2 * n);

/** Which corner the banner flies into. */
export type DockSide = 'left' | 'right';

interface HeroDockProps {
  /** Corner the banner flies into. Defaults to the left. */
  side?: DockSide;
  /** Glyph shown inside the chip's round avatar. */
  chipIcon?: string;
  /** Main chip text. */
  chipLabel: string;
  /** Secondary chip text (usually the user's name). */
  chipMeta?: string;
  /** Optional trailing pill on the chip (e.g. a trial counter). */
  chipBadge?: { text: string; title?: string } | null;
  /** Banner body. */
  children: ReactNode;
  /** Class applied to the banner wrapper. */
  bannerClassName?: string;
  /** Tooltip for the docked chip (clicking it scrolls back to the top). */
  chipTitle?: string;
}

/**
 * A hero banner that flies into a viewport corner and parks itself as a
 * compact glass chip.
 *
 * On arrival it sits in the normal page flow. The moment you start scrolling
 * it flies up and sideways, shrinking as it goes, and parks itself in the
 * chosen corner. Scroll back to the top and it returns to its original place
 * — the flight is driven directly by scroll position, so it always tracks your
 * thumb exactly.
 *
 * The corner is configurable (`side`) so the dashboard and the Settings page
 * can both use it and park on the same edge.
 */
export default function HeroDock({
  side = 'left',
  chipIcon,
  chipLabel,
  chipMeta,
  chipBadge = null,
  children,
  bannerClassName = 'dash-hero',
  chipTitle = 'Back to top',
}: HeroDockProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const flyRef  = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const box     = useRef({ top: 0, left: 0, width: 1 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /** Cache the banner's resting geometry in document coordinates. */
  const measure = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    box.current = {
      top:   r.top + window.scrollY,
      left:  r.left,
      width: Math.max(1, r.width),
    };
  }, []);

  /** Position the banner + chip for the current scroll offset. */
  const apply = useCallback(() => {
    const fly  = flyRef.current;
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
    const isLeft = side === 'left';

    // Where the chip's left edge has to end up in viewport coordinates.
    const cornerLeft = isLeft
      ? CORNER_EDGE
      : window.innerWidth - chipW - CORNER_EDGE;

    // Vector from the banner's current position to the corner.
    //
    // The banner scales toward a different corner on each side (top-left when
    // parking left, top-right when parking right), so the edge that stays
    // pinned is the one nearest the corner. Measuring from the wrong edge
    // overshoots the viewport by the banner's width and opens a horizontal
    // scrollbar.
    const dx = isLeft
      ? cornerLeft - m.left
      : (window.innerWidth - CORNER_EDGE) - (m.left + m.width);
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
    // The chip slides in from the outside edge it is parked against.
    const slide = (1 - p) * chipW * 0.8 * (isLeft ? -1 : 1);
    chip.style.transform =
      `translate3d(${slide.toFixed(2)}px, 0, 0) ` +
      `scale(${(0.93 + 0.07 * p).toFixed(4)})`;
    chip.style.pointerEvents = p > 0.7 ? 'auto' : 'none';
  }, [side]);

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
    // `mounted` is a dep so the first pass runs *after* the chip has been
    // portalled into <body> — otherwise the chip would stay invisible until
    // the first scroll event.
  }, [apply, measure, mounted]);

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

  const chip = (
    <div
      className={`hero-dock-chip hero-dock-chip-${side}`}
      ref={chipRef}
      role="button"
      tabIndex={-1}
      title={chipTitle}
      aria-label={chipTitle}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      {chipIcon && <span className="hero-dock-chip-avatar" aria-hidden>{chipIcon}</span>}
      <span className="hero-dock-chip-text">
        <span className="hero-dock-chip-greeting">{chipLabel}</span>
        {chipMeta && <span className="hero-dock-chip-name">, {chipMeta}</span>}
      </span>
      {chipBadge && (
        <span className="hero-dock-chip-badge" title={chipBadge.title}>{chipBadge.text}</span>
      )}
    </div>
  );

  return (
    <div className={`hero-dock-slot hero-dock-slot-${side}`} ref={slotRef}>
      {/* The banner that flies — transform is applied here, never on the banner
          itself (which owns its own entrance animation). */}
      <div className="hero-dock-fly" ref={flyRef}>
        <div className={bannerClassName}>{children}</div>
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
