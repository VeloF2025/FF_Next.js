'use client';

/**
 * PurchaseOrderPicker — searchable combobox for the GRN "Source Purchase Order".
 *
 * Replaces a native <select> that carried every receivable PO (621 in
 * production on 2026-08-21) with no way to search. Part-received POs sorted
 * below every untouched one, so an order awaiting its second receipt landed
 * ~350 entries down and read as deleted.
 *
 * The whole list is already loaded by the page, so filtering is local — no
 * search endpoint, no debounce.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  filterAndRankPos,
  isPoSelectable,
  poReceiptState,
  poStateBadge,
  type PickerPurchaseOrder,
} from '../lib/poPickerOptions';

interface Props {
  purchaseOrders: PickerPurchaseOrder[];
  selectedPOId: string;
  onSelect: (poId: string) => void;
  disabled?: boolean;
  /** Rendered when nothing is selected — the standalone-receipt case. */
  emptyLabel?: string;
}

const BADGE_CLASS: Record<string, string> = {
  partially_received: 'bg-amber-500/15 text-amber-400',
  fully_received: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
};

export function PurchaseOrderPicker({
  purchaseOrders,
  selectedPOId,
  onSelect,
  disabled = false,
  emptyLabel = 'No linked PO (standalone receipt)',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () => filterAndRankPos(purchaseOrders, query),
    [purchaseOrders, query]
  );
  const selected = useMemo(
    () => purchaseOrders.find((po) => po.id === selectedPOId) ?? null,
    [purchaseOrders, selectedPOId]
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = useCallback(
    (poId: string) => {
      onSelect(poId);
      setOpen(false);
      setQuery('');
    },
    [onSelect]
  );

  const triggerLabel = selected
    ? `${selected.poNumber} — ${selected.supplierName} (${selected.itemCount} items)`
    : emptyLabel;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-4 py-2 border rounded-lg text-left text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
          disabled
            ? 'bg-[var(--ff-bg-tertiary)] border-emerald-500/30 opacity-75 cursor-not-allowed'
            : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
        }`}
      >
        <span className="truncate flex-1">{triggerLabel}</span>
        {/* Space reserved for the clear control, which is a sibling button —
            nesting an interactive element inside a button is invalid. */}
        <span className={selected && !disabled ? 'w-4' : ''} aria-hidden="true" />
        <ChevronDown className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
      </button>

      {selected && !disabled && (
        <button
          type="button"
          onClick={() => choose('')}
          aria-label="Clear selected purchase order"
          className="absolute right-9 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ff-border-light)]">
            <Search className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PO number or supplier…"
              aria-label="Search purchase orders"
              className="w-full bg-transparent text-sm text-[var(--ff-text-primary)] focus:outline-none"
            />
          </div>

          <div className="max-h-72 overflow-auto" role="listbox">
            <button
              type="button"
              onClick={() => choose('')}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]"
            >
              {emptyLabel}
            </button>

            {visible.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[var(--ff-text-tertiary)]">
                No purchase order matches “{query}”
              </div>
            ) : (
              visible.map((po) => {
                const selectable = isPoSelectable(po);
                const badge = poStateBadge(po);
                return (
                  <button
                    key={po.id}
                    type="button"
                    role="option"
                    aria-selected={po.id === selectedPOId}
                    disabled={!selectable}
                    onClick={() => selectable && choose(po.id)}
                    className={`w-full text-left px-3 py-2 border-b border-[var(--ff-border-light)] last:border-b-0 ${
                      selectable
                        ? 'hover:bg-[var(--ff-bg-tertiary)]'
                        : 'opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--ff-text-primary)] truncate">
                        {po.poNumber}
                      </span>
                      {badge && (
                        <span
                          className={`ml-auto shrink-0 text-[11px] px-1.5 py-0.5 rounded ${
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
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
