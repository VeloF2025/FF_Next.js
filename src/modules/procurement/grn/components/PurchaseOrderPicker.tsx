'use client';

/**
 * PurchaseOrderPicker — searchable combobox for the GRN "Source Purchase Order".
 *
 * Replaces a native <select> holding every receivable PO (621 in production on
 * 2026-08-21) with no search, which sorted part-received POs below every
 * untouched one — so an order awaiting its second receipt landed ~350 entries
 * down and read as deleted. The page has already loaded the list, so filtering
 * is local.
 *
 * Keyboard parity with the <select> is deliberate: the search box replaces
 * type-ahead, Arrow/Home/End/Enter/Escape behave as in a native listbox, and
 * focus returns to the trigger on close so it is never dropped on <body>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPickerRows, filterAndRankPos, type PickerPurchaseOrder } from '../lib/poPickerOptions';
import { isNavKey, nextActiveIndex } from '../lib/listboxNavigation';
import { PurchaseOrderPickerPanel } from './PurchaseOrderPickerPanel';
import { PurchaseOrderPickerTrigger } from './PurchaseOrderPickerTrigger';

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
  const [refusal, setRefusal] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildPickerRows(filterAndRankPos(purchaseOrders, query)),
    [purchaseOrders, query]
  );
  const selected = useMemo(
    () => purchaseOrders.find((po) => po.id === selectedPOId) ?? null,
    [purchaseOrders, selectedPOId]
  );

  /** Close and hand focus back to the trigger — never leave it on <body>. */
  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    setRefusal('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  /**
   * One decision point for mouse and keyboard. A fully-received PO is refused
   * out loud: ignoring the click silently reads as a broken control to anyone
   * not parsing the muted "Fully received" badge.
   */
  const choose = useCallback(
    (poId: string) => {
      const row = rows.find((r) => r.poId === poId);
      if (row && !row.selectable) {
        const name = row.po?.poNumber ?? 'That purchase order';
        setRefusal(`${name} is fully received — nothing left to receive against it.`);
        return;
      }
      onSelect(poId);
      close();
    },
    [rows, onSelect, close]
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A filtered-out active row must not stay active.
  useEffect(() => {
    setActiveIndex(-1);
    setRefusal('');
  }, [query]);

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
        if (row) choose(row.poId);
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
   * Tab-away closes the panel. A null relatedTarget is ignored so a mousedown
   * on inert panel chrome does not close it under the pointer. That branch is
   * NOT tested: jsdom reports body rather than null, so any test would assert
   * on a jsdom quirk. Outside clicks are covered by the mousedown tests.
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
      <PurchaseOrderPickerTrigger
        triggerRef={triggerRef}
        label={triggerLabel}
        open={open}
        disabled={disabled}
        listboxId={LISTBOX_ID}
        showClear={!!selected && !disabled}
        onToggle={() => !disabled && (open ? close() : setOpen(true))}
        onClear={() => choose('')}
      />

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
          refusal={refusal}
          inputRef={inputRef}
          listRef={listRef}
        />
      )}
    </div>
  );
}
