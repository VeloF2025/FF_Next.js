'use client';

/**
 * A single row in the purchase-order listbox.
 *
 * Split out to keep the picker itself under the 200-line component limit.
 *
 * Unselectable rows use aria-disabled rather than the native disabled
 * attribute: native disabled drops the row out of the accessibility tree, so a
 * screen-reader user could never discover that a fully-received PO exists or
 * why it cannot be chosen. The row stays reachable and announces its state; the
 * refusal happens when choosing.
 */

import { poReceiptState, poStateBadge, type PickerPurchaseOrder } from '../lib/poPickerOptions';

const BADGE_CLASS: Record<string, string> = {
  partially_received: 'bg-amber-500/15 text-amber-400',
  fully_received: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
};

interface Props {
  po: PickerPurchaseOrder;
  id: string;
  selected: boolean;
  active: boolean;
  selectable: boolean;
  onChoose: () => void;
}

export function PurchaseOrderPickerOption({
  po, id, selected, active, selectable, onChoose,
}: Props) {
  const badge = poStateBadge(po);
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={!selectable}
      tabIndex={-1}
      onClick={() => selectable && onChoose()}
      className={`w-full text-left px-3 py-2 border-b border-[var(--ff-border-light)] last:border-b-0 ${
        selectable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
      } ${active ? 'bg-[var(--ff-bg-tertiary)]' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--ff-text-primary)]">
          {po.poNumber}
        </span>
        {badge && (
          <span
            className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded ${
              BADGE_CLASS[poReceiptState(po)] ?? ''
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="text-[11px] text-[var(--ff-text-tertiary)] truncate">
        {po.supplierName} · {po.itemCount} items
      </div>
    </button>
  );
}
