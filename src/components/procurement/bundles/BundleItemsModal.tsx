/**
 * Bundle Items Modal
 * Modal for managing stock items within a bundle
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Plus,
  Trash2,
  Loader2,
  Package,
  Save,
  AlertCircle,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import type { StockBundleItem } from '@/types/procurement/bundle.types';

// Minimal bundle interface - only what the modal needs
interface BundleInfo {
  id: string;
  name: string;
  bundle_code: string;
}

interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  uom: string;
  standardCost: number | null;
  qtyAvailable: number;
}

interface BundleItemsModalProps {
  bundle: BundleInfo;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export function BundleItemsModal({
  bundle,
  isOpen,
  onClose,
  onSave,
}: BundleItemsModalProps) {
  const [items, setItems] = useState<StockBundleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<StockItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Fetch bundle items
  const fetchItems = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/procurement/bundles/${bundle.id}/items`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data || []);
      } else {
        notificationService.error(data.error?.message || 'Failed to load bundle items');
      }
    } catch (err) {
      log.error('Failed to fetch bundle items', err);
      notificationService.operationError('load', err as Error, 'bundle items');
    } finally {
      setIsLoading(false);
    }
  }, [bundle.id]);

  useEffect(() => {
    if (isOpen) {
      fetchItems();
    }
  }, [isOpen, fetchItems]);

  // Search stock items
  const searchStockItems = useCallback(async (term: string) => {
    if (!term || term.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);
      const res = await fetch(`/api/stock-items?search=${encodeURIComponent(term)}&limit=10`);
      const data = await res.json();

      // Filter out items already in bundle
      const existingIds = new Set(items.map(i => i.stock_item_id));
      const filtered = (data.data || []).filter((item: StockItem) => !existingIds.has(item.id));
      setSearchResults(filtered);
    } catch (err) {
      log.error('Failed to search stock items', err);
    } finally {
      setIsSearching(false);
    }
  }, [items]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchStockItems(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, searchStockItems]);

  // Add item to bundle
  const handleAddItem = async (stockItem: StockItem) => {
    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_item_id: stockItem.id,
          quantity: 1,
        }),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success(`Added ${stockItem.name}`);
        setSearchTerm('');
        setSearchResults([]);
        setShowSearch(false);
        fetchItems();
      } else {
        notificationService.error(data.error?.message || 'Failed to add item');
      }
    } catch (err) {
      log.error('Failed to add item to bundle', err);
      notificationService.operationError('add', err as Error, 'item');
    }
  };

  // Update item quantity
  const handleUpdateQuantity = async (item: StockBundleItem, newQty: number) => {
    if (newQty < 0) return;

    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      });
      const data = await res.json();

      if (data.success) {
        setItems(prev =>
          prev.map(i => (i.id === item.id ? { ...i, quantity: newQty } : i))
        );
      } else {
        notificationService.error(data.error?.message || 'Failed to update quantity');
      }
    } catch (err) {
      log.error('Failed to update item quantity', err);
      notificationService.operationError('update', err as Error, 'quantity');
    }
  };

  // Remove item from bundle
  const handleRemoveItem = async (item: StockBundleItem) => {
    if (!confirm(`Remove "${item.item_name}" from this bundle?`)) return;

    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}/items/${item.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        notificationService.operationSuccess('removed', 'Item');
        setItems(prev => prev.filter(i => i.id !== item.id));
      } else {
        notificationService.error(data.error?.message || 'Failed to remove item');
      }
    } catch (err) {
      log.error('Failed to remove item from bundle', err);
      notificationService.operationError('remove', err as Error, 'item');
    }
  };

  // Calculate bundle total
  const bundleTotal = items.reduce((sum, item) => {
    const cost = Number(item.effective_cost || item.item_cost || 0);
    return sum + cost * item.quantity;
  }, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-[var(--ff-border-default)] mx-4 sm:mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-default)]">
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-indigo-500" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {bundle.name}
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {bundle.bundle_code} - {items.length} items
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              <span className="ml-2 text-[var(--ff-text-secondary)]">Loading items...</span>
            </div>
          ) : (
            <>
              {/* Add Item Section */}
              <div className="mb-4">
                {showSearch ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search stock items by code or name..."
                        autoFocus
                        className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                      />
                      {isSearching && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[var(--ff-text-tertiary)]" />
                      )}
                    </div>

                    {/* Search Results */}
                    {searchResults.length > 0 && (
                      <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg max-h-48 overflow-y-auto">
                        {searchResults.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleAddItem(item)}
                            className="w-full px-3 py-2 text-left hover:bg-[var(--ff-bg-secondary)] transition-colors flex items-center justify-between"
                          >
                            <div>
                              <p className="font-medium text-[var(--ff-text-primary)]">
                                {item.itemCode}
                              </p>
                              <p className="text-sm text-[var(--ff-text-secondary)]">
                                {item.name} - {item.category}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-[var(--ff-text-primary)]">
                                R {Number(item.standardCost || 0).toFixed(2)}
                              </p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">
                                {item.qtyAvailable} {item.uom}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {searchTerm.length >= 2 && searchResults.length === 0 && !isSearching && (
                      <p className="text-sm text-[var(--ff-text-tertiary)] text-center py-2">
                        No items found matching "{searchTerm}"
                      </p>
                    )}

                    <button
                      onClick={() => {
                        setShowSearch(false);
                        setSearchTerm('');
                        setSearchResults([]);
                      }}
                      className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSearch(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Item
                  </button>
                )}
              </div>

              {/* Items List */}
              {items.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                  <p className="text-[var(--ff-text-secondary)]">No items in this bundle</p>
                  <p className="text-sm text-[var(--ff-text-tertiary)]">
                    Click "Add Item" to start building the bundle
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[var(--ff-text-primary)] truncate">
                            {item.item_code} - {item.item_name}
                          </p>
                          <p className="text-sm text-[var(--ff-text-secondary)]">
                            {item.item_category || 'No category'} - {item.effective_uom || item.uom || 'EA'}
                          </p>
                        </div>

                        <div className="flex items-center gap-4 ml-4">
                          {/* Quantity Controls */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdateQuantity(item, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              className="w-8 h-8 flex items-center justify-center rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                handleUpdateQuantity(item, parseInt(e.target.value) || 1)
                              }
                              min="1"
                              className="w-16 px-2 py-1 text-center bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded text-[var(--ff-text-primary)]"
                            />
                            <button
                              onClick={() => handleUpdateQuantity(item, item.quantity + 1)}
                              className="w-8 h-8 flex items-center justify-center rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)]"
                            >
                              +
                            </button>
                          </div>

                          {/* Cost */}
                          <div className="text-right w-24">
                            <p className="font-medium text-[var(--ff-text-primary)]">
                              R {(Number(item.effective_cost || item.item_cost || 0) * item.quantity).toFixed(2)}
                            </p>
                            <p className="text-xs text-[var(--ff-text-tertiary)]">
                              @ R {Number(item.effective_cost || item.item_cost || 0).toFixed(2)}
                            </p>
                          </div>

                          {/* Remove Button */}
                          <button
                            onClick={() => handleRemoveItem(item)}
                            className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                            title="Remove from bundle"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--ff-border-default)] bg-[var(--ff-bg-tertiary)]">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Bundle Total</p>
            <p className="text-xl font-bold text-[var(--ff-text-primary)]">
              R {bundleTotal.toFixed(2)}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Close
            </button>
            {onSave && (
              <button
                onClick={() => {
                  onSave();
                  onClose();
                }}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save & Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BundleItemsModal;
