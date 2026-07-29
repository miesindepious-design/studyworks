/**
 * useDebounce — returns `value` after it has been stable for `delay` ms.
 *
 * Common use: search inputs that drive expensive filtering. We don't want
 * to re-run `toPlainText` + filter on every keystroke — only after the
 * user has paused.
 */
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
