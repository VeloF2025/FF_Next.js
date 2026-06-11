'use client';

/**
 * PickItemStep — step 2 of the stores issue flow.
 *
 * Shows context ("Issuing to: <tech name>"), a search input, and a list
 * of ALL issuable stock items (serial, lot, quantity) with a tracking badge.
 * Serial items route to the scanner step; all others route to the quantity step.
 *
 * Endpoint: GET /api/my/stores/items[?search=…]
 * via fetchIssuableStockItems() in api.ts.
 */

import { useState, useEffect, useCallback } from 'react';
import { Search, Package, ChevronRight } from 'lucide-react';
import { fetchIssuableStockItems } from '@/modules/field-stock-pwa/api';
import type { PwaTrackingType } from '@/modules/field-stock-pwa/api';
import type { PwaTechSummary } from '@/modules/field-stock-pwa/types';

// =============================================================================
// Types
// =============================================================================

export interface StockItem {
  id: string;
  name: string;
  sku: string | null;
  trackingType: PwaTrackingType;
  /** Unit of measure, e.g. 'Units', 'Meters' — shown in the quantity step. */
  uom: string | null;
  /**
   * Per-unit value in ZAR (from stock_items.standard_cost).
   * Null means the item has no recorded valuation — the R5k cap guard in
   * SignAndSubmitStep will warn but will not hard-block the submit; the
   * server enforces the cap independently (Task 2.6).
   */
  unitValueZar: number | null;
}

export interface PickItemStepProps {
  /** Issued-to technician — displayed as context in the header badge. */
  technician: PwaTechSummary;
  /** Called when the user taps a stock item row. */
  onPick: (item: StockItem) => void;
}

// =============================================================================
// Loading skeleton
// =============================================================================

function ItemSkeleton() {
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
      {[1, 2, 3].map((n) => (
        <li key={n} className="px-4 py-3 animate-pulse flex justify-between items-center">
          <div className="space-y-1.5">
            <div className="h-4 w-40 bg-neutral-800 rounded" />
            <div className="h-3 w-24 bg-neutral-800 rounded" />
          </div>
          <div className="h-4 w-4 bg-neutral-800 rounded" />
        </li>
      ))}
    </ul>
  );
}

// =============================================================================
// Component
// =============================================================================

export function PickItemStep({ technician, onPick }: PickItemStepProps) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (searchTerm: string) => {
      setLoading(true);
      setError(null);
      try {
        const results = await fetchIssuableStockItems(
          searchTerm ? { search: searchTerm } : {}
        );
        setItems(results);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load stock items. Check your connection.'
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial load + debounced reload on search change
  useEffect(() => {
    const timer = setTimeout(() => {
      load(search);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <div className="space-y-3">
      {/* Context badge */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <span className="text-xs text-neutral-400">Issuing to:</span>
        <span className="text-sm font-medium text-white">{technician.name}</span>
        {technician.accountStatus === 'pending' && (
          <span className="ml-auto text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5">
            Pending
          </span>
        )}
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
        <input
          autoFocus
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stock items…"
          className="w-full pl-9 pr-4 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500"
        />
      </div>

      {/* List */}
      {loading ? (
        <ItemSkeleton />
      ) : error ? (
        <div className="px-4 py-6 text-center text-red-400 text-sm rounded-lg bg-neutral-950 border border-neutral-800">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 flex flex-col items-center gap-2 text-neutral-500 text-sm rounded-lg bg-neutral-950 border border-neutral-800">
          <Package className="w-8 h-8 opacity-40" />
          <span>{search ? 'No items match your search.' : 'No issuable items found.'}</span>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
          {items.map((item) => (
            <li
              key={item.id}
              onClick={() => onPick(item)}
              className="px-4 py-3 hover:bg-neutral-900 active:bg-neutral-800 cursor-pointer flex justify-between items-center"
            >
              <div>
                <div className="text-white text-sm font-medium">{item.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {item.sku ?? <span className="text-neutral-600">No SKU</span>}
                </div>
                <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 mt-1 inline-block ${
                  item.trackingType === 'serial'
                    ? 'bg-sky-950 text-sky-300'
                    : 'bg-amber-950 text-amber-300'
                }`}>
                  {item.trackingType === 'serial' ? 'Serial' : 'Qty'}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-600 flex-shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
