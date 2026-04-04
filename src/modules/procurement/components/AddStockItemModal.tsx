/**
 * AddStockItemModal — inline modal to add a new item to the stock catalog.
 * Shown by StockItemSearch when no matching items are found.
 */

import { useState, useEffect } from 'react';
import { X, Loader2, PackagePlus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';

const UOM_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'meters', label: 'Meters' },
  { value: 'rolls', label: 'Rolls' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'sets', label: 'Sets' },
  { value: 'liters', label: 'Liters' },
  { value: 'kg', label: 'Kilograms' },
  { value: 'unit', label: 'Unit (each)' },
];

export interface NewStockItem {
  id: string;
  item_code: string;
  name: string;
  description: string | null;
  category: string;
  uom: string;
}

interface AddStockItemModalProps {
  initialName: string;
  onClose: () => void;
  onCreated: (item: NewStockItem) => void;
}

export function AddStockItemModal({ initialName, onClose, onCreated }: AddStockItemModalProps) {
  const [name, setName] = useState(initialName);
  const [uom, setUom] = useState('units');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/procurement/stock-categories')
      .then((r) => r.json())
      .then((json: { success: boolean; data?: { categories: string[] } }) => {
        if (json.success && json.data?.categories) setCategories(json.data.categories);
      })
      .catch((err) => log.error('Failed to load categories', { error: err }, 'AddStockItemModal'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/procurement/stock-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), uom, category: category.trim() || 'uncategorized', description: description.trim() || undefined }),
      });
      const json = await res.json() as { success: boolean; data?: { item: NewStockItem }; error?: { message: string } };
      if (json.success && json.data?.item) {
        onCreated(json.data.item);
      } else {
        setError(json.error?.message ?? 'Failed to add item');
      }
    } catch (err) {
      log.error('Failed to create stock item', { error: err }, 'AddStockItemModal');
      setError('An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-purple-400" />
            <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">Add to Stock Catalog</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
          This item will be added to the stock catalog so it can be reused in future requisitions.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Item Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">UOM <span className="text-red-400">*</span></label>
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                {UOM_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Description <span className="text-xs text-[var(--ff-text-tertiary)]">(optional)</span></label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="Brief description..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              Add to Catalog
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
