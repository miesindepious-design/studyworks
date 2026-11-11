/**
 * Timer settings panel — shared by the Timer page and the Settings page.
 *
 * Both surfaces used to render their own copy of these controls against their
 * own copy of the settings. This component is the single implementation; the
 * two pages just decide where to place it.
 */

import type { TimerSettings } from '../hooks/useTimerSettings';

interface TimerSettingsPanelProps {
  settings: TimerSettings;
  onChange: (patch: Partial<TimerSettings>) => void;
}

/** Web Audio chime shared by the Timer page and Settings. */
export function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.18, 0.36].forEach((offset, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 880 : 660, now + offset);
      gain.gain.setValueAtTime(0.3, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio unavailable — the timer still works, just silently */
  }
}

export default function TimerSettingsPanel({ settings, onChange }: TimerSettingsPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Focus duration */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <label className="form-label">Focus session duration</label>
          <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>
            {settings.focusDuration} min
          </span>
        </div>
        <input
          type="range" min="5" max="60" step="5"
          value={settings.focusDuration}
          onChange={e => onChange({ focusDuration: +e.target.value })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="text-xs text-muted">5 min</span>
          <span className="text-xs text-muted">60 min</span>
        </div>
      </div>

      {/* Break duration */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <label className="form-label">Break duration</label>
          <span className="text-sm" style={{ fontWeight: 700, color: 'var(--accent)' }}>
            {settings.breakDuration} min
          </span>
        </div>
        <input
          type="range" min="1" max="30" step="1"
          value={settings.breakDuration}
          onChange={e => onChange({ breakDuration: +e.target.value })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="text-xs text-muted">1 min</span>
          <span className="text-xs text-muted">30 min</span>
        </div>
      </div>

      {/* Auto-start breaks */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Auto-start breaks</p>
          <p className="text-xs text-muted">Automatically start the break timer after each focus session.</p>
        </div>
        <button
          className="toggle"
          onClick={() => onChange({ autoStartBreak: !settings.autoStartBreak })}
          role="switch" aria-checked={settings.autoStartBreak}
          aria-label="Auto-start breaks"
        />
      </div>

      {/* Sound */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>🔔 Sound notification</p>
          <p className="text-xs text-muted">Play a chime when each focus/break session ends.</p>
        </div>
        <button
          className="toggle"
          onClick={() => {
            const next = !settings.soundEnabled;
            onChange({ soundEnabled: next });
            if (next) playBeep();
          }}
          role="switch" aria-checked={settings.soundEnabled}
          aria-label="Sound notification"
        />
      </div>
    </div>
  );
}
