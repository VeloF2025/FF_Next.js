import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Modal focus handling shared by the delivery dialogs: move focus in on open,
 * trap Tab and Shift+Tab inside, close on Escape, and hand focus back to
 * whatever opened it. Extracted so a second dialog does not need a second
 * implementation of the same accessibility contract.
 */
export function useDialogFocus(open: boolean, close: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let frame: number | undefined;
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      frame = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? dialog)?.focus();
      });
    } else if (triggerRef.current) {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      frame = requestAnimationFrame(() => trigger.focus());
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [open]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(element => !element.closest('[aria-hidden="true"]'));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close]);

  return { dialogRef, handleKeyDown };
}
