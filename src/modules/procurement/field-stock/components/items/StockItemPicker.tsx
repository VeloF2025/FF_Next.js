'use client';

/**
 * StockItemPicker — searchable combobox over the stock catalogue.
 *
 * Replaces plain <select> lists on the picking and consumption forms. Those
 * rendered every item the API returned, which was capped at 100 of 316, so
 * whole categories (optics, poles, services, stringing, tools) were simply
 * absent with no way to reach them. The cap is lifted separately; this makes
 * the resulting 300+ row list usable.
 *
 * Navigation logic is shared with the GRN purchase-order picker via
 * listboxNavigation — same keyboard contract, so the two behave identically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { isNavKey, nextActiveIndex } from '../../../grn/lib/listboxNavigation';
import { filterStockItems, itemSubtitle, type SearchableStockItem } from '../../lib/itemSearch';

interface Props {
  items: SearchableStockItem[];
  selectedItemId: string;
  onSelect: (itemId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Distinguishes the listbox ids when several pickers share a page. */
  instanceId: string;
}

export function StockItemPicker({
  items,
  selectedItemId,
  onSelect,
  disabled = false,
  placeholder = 'Select item…',
  instanceId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const listboxId = `stock-item-listbox-${instanceId}`;
  const optionDomId = useCallback((i: number) => `${listboxId}-option-${i}`, [listboxId]);

  const visible = useMemo(() => filterStockItems(items, query), [items, query]);
  const selected = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (itemId: string) => {
      onSelect(itemId);
      close();
    },
    [onSelect, close]
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => setActiveIndex(-1), [query]);

  useEffect(() => {
    const onDocPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [close]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isNavKey(e.key)) {
        e.preventDefault();
        setActiveIndex((current) => nextActiveIndex(current, e.key as never, visible.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = visible[activeIndex];
        if (item) choose(item.id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [visible, activeIndex, choose, close]
  );

  const label = selected ? `${selected.itemCode} - ${selected.name}` : placeholder;

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className="w-full flex items-center gap-2 rounded-lg border border-border bg-card py-2 px-3 text-left text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 dark:border-gray-600">
            <Search className="h-4 w-4 shrink-0 opacity-60" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, name or category…"
              aria-label="Search stock items"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>

          <div id={listboxId} role="listbox" className="max-h-64 overflow-auto">
            {visible.length === 0 ? (
              <div className="px-3 py-3 text-sm opacity-60">No item matches “{query}”</div>
            ) : (
              visible.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  id={optionDomId(index)}
                  role="option"
                  aria-selected={item.id === selectedItemId}
                  tabIndex={-1}
                  onClick={() => choose(item.id)}
                  className={`w-full border-b border-border px-3 py-2 text-left last:border-b-0 dark:border-gray-700 ${
                    index === activeIndex ? 'bg-blue-500/10' : 'hover:bg-blue-500/5'
                  }`}
                >
                  <div className="truncate text-sm">
                    {item.itemCode} - {item.name}
                  </div>
                  <div className="truncate text-[11px] opacity-60">{itemSubtitle(item)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
