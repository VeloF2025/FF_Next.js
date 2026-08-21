'use client';

/**
 * The closed state of the purchase-order picker: the button that opens the
 * panel, plus the clear control when a PO is selected.
 *
 * Split out to keep the picker inside the component size limit. The clear
 * control is a sibling button rather than nested inside the trigger — an
 * interactive element inside a button is invalid and unreachable by keyboard.
 */

import type { RefObject } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Props {
  triggerRef: RefObject<HTMLButtonElement>;
  label: string;
  open: boolean;
  disabled: boolean;
  listboxId: string;
  showClear: boolean;
  onToggle: () => void;
  onClear: () => void;
}

export function PurchaseOrderPickerTrigger({
  triggerRef, label, open, disabled, listboxId, showClear, onToggle, onClear,
}: Props) {
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={`w-full flex items-center gap-2 px-4 py-2 border rounded-lg text-left text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
          disabled
            ? 'bg-[var(--ff-bg-tertiary)] border-emerald-500/30 opacity-75 cursor-not-allowed'
            : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={showClear ? 'w-6' : ''} aria-hidden="true" />
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ff-text-tertiary)]" />
      </button>

      {showClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selected purchase order"
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
