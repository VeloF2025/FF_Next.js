/**
 * Stock Item Selector Component
 * Allows selecting from existing stock items or creating new ones
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, Package, Loader2, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface StockItem {
  id: string;
  item_code: string;
  name: string;
  description: string;
  category: string;
  uom: string;
  standard_cost: number;
  list_price: number;
}

interface StockItemSelectorProps {
  onSelect: (item: {
    stockItemId: string;
    description: string;
    unit: string;
    estimatedUnitPrice: number;
  }) => void;
  onCreateNew?: (item: {
    description: string;
    unit: string;
    estimatedUnitPrice: number;
  }) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function StockItemSelector({
  onSelect,
  onCreateNew,
  isOpen,
  onClose,
}: StockItemSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // New item form state
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('EA');
  const [newItemPrice, setNewItemPrice] = useState(0);
  const [newItemCode, setNewItemCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const searchStockItems = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setStockItems([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/stock-items?search=${encodeURIComponent(query)}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setStockItems(data.data || data.items || []);
      }
    } catch (error) {
      log.error('Failed to search stock items', { data: error }, 'StockItemSelector');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        searchStockItems(searchQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchStockItems]);

  // Load initial items on open
  useEffect(() => {
    if (isOpen) {
      searchStockItems('*'); // Load some items initially
    }
  }, [isOpen, searchStockItems]);

  const handleSelect = (item: StockItem) => {
    onSelect({
      stockItemId: item.id,
      description: item.name || item.description,
      unit: item.uom || 'EA',
      estimatedUnitPrice: item.list_price || item.standard_cost || 0,
    });
    onClose();
  };

  const handleCreateNew = async () => {
    if (!newItemDescription.trim()) {
      toast.error('Please enter a description');
      return;
    }

    setIsCreating(true);
    try {
      // Create new stock item
      const response = await fetch('/api/stock-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newItemDescription,
          description: newItemDescription,
          item_code: newItemCode || `STK-${Date.now().toString().slice(-6)}`,
          uom: newItemUnit,
          standard_cost: newItemPrice,
          list_price: newItemPrice,
          category: 'Materials',
          is_active: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newItem = data.data || data;

        toast.success('Stock item created');
        onSelect({
          stockItemId: newItem.id,
          description: newItemDescription,
          unit: newItemUnit,
          estimatedUnitPrice: newItemPrice,
        });
        onClose();
      } else {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create stock item');
      }
    } catch (error) {
      log.error('Failed to create stock item', { data: error }, 'StockItemSelector');
      toast.error(error instanceof Error ? error.message : 'Failed to create stock item');

      // Still allow using the item without linking to stock
      if (onCreateNew) {
        onCreateNew({
          description: newItemDescription,
          unit: newItemUnit,
          estimatedUnitPrice: newItemPrice,
        });
        onClose();
      }
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  // Use portal to render outside of AppLayout's overflow-hidden container
  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center">
            <Package className="h-5 w-5 mr-2 text-[var(--ff-text-secondary)]" />
            {showCreateForm ? 'Create New Stock Item' : 'Select Stock Item'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {showCreateForm ? (
          /* Create New Form */
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Item Code
              </label>
              <input
                type="text"
                value={newItemCode}
                onChange={(e) => setNewItemCode(e.target.value)}
                placeholder="e.g., FBR-001 (auto-generated if empty)"
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                placeholder="e.g., Fiber Optic Cable 12-Core"
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Unit of Measure
                </label>
                <select
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                >
                  <option value="EA">Each (EA)</option>
                  <option value="M">Meter (M)</option>
                  <option value="KM">Kilometer (KM)</option>
                  <option value="KG">Kilogram (KG)</option>
                  <option value="L">Liter (L)</option>
                  <option value="SET">Set</option>
                  <option value="BOX">Box</option>
                  <option value="ROLL">Roll</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Standard Price (R)
                </label>
                <input
                  type="number"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(Number(e.target.value))}
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(false)}
                className="flex-1"
              >
                Back to Search
              </Button>
              <Button
                onClick={handleCreateNew}
                disabled={isCreating || !newItemDescription.trim()}
                className="flex-1"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create & Use
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="p-4 border-b border-[var(--ff-border-light)]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search stock items by name or code..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                  autoFocus
                />
              </div>
              <p className="mt-2 text-xs text-[var(--ff-text-secondary)]">
                Type at least 2 characters to search, or create a new item below
              </p>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Searching...
                </div>
              ) : stockItems.length > 0 ? (
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {stockItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="w-full p-4 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-[var(--ff-text-tertiary)]">
                              {item.item_code}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 bg-[var(--ff-bg-tertiary)] rounded text-[var(--ff-text-secondary)]">
                              {item.uom}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-[var(--ff-text-primary)] mt-1">
                            {item.name || item.description}
                          </p>
                          {item.category && (
                            <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                              {item.category}
                            </p>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-sm font-semibold text-[var(--ff-text-primary)]">
                            R {(item.list_price || item.standard_cost || 0).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : searchQuery.length >= 2 ? (
                <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                  <Package className="h-10 w-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
                  <p>No items found matching &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                  <Search className="h-10 w-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
                  <p>Start typing to search stock items</p>
                </div>
              )}
            </div>

            {/* Create New Button */}
            <div className="p-4 border-t border-[var(--ff-border-light)]">
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(true)}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Stock Item
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Render to document body via portal to escape AppLayout's overflow-hidden
  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
