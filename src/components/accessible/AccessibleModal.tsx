// AccessibleModal — WCAG 2.1 AA compliant dialog wrapper
// Fixes: 1.3.1 (role=dialog), 2.1.1 (focus trap), 2.1.2 (Escape closes),
//        2.4.3 (focus management), 4.1.2 (close button aria-label)
//
// Usage:
//   <AccessibleModal isOpen={open} onClose={handleClose} title="My Modal">
//     <MyModalContent />
//   </AccessibleModal>

'use client';

import { useEffect, useRef, useCallback, ReactNode } from 'react';
import { X } from 'lucide-react';

export interface AccessibleModalProps {
  /** Controls visibility */
  isOpen: boolean;
  /** Called when user closes (Escape, backdrop click, close button) */
  onClose: () => void;
  /** Modal heading — rendered as <h2> and linked via aria-labelledby */
  title: string;
  /** Unique id for the heading element (defaults to "modal-title") */
  titleId?: string;
  /** Modal body content */
  children: ReactNode;
  /** Extra classes on the dialog panel (e.g. "max-w-2xl") */
  className?: string;
  /** When true, clicking the backdrop does NOT close the modal */
  preventBackdropClose?: boolean;
}

/** Focusable element selectors per WCAG 2.1 / HTML spec */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

export function AccessibleModal({
  isOpen,
  onClose,
  title,
  titleId = 'modal-title',
  children,
  className = '',
  preventBackdropClose = false,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // --- Focus management -------------------------------------------------

  /** Save trigger element and move focus into modal */
  useEffect(() => {
    if (isOpen) {
      // Remember what was focused before the modal opened
      triggerRef.current = document.activeElement;

      // Move focus to the first focusable element (or dialog itself)
      const dialog = dialogRef.current;
      if (dialog) {
        const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
        const first = focusable[0] ?? dialog;
        // Defer one tick so the modal is painted
        requestAnimationFrame(() => first.focus());
      }
    } else {
      // Restore focus to the element that opened the modal
      const trigger = triggerRef.current as HTMLElement | null;
      if (trigger && typeof trigger.focus === 'function') {
        requestAnimationFrame(() => trigger.focus());
      }
      triggerRef.current = null;
    }
  }, [isOpen]);

  // --- Focus trap --------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Escape closes
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Tab cycles within the dialog
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.closest('[aria-hidden="true"]')
        );

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (e.shiftKey) {
          // Shift+Tab: wrap from first → last
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: wrap from last → first
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  // --- Backdrop click ----------------------------------------------------

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!preventBackdropClose && e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose, preventBackdropClose]
  );

  // --- Render ------------------------------------------------------------

  if (!isOpen) return null;

  return (
    /* Backdrop — aria-modal="true" on the inner dialog scopes screen readers; do NOT
       aria-hidden the backdrop wrapper or the dialog inside becomes invisible to AT */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      {/* Dialog panel — NOT aria-hidden, receives keyboard events */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          'relative w-full max-w-lg bg-[var(--ff-surface)] rounded-lg shadow-2xl',
          'border border-[var(--ff-border)]',
          'focus:outline-none',
          className,
        ].join(' ')}
        onKeyDown={handleKeyDown}
        // Stop backdrop click from propagating from inside the panel
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border)]">
          <h2
            id={titleId}
            className="text-base font-semibold text-[var(--ff-text-primary)]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
