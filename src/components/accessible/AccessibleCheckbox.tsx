/**
 * AccessibleCheckbox
 *
 * WCAG 2.1 AA compliant checkbox using the CSS `peer` pattern.
 *
 * Why not plain <input type="checkbox">?
 * Tailwind does not include @tailwindcss/forms in this project, so native
 * checkbox appearance is browser-default. We use `appearance-none` + `peer`
 * to apply the FibreFlow design tokens while keeping the real input in the
 * DOM (screen-reader / keyboard accessible out of the box).
 *
 * Implements:
 *   - Native <input type="checkbox"> in DOM              (WCAG 4.1.2)
 *   - Visible focus ring via peer-focus-visible           (WCAG 2.4.7)
 *   - aria-labelledby OR explicit <label>                 (WCAG 1.3.1)
 *   - aria-readonly + cursor-default for auto items       (WCAG 4.1.2)
 *   - aria-describedby for supplementary hints            (WCAG 1.3.1)
 *   - Colour + checkmark icon double-coding               (WCAG 1.4.1)
 *
 * Usage:
 *   // Standalone with visible label
 *   <AccessibleCheckbox id="item-1" checked label="Install poles" onChange={...} />
 *
 *   // Label lives elsewhere — reference it by id
 *   <span id="name-1">Install poles</span>
 *   <AccessibleCheckbox id="item-1" checked labelledById="name-1" onChange={...} />
 *
 *   // Auto-completed, read-only
 *   <AccessibleCheckbox id="auto-1" checked readOnly readOnlyTitle="Auto-detected" labelledById="name-1" />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface AccessibleCheckboxProps {
  id: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Inline label text — renders a <label> linked by htmlFor */
  label?: React.ReactNode;
  /** ID of an external element that labels this checkbox (alternative to label) */
  labelledById?: string;
  /** ID of an element with supplementary info (e.g. "auto-detected" hint) */
  describedById?: string;
  /**
   * When true the checkbox is visually checked but cannot be toggled.
   * Sets aria-readonly and removes pointer-events.
   */
  readOnly?: boolean;
  /** Tooltip text shown on hover for readOnly checkboxes */
  readOnlyTitle?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function AccessibleCheckbox({
  id,
  checked,
  onChange,
  label,
  labelledById,
  describedById,
  readOnly = false,
  readOnlyTitle,
  size = 'md',
  className,
}: AccessibleCheckboxProps) {
  const sizeClasses = size === 'sm'
    ? { wrapper: 'w-4 h-4', icon: 'w-2.5 h-2.5' }
    : { wrapper: 'w-5 h-5', icon: 'w-3 h-3' };

  return (
    <span className={cn('inline-flex items-center gap-2 flex-shrink-0', className)}>
      {/* Real input — kept in DOM for a11y, visually replaced by the span below */}
      <span className="relative inline-flex">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-labelledby={labelledById}
          aria-describedby={describedById}
          title={readOnly ? (readOnlyTitle ?? 'Read-only') : undefined}
          onChange={(e) => {
            if (!readOnly) onChange?.(e.target.checked);
          }}
          className={cn(
            // Visually hidden but occupies same space as the visual indicator
            'appearance-none absolute inset-0 opacity-0 m-0 p-0',
            sizeClasses.wrapper,
            readOnly ? 'cursor-default' : 'cursor-pointer',
            // Peer class drives the visual indicator below
            'peer',
          )}
        />

        {/* Visual indicator — driven by peer state */}
        <span
          aria-hidden="true"
          className={cn(
            sizeClasses.wrapper,
            'inline-flex items-center justify-center flex-shrink-0',
            'rounded border-2 transition-colors',
            // Unchecked
            'border-gray-500 bg-transparent',
            // Checked (via peer)
            'peer-checked:bg-emerald-500 peer-checked:border-emerald-500',
            // Focus ring (keyboard navigation)
            'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ff-accent)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--ff-card-bg)]',
            readOnly && 'peer-checked:cursor-default opacity-90',
          )}
        >
          {/* Checkmark icon — visible when checked */}
          {checked && (
            <svg
              className={cn(sizeClasses.icon, 'text-white')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </span>
      </span>

      {/* Inline label */}
      {label && (
        <label
          htmlFor={id}
          className={cn(
            'text-sm text-[var(--ff-text-primary)]',
            readOnly ? 'cursor-default' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
      )}
    </span>
  );
}

export default AccessibleCheckbox;
