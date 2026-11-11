import { useEffect } from 'react';
import { isShortcutCaptureActive, matchesCombo } from '../config/shortcuts';

export type ShortcutMap = {
  [combo: string]: (e: KeyboardEvent) => void;
};

/**
 * Register global keyboard shortcuts.
 * Combo format: "mod+k", "ctrl+z", "escape", "arrowleft"
 * "mod" maps to Cmd on Mac, Ctrl on Windows/Linux.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // The Settings shortcut editor is mid-capture — it owns the keyboard.
      if (isShortcutCaptureActive()) return;

      // Don't fire when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      for (const [combo, cb] of Object.entries(shortcuts)) {
        const isEscape = combo.toLowerCase().split('+').pop() === 'escape';
        if (isTyping && !isEscape) continue;

        if (matchesCombo(e, combo)) {
          e.preventDefault();
          cb(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, enabled]);
}
