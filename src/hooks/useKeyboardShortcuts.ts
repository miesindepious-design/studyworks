import { useEffect } from 'react';

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
      // Don't fire when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      const mod  = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const key  = e.key.toLowerCase();

      for (const [combo, cb] of Object.entries(shortcuts)) {
        const parts   = combo.toLowerCase().split('+');
        const needMod  = parts.includes('mod') || parts.includes('ctrl');
        const needShift = parts.includes('shift');
        const mainKey  = parts[parts.length - 1];

        const isEscape = mainKey === 'escape';

        if (isTyping && !isEscape) continue;

        if (
          mainKey === key &&
          (!needMod  || mod) &&
          (!needShift || shift) &&
          (needMod  === mod  || !needMod) &&
          (needShift === shift || !needShift)
        ) {
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
