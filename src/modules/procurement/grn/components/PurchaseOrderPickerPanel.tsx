'use client';

/**
 * The open dropdown of the purchase-order picker: search box plus listbox.
 *
 * Split from PurchaseOrderPicker so each file stays inside the component size
 * limit. All state lives in the parent; this renders it and reports choices.
 */

import type { RefObject } from 'react';
import { Search } from 'lucide-react';
import type { PickerPurchaseOrder } from '../lib/poPickerOptions';
import { PurchaseOrderPickerOption } from './PurchaseOrderPickerOption';

interface Props {
  listboxId: string;
  optionDomId: (index: number) => string;
  query: string;
  onQueryChange: (value: string) => void;
  rows: { poId: string; po: PickerPurchaseOrder | null; selectable: boolean }[];
  activeIndex: number;
  selectedPOId: string;
  emptyLabel: string;
  onChoose: (poId: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  listRef: RefObject<HTMLDivElement>;
}

export function PurchaseOrderPickerPanel({
  listboxId, optionDomId, query, onQueryChange, rows, activeIndex,
  selectedPOId, emptyLabel, onChoose, inputRef, listRef,
}: Props) {
  return (
    <div className="absolute z-30 mt-1 w-full rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-lg">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ff-border-light)]">
        <Search className="h-4 w-4 shrink-0 text-[var(--ff-text-tertiary)]" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search PO number or supplier…"
          aria-label="Search purchase orders"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
          className="w-full bg-transparent text-sm text-[var(--ff-text-primary)] focus:outline-none"
        />
      </div>

      <div ref={listRef} id={listboxId} role="listbox" className="max-h-72 overflow-auto">
        {rows.map((row, index) =>
          row.po ? (
            <PurchaseOrderPickerOption
              key={row.po.id}
              po={row.po}
              id={optionDomId(index)}
              selected={row.po.id === selectedPOId}
              active={index === activeIndex}
              selectable={row.selectable}
              onChoose={() => onChoose(row.po!.id)}
            />
          ) : (
            <button
              key="standalone"
              type="button"
              id={optionDomId(index)}
              role="option"
              aria-selected={!selectedPOId}
              tabIndex={-1}
              onClick={() => onChoose('')}
              className={`w-full text-left cursor-pointer px-3 py-2 text-sm border-b border-[var(--ff-border-light)] ${
                index === activeIndex ? 'bg-[var(--ff-bg-tertiary)]' : 'hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              {emptyLabel}
            </button>
          )
        )}

        {rows.length === 1 && (
          <div className="px-3 py-3 text-sm text-[var(--ff-text-tertiary)]">
            No purchase order matches “{query}”
          </div>
        )}
      </div>
    </div>
  );
}
