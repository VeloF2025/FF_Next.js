'use client';

/**
 * ConfirmDialog - Accessible confirmation dialog component
 *
 * Replaces native window.confirm() with a styled, accessible modal:
 * - Focus trap: keeps keyboard focus inside the dialog while open
 * - Escape key closes the dialog (triggers onCancel)
 * - aria-modal, aria-labelledby, aria-describedby for screen readers
 * - Variant-based colour coding: danger (red), warning (amber), info (blue)
 * - Dark-mode compatible via var(--ff-*) CSS variables
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Info, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  open: boolean;
  /** Called when the user clicks the confirm button */
  onConfirm: () => void;
  /** Called when the user cancels or presses Escape */
  onCancel: () => void;
  /** Dialog heading */
  title: string;
  /** Explanatory text shown below the title */
  message: string;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Visual variant that controls icon and button colour */
  variant?: ConfirmDialogVariant;
}

// ---------------------------------------------------------------------------
// Variant maps
// ---------------------------------------------------------------------------

const variantConfig: Record<
  ConfirmDialogVariant,
  {
    icon: React.ReactNode;
    iconBg: string;
    confirmBtn: string;
  }
> = {
  danger: {
    icon: <Trash2 className="h-6 w-6 text-red-500" aria-hidden="true" />,
    iconBg: 'bg-red-500/10',
    confirmBtn:
      'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500 text-white',
  },
  warning: {
    icon: (
      <AlertTriangle
        className="h-6 w-6 text-amber-500"
        aria-hidden="true"
      />
    ),
    iconBg: 'bg-amber-500/10',
    confirmBtn:
      'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500 text-white',
  },
  info: {
    icon: <Info className="h-6 w-6 text-blue-500" aria-hidden="true" />,
    iconBg: 'bg-blue-500/10',
    confirmBtn:
      'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500 text-white',
  },
};

// ---------------------------------------------------------------------------
// Focus-trap helper
// ---------------------------------------------------------------------------

/** Returns all focusable elements within a container */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'info',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(`confirm-dialog-title-${Math.random().toString(36).slice(2)}`);
  const descId = useRef(`confirm-dialog-desc-${Math.random().toString(36).slice(2)}`);

  const { icon, iconBg, confirmBtn } = variantConfig[variant];

  // Move focus into dialog when it opens
  useEffect(() => {
    if (open) {
      // Defer so the DOM is fully rendered
      const frame = requestAnimationFrame(() => {
        cancelBtnRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  // Trap focus inside dialog and handle Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!dialogRef.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length === 0) return;

        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onCancel]
  );

  // Prevent scroll on the body while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--ff-surface-overlay)' }}
      onClick={onCancel}
      aria-hidden="true"
    >
      {/* Dialog panel — stop backdrop click propagation */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        aria-describedby={descId.current}
        className={cn(
          'relative w-full max-w-md rounded-xl shadow-2xl',
          'bg-[var(--ff-surface-primary)] border border-[var(--ff-border-primary)]',
          'focus:outline-none'
        )}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Close button (top-right) */}
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'absolute right-3 top-3 rounded-md p-1',
            'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]',
            'hover:bg-[var(--ff-border-subtle)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-border-focus)]'
          )}
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Body */}
        <div className="p-6">
          {/* Icon + Title row */}
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'flex-shrink-0 flex items-center justify-center rounded-full h-10 w-10',
                iconBg
              )}
              aria-hidden="true"
            >
              {icon}
            </div>

            <div className="flex-1 min-w-0">
              <h2
                id={titleId.current}
                className="text-base font-semibold text-[var(--ff-text-primary)] leading-snug"
              >
                {title}
              </h2>
              <p
                id={descId.current}
                className="mt-1 text-sm text-[var(--ff-text-secondary)]"
              >
                {message}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex flex-row-reverse gap-3">
            {/* Confirm */}
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                confirmBtn
              )}
            >
              {confirmLabel}
            </button>

            {/* Cancel — receives initial focus (safer UX default) */}
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                'bg-[var(--ff-border-subtle)] text-[var(--ff-text-primary)]',
                'hover:bg-[var(--ff-border-primary)]',
                'focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[var(--ff-border-focus)] focus-visible:ring-offset-2'
              )}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
