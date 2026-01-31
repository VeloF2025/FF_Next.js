/**
 * Supplier Code Mapper for RFQ Detail Page
 * Allows mapping supplier item codes from quotes to internal stock items.
 * These mappings persist and auto-match in future BOQ imports.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Link2, CheckCircle, Loader2, Package,
  ArrowRight, AlertCircle,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';

interface RFQItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  supplierItemCode?: string;
}

interface StockItem {
  id: string;
  item_code: string;
  name: string;
  description: string;
  category: string;
}

interface SupplierCodeMapperProps {
  rfqItems: RFQItem[];
  supplierId?: string | number;
  supplierName?: string;
}

export default function SupplierCodeMapper({
  rfqItems,
  supplierId,
  supplierName,
}: SupplierCodeMapperProps) {
  const [selectedItemIdx, setSelectedItemIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [mappedItems, setMappedItems] = useState<Map<string, StockItem>>(new Map());

  const fetchStockItems = useCallback(async (query: string) => {
    if (!query || query.length < 2) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/procurement/stock-items-search?q=${encodeURIComponent(query)}&limit=20`);
      const data = await res.json();
      if (data.data?.items) {
        setSearchResults(data.data.items);
      }
    } catch {
      // Fail silently for search
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        fetchStockItems(searchQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchStockItems]);

  const handleSelectItem = (idx: number) => {
    setSelectedItemIdx(idx);
    setSearchQuery('');
    // Pre-search with the item description
    const item = rfqItems[idx];
    fetchStockItems(item.description);
  };

  const handleMapToStock = async (rfqItem: RFQItem, stockItem: StockItem) => {
    setIsMapping(true);
    try {
      const supplierCode = rfqItem.supplierItemCode || rfqItem.description.substring(0, 50);

      const res = await fetch('/api/procurement/supplier-item-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: supplierId ? Number(supplierId) : null,
          supplierItemCode: supplierCode,
          supplierItemName: rfqItem.description,
          stockItemId: stockItem.id,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMappedItems(prev => {
          const updated = new Map(prev);
          updated.set(rfqItem.id, stockItem);
          return updated;
        });
        setSelectedItemIdx(null);
        notificationService.success(
          `Mapped "${supplierCode}" → ${stockItem.item_code}`
        );
      } else {
        notificationService.error(data.error?.message || 'Mapping failed');
      }
    } catch {
      notificationService.error('Failed to save mapping');
    } finally {
      setIsMapping(false);
    }
  };

  if (rfqItems.length === 0) return null;

  const selectedItem = selectedItemIdx !== null ? rfqItems[selectedItemIdx] : null;

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)] flex items-center gap-2">
        <Link2 className="h-4 w-4 text-blue-400" />
        <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">
          Map Supplier Codes to Stock Items
        </h4>
        {supplierName && (
          <span className="text-xs text-[var(--ff-text-secondary)]">({supplierName})</span>
        )}
        <span className="ml-auto text-xs text-[var(--ff-text-secondary)]">
          {mappedItems.size}/{rfqItems.length} mapped
        </span>
      </div>

      <div className="p-4">
        {selectedItem === null ? (
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {rfqItems.map((item, idx) => {
              const isMapped = mappedItems.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => !isMapped && handleSelectItem(idx)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isMapped
                      ? 'bg-green-500/5 cursor-default'
                      : 'hover:bg-[var(--ff-bg-hover)] cursor-pointer'
                  }`}
                >
                  {isMapped ? (
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <Package className="h-4 w-4 text-[var(--ff-text-secondary)] flex-shrink-0" />
                  )}
                  <span className="text-[var(--ff-text-primary)] truncate flex-1">{item.description}</span>
                  {isMapped && (
                    <span className="text-xs font-mono text-green-400">
                      → {mappedItems.get(item.id)?.item_code}
                    </span>
                  )}
                  {!isMapped && (
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--ff-text-secondary)] flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Selected item */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--ff-text-secondary)]">Mapping:</span>
              <span className="text-[var(--ff-text-primary)] font-medium truncate">
                {selectedItem.description}
              </span>
              <button
                onClick={() => setSelectedItemIdx(null)}
                className="text-xs text-blue-400 hover:underline ml-auto flex-shrink-0"
              >
                Cancel
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search stock items..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-secondary)] focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="max-h-[180px] overflow-y-auto border border-[var(--ff-border-light)] rounded-lg">
              {isSearching ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex items-center justify-center py-6 gap-2">
                  <AlertCircle className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                  <span className="text-sm text-[var(--ff-text-secondary)]">No results</span>
                </div>
              ) : (
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {searchResults.map(si => (
                    <button
                      key={si.id}
                      onClick={() => handleMapToStock(selectedItem, si)}
                      disabled={isMapping}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--ff-bg-hover)] text-sm disabled:opacity-50"
                    >
                      <span className="font-mono text-[var(--ff-text-primary)]">{si.item_code}</span>
                      {si.category && (
                        <span className="ml-2 text-xs text-[var(--ff-text-secondary)]">{si.category}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
