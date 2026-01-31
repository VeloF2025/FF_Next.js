/**
 * Stock Item Mapper for BOQ Detail Page
 * Shows unmatched BOQ items and allows manual mapping to stock items.
 * Supports search, category filter, and optional supplier code saving.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Link2, CheckCircle, AlertCircle, Loader2,
  X, ChevronDown, Package, ArrowRight, Save,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';

interface BOQItem {
  id: string;
  itemCode: string;
  description: string;
  category: string;
  stockItemId: string | null;
  stockMatchMethod: string | null;
  stockMatchConfidence: number | null;
}

interface StockItem {
  id: string;
  item_code: string;
  name: string;
  description: string;
  category: string;
  uom: string;
}

interface StockItemMapperProps {
  boqId: string;
  items: BOQItem[];
  onMappingComplete?: () => void;
}

export default function StockItemMapper({ boqId, items, onMappingComplete }: StockItemMapperProps) {
  const unmatchedItems = items.filter(i => !i.stockItemId);
  const matchedItems = items.filter(i => i.stockItemId);

  const [selectedItem, setSelectedItem] = useState<BOQItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [saveAsSupplierMapping, setSaveAsSupplierMapping] = useState(true);

  // Load categories on mount
  useEffect(() => {
    fetchStockItems('');
  }, []);

  const fetchStockItems = useCallback(async (query: string, category?: string) => {
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      params.set('limit', '30');

      const res = await fetch(`/api/procurement/stock-items-search?${params}`);
      const data = await res.json();

      if (data.data) {
        setSearchResults(data.data.items || []);
        if (data.data.categories?.length > 0) {
          setCategories(data.data.categories);
        }
      }
    } catch {
      notificationService.error('Failed to search stock items');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedItem) {
        fetchStockItems(searchQuery || selectedItem.description, selectedCategory || undefined);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, selectedItem, fetchStockItems]);

  const handleSelectItem = (boqItem: BOQItem) => {
    setSelectedItem(boqItem);
    setSearchQuery('');
    // Pre-search using the BOQ item's description keywords
    fetchStockItems(boqItem.description, undefined);
  };

  const handleMapItem = async (stockItem: StockItem) => {
    if (!selectedItem) return;
    setIsMapping(true);

    try {
      const res = await fetch('/api/procurement/boq/map-stock-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boqItemId: selectedItem.id,
          stockItemId: stockItem.id,
          saveAsSupplierMapping: saveAsSupplierMapping && selectedItem.itemCode,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        notificationService.success(
          `Mapped "${selectedItem.description.substring(0, 40)}..." → ${stockItem.item_code}`
        );
        setSelectedItem(null);
        onMappingComplete?.();
      } else {
        notificationService.error(data.error?.message || 'Mapping failed');
      }
    } catch {
      notificationService.error('Failed to map stock item');
    } finally {
      setIsMapping(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Stock Item Mapping
          </h3>
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {matchedItems.length}/{items.length} mapped
          </span>
        </div>
        {unmatchedItems.length > 0 && (
          <span className="bg-orange-500/20 text-orange-400 text-xs font-medium px-2.5 py-1 rounded-full">
            {unmatchedItems.length} unmatched
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-6 pt-3">
        <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${items.length > 0 ? (matchedItems.length / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {unmatchedItems.length === 0 ? (
        <div className="px-6 py-6 text-center">
          <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-[var(--ff-text-primary)] font-medium">All items mapped</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {matchedItems.length} items are linked to stock items
          </p>
        </div>
      ) : (
        <div className="p-6">
          {!selectedItem ? (
            /* Unmatched items list */
            <div className="space-y-2">
              <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
                Click an item to find and link a matching stock item:
              </p>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {unmatchedItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-[var(--ff-border-light)] hover:border-blue-500/50 hover:bg-[var(--ff-bg-hover)] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {item.itemCode && (
                            <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                              {item.itemCode}
                            </span>
                          )}
                          {item.category && (
                            <span className="text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded">
                              {item.category}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--ff-text-primary)] mt-1 truncate">
                          {item.description}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[var(--ff-text-secondary)] flex-shrink-0 ml-2" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Stock item search/select panel */
            <div className="space-y-4">
              {/* Selected BOQ item header */}
              <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-blue-400 font-medium">Mapping BOQ Item:</p>
                  <p className="text-sm text-[var(--ff-text-primary)] truncate mt-0.5">
                    {selectedItem.itemCode && (
                      <span className="font-mono mr-2">{selectedItem.itemCode}</span>
                    )}
                    {selectedItem.description}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] ml-2"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search controls */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-secondary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search stock items by code, name, or description..."
                    className="w-full pl-9 pr-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-secondary)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-blue-500"
                >
                  <option value="">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Save as supplier mapping toggle */}
              {selectedItem.itemCode && (
                <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsSupplierMapping}
                    onChange={e => setSaveAsSupplierMapping(e.target.checked)}
                    className="rounded border-gray-500 bg-transparent text-blue-500 focus:ring-blue-500"
                  />
                  <Save className="h-3.5 w-3.5" />
                  Remember this mapping for future imports (supplier code: {selectedItem.itemCode})
                </label>
              )}

              {/* Search results */}
              <div className="max-h-[250px] overflow-y-auto border border-[var(--ff-border-light)] rounded-lg">
                {isSearching ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Searching...</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <AlertCircle className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                    <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">No stock items found</span>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {searchResults.map(si => (
                      <button
                        key={si.id}
                        onClick={() => handleMapItem(si)}
                        disabled={isMapping}
                        className="w-full text-left px-4 py-3 hover:bg-[var(--ff-bg-hover)] transition-colors disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Package className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                              <span className="font-mono text-sm text-[var(--ff-text-primary)]">
                                {si.item_code}
                              </span>
                              {si.category && (
                                <span className="text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded">
                                  {si.category}
                                </span>
                              )}
                            </div>
                            {si.name !== si.item_code && (
                              <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5 truncate">{si.name}</p>
                            )}
                            {si.description && (
                              <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5 truncate">{si.description}</p>
                            )}
                          </div>
                          <span className="text-xs text-blue-400 font-medium flex-shrink-0 ml-2">
                            Select
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
