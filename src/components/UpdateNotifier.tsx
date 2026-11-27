/**
 * UpdateNotifier — checks for a new version on startup (desktop app only)
 * and shows a dismissible banner when one is found.
 *
 * The Tauri `invoke('check_for_updates')` call is only available inside the
 * desktop build — in the browser `window.__TAURI__` is undefined so the
 * component returns null silently.
 */
import { useEffect, useState } from 'react';

type State =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up_to_date' }
  | { phase: 'available'; version: string; notes: string }
  | { phase: 'installing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export default function UpdateNotifier() {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only run inside the Tauri desktop shell
    if (!('__TAURI__' in window)) return;

    const run = async () => {
      setState({ phase: 'checking' });
      try {
        // @ts-ignore — Tauri invoke is injected at runtime
        const raw: string = await window.__TAURI__.core.invoke('check_for_updates');
        const result = JSON.parse(raw) as { status: string; version?: string; notes?: string };

        if (result.status === 'updated') {
          setState({ phase: 'available', version: result.version ?? '', notes: result.notes ?? '' });
        } else {
          setState({ phase: 'up_to_date' });
        }
      } catch (err: any) {
        // Network offline or server unreachable — fail silently
        setState({ phase: 'error', message: err?.message ?? 'Update check failed' });
      }
    };

    // Check 3 seconds after launch so it doesn't block the initial render
    const t = setTimeout(run, 3000);
    return () => clearTimeout(t);
  }, []);

  if (dismissed) return null;
  if (state.phase !== 'available' && state.phase !== 'installing' && state.phase !== 'done') return null;

  if (state.phase === 'done') {
    return (
      <div style={bannerStyle('#22c55e')}>
        <span>✅ Update installed — restart StudyWorks to use the new version.</span>
        <button style={closeStyle} onClick={() => setDismissed(true)}>✕</button>
      </div>
    );
  }

  if (state.phase === 'installing') {
    return (
      <div style={bannerStyle('var(--accent)')}>
        <span>⬇️ Installing update…</span>
      </div>
    );
  }

  // phase === 'available'
  const { version, notes } = state as { phase: 'available'; version: string; notes: string };
  return (
    <div style={bannerStyle('var(--accent)')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        <span style={{ fontWeight: 600 }}>🚀 StudyWorks {version} is available</span>
        {notes && <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>{notes}</span>}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          style={{ ...closeStyle, background: 'white', color: 'var(--accent)', padding: '0.25rem 0.75rem', borderRadius: 6, fontWeight: 600, border: 'none', cursor: 'pointer' }}
          onClick={async () => {
            setState({ phase: 'installing' });
            try {
              // @ts-ignore
              await window.__TAURI__.core.invoke('check_for_updates');
              setState({ phase: 'done' });
            } catch {
              setState({ phase: 'error', message: 'Install failed' });
            }
          }}
        >
          Install now
        </button>
        <button style={closeStyle} onClick={() => setDismissed(true)}>✕</button>
      </div>
    </div>
  );
}

function bannerStyle(bg: string): React.CSSProperties {
  return {
    position:       'fixed',
    bottom:         '1rem',
    right:          '1rem',
    left:           '1rem',
    maxWidth:       '480px',
    margin:         '0 auto',
    background:     bg,
    color:          'white',
    padding:        '0.75rem 1rem',
    borderRadius:   '0.5rem',
    boxShadow:      '0 4px 16px rgba(0,0,0,0.25)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            '1rem',
    zIndex:         9999,
    fontSize:       '0.88rem',
    lineHeight:     1.4,
  };
}

const closeStyle: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      'white',
  cursor:     'pointer',
  fontSize:   '1rem',
  padding:    '0.1rem 0.3rem',
  flexShrink: 0,
};
