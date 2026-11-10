import { useEffect, useState } from 'react';
import { DOCK_ITEMS, type View } from '../config/nav';

interface CornerDockProps {
  currentView: View;
  onSelect: (view: View) => void;
  /** Extra views that should suppress the dock (e.g. full-screen overlays). */
  hidden?: boolean;
}

/** Scroll distance (px) before the dock deploys from the corner. */
const REVEAL_AT = 140;

/**
 * CornerDock — a HUD-style navigation rail pinned to the bottom-right corner.
 *
 * As the page scrolls down, the tabs deploy *out of the corner*: each one
 * slides in on its own stagger with a slight 3D tilt and a neon rim light,
 * then locks in place. Scrolling back to the top folds them away again.
 *
 * The rail on the left doubles as a scroll-depth readout.
 */
export function CornerDock({ currentView, onSelect, hidden = false }: CornerDockProps) {
  const [deployed, setDeployed] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // The pending-frame handle lives INSIDE the effect (not a ref) so a
    // StrictMode double-mount can't leave a stale "busy" flag behind and
    // silently kill the scroll handler on the second mount.
    let pending = 0;

    const measure = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const y = window.scrollY || 0;
        setDeployed(y > REVEAL_AT);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
      });
    };

    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (pending) cancelAnimationFrame(pending);
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      className={`corner-dock${deployed ? ' deployed' : ''}`}
      aria-hidden={!deployed}
      role="navigation"
      aria-label="Quick navigation"
    >
      {/* Tab stack */}
      <div className="corner-dock-stack">
        <span className="corner-dock-scan" aria-hidden />
        {DOCK_ITEMS.map((item, i) => {
          const active = currentView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              className={`corner-dock-tab${active ? ' active' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => { onSelect(item.view); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              tabIndex={deployed ? 0 : -1}
            >
              <span className="corner-dock-tab-icon" aria-hidden>{item.icon}</span>
              <span className="corner-dock-tab-label">{item.label}</span>
              <span className="corner-dock-tab-sweep" aria-hidden />
            </button>
          );
        })}
      </div>

      {/* Scroll-depth rail — hugs the outer edge so it never sits over content */}
      <div className="corner-dock-rail" aria-hidden="true">
        <span className="corner-dock-rail-fill" style={{ transform: `scaleY(${progress})` }} />
      </div>
    </div>
  );
}
