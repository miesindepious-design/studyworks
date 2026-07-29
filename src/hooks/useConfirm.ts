/**
 * useConfirm — drop-in replacement for window.confirm that renders ConfirmModal.
 *
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   ...
 *   const ok = await confirm({ title: 'Delete?', description: '...', danger: true });
 *   if (ok) doDelete();
 *   ...
 *   return <div>...<ConfirmDialog /></div>
 */

import { useState, useCallback, useRef } from 'react';

interface ConfirmOptions {
  title:        string;
  description:  string;
  confirmLabel?: string;
  cancelLabel?:  string;
  danger?:       boolean;
}

export function useConfirm() {
  const [opts, setOpts]       = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setOpts(options);
    return new Promise(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    setOpts(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    setOpts(null);
  }, []);

  // Returns JSX to embed in render — null when no dialog is open
  const ConfirmDialog = opts ? {
    isOpen:      true,
    title:       opts.title,
    description: opts.description,
    confirmLabel: opts.confirmLabel,
    cancelLabel:  opts.cancelLabel,
    danger:       opts.danger,
    onConfirm:   handleConfirm,
    onCancel:    handleCancel,
  } : null;

  return { confirm, ConfirmDialog };
}
