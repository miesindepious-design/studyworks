import { useState, useCallback } from 'react';

interface UndoRedoState<T> {
  state: T;
  set: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

export function useUndoRedo<T>(initialState: T | (() => T), maxHistory = 30): UndoRedoState<T> {
  const [history, setHistory] = useState<T[]>(() => {
    const init = typeof initialState === 'function' ? (initialState as () => T)() : initialState;
    return [init];
  });
  const [index, setIndex] = useState(0);

  const state = history[index];

  const set = useCallback((next: T) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, index + 1);
      const capped  = trimmed.length >= maxHistory ? trimmed.slice(1) : trimmed;
      return [...capped, next];
    });
    setIndex(prev => Math.min(prev + 1, maxHistory - 1));
  }, [index, maxHistory]);

  const undo = useCallback(() => {
    setIndex(prev => Math.max(prev - 1, 0));
  }, []);

  const redo = useCallback(() => {
    setIndex(prev => Math.min(prev + 1, history.length - 1));
  }, [history.length]);

  const clear = useCallback(() => {
    setHistory([state]);
    setIndex(0);
  }, [state]);

  return {
    state,
    set,
    undo,
    redo,
    canUndo: index > 0,
    canRedo: index < history.length - 1,
    clear,
  };
}
