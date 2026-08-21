'use client';

/**
 * PurchaseOrderPicker — searchable combobox for the GRN "Source Purchase Order".
 *
 * Replaces a native <select> that carried every receivable PO (621 in
 * production on 2026-08-21) with no way to search, and sorted part-received
 * POs below every untouched one — so an order awaiting its second receipt
 * landed ~350 entries down and read as deleted.
 *
 * The page has already loaded the list, so filtering is local.
 *
 * Keyboard parity with the <select> is deliberate: the search box replaces
 * type-ahead, Arrow/Home/End/Enter/Escape behave as in a native listbox, and
 * focus returns to the trigger on close so it is never dropped on <body>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { buildPickerRows, filterAndRankPos, type PickerPurchaseOrder } from '../lib/poPickerOptions';
import { isNavKey, nextActiveIndex } from '../lib/listboxNavigation';
import { PurchaseOrderPickerPanel } from './PurchaseOrderPickerPanel';

interface Props {
  purchaseOrders: PickerPurchaseOrder[];
  selectedPOId: string;
  onSelect: (poId: string) => void;
  disabled?: boolean;
  /** Rendered when nothing is selected — the standalone-receipt case. */
  emptyLabel?: string;
}

const LISTBOX_ID = 'grn-po-listbox';
const optionDomId = (i: number) => `${LISTBOX_ID}-option-${i}`;
export function PurchaseOrderPicker({
  purchaseOrders,
  selectedPOId,
  onSelect,
  disabled = false,
  emptyLabel = 'No linked PO (standalone receipt)',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => filterAndRankPos(purchaseOrders, query), [purchaseOrders, query]);

  const rows = useMemo(() => buildPickerRows(visible), [visible]);
  const selected = useMemo(
    () => purchaseOrders.find((po) => po.id === selectedPOId) ?? null,
    [purchaseOrders, selectedPOId]
  );

  /** Close and hand focus back to the trigger — never leave it on <body>. */
  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (poId: string) => {
      onSelect(poId);
      close();
    },
    [onSelect, close]
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A filtered-out active row must not stay active.
  useEffect(() => setActiveIndex(-1), [query]);

  // Keep the active row in view when arrowing through a long list.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelector(`#${CSS.escape(optionDomId(activeIndex))}`);
    // Guarded: jsdom does not implement scrollIntoView, and a list that cannot
    // scroll is a cosmetic loss — it must not take the picker down with it.
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  useEffect(() => {
    const onDocPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Clicking elsewhere means focus is going elsewhere: do not steal it back.
        close(false);
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [close]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isNavKey(e.key)) {
        e.preventDefault();
        setActiveIndex((current) => nextActiveIndex(current, e.key as never, rows.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row?.selectable) choose(row.poId);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [rows, activeIndex, choose, close]
  );

  /**
   * Tab-away closes the panel rather than leaving stale UI behind.
   *
   * A null relatedTarget is ignored so that pressing the mouse on inert panel
   * chrome (the empty-state line, padding) does not close the panel underneath
   * the pointer. NOT covered by a test: jsdom reports body rather than null
   * here, so the branch cannot be distinguished from the outside-click
   * listener without asserting on jsdom's own quirk. Outside clicks are
   * covered — see the mousedown tests.
   */
  const onBlurCapture = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next) return;
      if (containerRef.current?.contains(next)) return;
      if (open) close(false);
    },
    [open, close]
  );

  const triggerLabel = selected
    ? `${selected.poNumber} — ${selected.supplierName} (${selected.itemCount} items)`
    : emptyLabel;

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown} onBlurCapture={onBlurCapture}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? LISTBOX_ID : undefined}
        className={`w-full flex items-center gap-2 px-4 py-2 border rounded-lg text-left text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
          disabled
            ? 'bg-[var(--ff-bg-tertiary)] border-emerald-500/30 opacity-75 cursor-not-allowed'
            : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <span className={selected && !disabled ? 'w-6' : ''} aria-hidden="true" />
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ff-text-tertiary)]" />
      </button>

      {selected && !disabled && (
        <button
          type="button"
          onClick={() => choose('')}
          aria-label="Clear selected purchase order"
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {open && !disabled && (
        <PurchaseOrderPickerPanel
          listboxId={LISTBOX_ID}
          optionDomId={optionDomId}
          query={query}
          onQueryChange={setQuery}
          rows={rows}
          activeIndex={activeIndex}
          selectedPOId={selectedPOId}
          emptyLabel={emptyLabel}
          onChoose={choose}
          inputRef={inputRef}
          listRef={listRef}
        />
      )}
    </div>
  );
}
