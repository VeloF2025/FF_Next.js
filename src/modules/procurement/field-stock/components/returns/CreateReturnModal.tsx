/**
 * CreateReturnModal Component
 * Modal for creating stock returns
 */

'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Package } from 'lucide-react';
import type {
  StockLocation,
  StockItem,
  CreateReturnDTO,
  ReturnReason,
  SerialCondition
} from '../../types';

interface CreateReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateReturnDTO) => Promise<void>;
  locations: StockLocation[];
  stockItems: StockItem[];
}

interface ReturnLineForm {
  stockItemId: string;
  serialNumber?: string;
  quantity: number;
  condition: SerialCondition;
  returnReason: ReturnReason;
  notes?: string;
}

const RETURN_REASONS: { value: ReturnReason; label: string }[] = [
  { value: 'unused', label: 'Unused' },
  { value: 'excess', label: 'Excess stock' },
  { value: 'job_cancelled', label: 'Job cancelled' },
  { value: 'wrong_item', label: 'Wrong item issued' },
  { value: 'faulty', label: 'Faulty/Defective' },
  { value: 'customer_refused', label: 'Customer refused' }
];

const CONDITIONS: { value: SerialCondition; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'non_functional', label: 'Non-functional' }
];

export function CreateReturnModal({
  isOpen,
  onClose,
  onSubmit,
  locations,
  stockItems
}: CreateReturnModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [returnedByName, setReturnedByName] = useState('');
  const [returnToLocationId, setReturnToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ReturnLineForm[]>([
    { stockItemId: '', quantity: 1, condition: 'good', returnReason: 'unused' }
  ]);

  const warehouseLocations = locations.filter(
    loc => loc.locationType === 'warehouse' || loc.locationType === 'site_store'
  );

  const handleAddLine = () => {
    setLines(prev => [
      ...prev,
      { stockItemId: '', quantity: 1, condition: 'good', returnReason: 'unused' }
    ]);
  };

  const handleRemoveLine = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleLineChange = (
    index: number,
    field: keyof ReturnLineForm,
    value: string | number
  ) => {
    setLines(prev =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnToLocationId || lines.length === 0) return;

    setSubmitting(true);
    try {
      await onSubmit({
        returnedByName,
        returnToLocationId,
        notes,
        lines: lines.map(line => ({
          stockItemId: line.stockItemId,
          serialNumber: line.serialNumber,
          quantity: line.quantity,
          condition: line.condition,
          returnReason: line.returnReason,
          notes: line.notes
        }))
      });
      onClose();
    } catch (error) {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-border p-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-foreground">
            Create Stock Return
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-secondary hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Basic Info */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">
                Returned By
              </label>
              <input
                type="text"
                value={returnedByName}
                onChange={(e) => setReturnedByName(e.target.value)}
                placeholder="Name of person returning..."
                className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">
                Return To Location <span className="text-red-500">*</span>
              </label>
              <select
                value={returnToLocationId}
                onChange={(e) => setReturnToLocationId(e.target.value)}
                required
                className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Select location...</option>
                {warehouseLocations.map(loc => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Return Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-muted-foreground">
                Items to Return
              </label>
              <button
                type="button"
                onClick={handleAddLine}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-background p-3 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <div className="flex items-start gap-3">
                    <Package className="mt-2 h-5 w-5 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Item
                        </label>
                        <select
                          value={line.stockItemId}
                          onChange={(e) => handleLineChange(index, 'stockItemId', e.target.value)}
                          required
                          className="w-full rounded border border-border bg-card py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">Select item...</option>
                          {stockItems.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.itemCode})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Serial # (optional)
                        </label>
                        <input
                          type="text"
                          value={line.serialNumber || ''}
                          onChange={(e) => handleLineChange(index, 'serialNumber', e.target.value)}
                          placeholder="Serial number..."
                          className="w-full rounded border border-border bg-card py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Quantity
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => handleLineChange(index, 'quantity', Number(e.target.value))}
                          className="w-full rounded border border-border bg-card py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Condition
                        </label>
                        <select
                          value={line.condition}
                          onChange={(e) => handleLineChange(index, 'condition', e.target.value)}
                          className="w-full rounded border border-border bg-card py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        >
                          {CONDITIONS.map(c => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Reason for Return
                        </label>
                        <select
                          value={line.returnReason}
                          onChange={(e) => handleLineChange(index, 'returnReason', e.target.value)}
                          className="w-full rounded border border-border bg-card py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        >
                          {RETURN_REASONS.map(r => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(index)}
                        className="mt-2 rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !returnToLocationId || lines.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
