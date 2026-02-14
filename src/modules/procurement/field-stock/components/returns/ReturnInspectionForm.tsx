/**
 * ReturnInspectionForm Component
 * Form for inspecting return items and setting dispositions
 */

'use client';

import { useState } from 'react';
import { X, Package, CheckCircle2, AlertCircle, Wrench, Trash2 } from 'lucide-react';
import type {
  StockReturn,
  StockReturnLine,
  SerialCondition,
  Disposition,
  ReturnLineDisposition
} from '../../types';

interface ReturnInspectionFormProps {
  returnItem: StockReturn;
  onSubmit: (
    inspectedBy: string,
    notes: string,
    lineDispositions: Record<string, ReturnLineDisposition>
  ) => Promise<void>;
  onCancel: () => void;
}

const CONDITIONS: { value: SerialCondition; label: string; color: string }[] = [
  { value: 'new', label: 'New', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'good', label: 'Good', color: 'bg-green-100 text-green-800' },
  { value: 'fair', label: 'Fair', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'poor', label: 'Poor', color: 'bg-orange-100 text-orange-800' },
  { value: 'damaged', label: 'Damaged', color: 'bg-red-100 text-red-800' },
  { value: 'non_functional', label: 'Non-functional', color: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200' }
];

const DISPOSITIONS: { value: Disposition; label: string; icon: typeof CheckCircle2 }[] = [
  { value: 'restock', label: 'Restock', icon: CheckCircle2 },
  { value: 'repair', label: 'Send for Repair', icon: Wrench },
  { value: 'scrap', label: 'Scrap', icon: Trash2 },
  { value: 'supplier_return', label: 'Return to Supplier', icon: AlertCircle }
];

export function ReturnInspectionForm({
  returnItem,
  onSubmit,
  onCancel
}: ReturnInspectionFormProps) {
  const [inspectedBy, setInspectedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [lineDispositions, setLineDispositions] = useState<Record<string, ReturnLineDisposition>>(
    () => {
      const initial: Record<string, ReturnLineDisposition> = {};
      const lines = returnItem.lines || [];
      for (const line of lines) {
        initial[line.id] = {
          condition: line.condition || 'good',
          disposition: 'restock'
        };
      }
      return initial;
    }
  );
  const [submitting, setSubmitting] = useState(false);

  const handleLineChange = (
    lineId: string,
    field: keyof ReturnLineDisposition,
    value: string
  ) => {
    setLineDispositions(prev => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        [field]: value
      }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedBy.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit(inspectedBy.trim(), notes, lineDispositions);
    } finally {
      setSubmitting(false);
    }
  };

  const lines = returnItem.lines || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Inspect Return
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {returnItem.returnNumber}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:bg-gray-800 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Inspector Info */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Inspector Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={inspectedBy}
              onChange={(e) => setInspectedBy(e.target.value)}
              placeholder="Enter your name..."
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Line Inspections */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Item Inspections
            </label>
            <div className="space-y-3">
              {lines.map((line) => {
                const lineData = lineDispositions[line.id] || {
                  condition: 'good',
                  disposition: 'restock'
                };

                return (
                  <div
                    key={line.id}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 dark:border-gray-700 dark:bg-gray-800/50"
                  >
                    <div className="flex items-start gap-3">
                      <Package className="mt-1 h-5 w-5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {line.stockItem?.name || `Item ${line.stockItemId.slice(0, 8)}`}
                          </span>
                          {line.serialNumber && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              S/N: {line.serialNumber}
                            </span>
                          )}
                          <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                            Qty: {line.quantity}
                          </span>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                              Inspected Condition
                            </label>
                            <select
                              value={lineData.condition}
                              onChange={(e) =>
                                handleLineChange(line.id, 'condition', e.target.value)
                              }
                              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            >
                              {CONDITIONS.map(c => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                              Disposition
                            </label>
                            <select
                              value={lineData.disposition}
                              onChange={(e) =>
                                handleLineChange(line.id, 'disposition', e.target.value)
                              }
                              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            >
                              {DISPOSITIONS.map(d => (
                                <option key={d.value} value={d.value}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                              Notes (optional)
                            </label>
                            <input
                              type="text"
                              value={lineData.notes || ''}
                              onChange={(e) =>
                                handleLineChange(line.id, 'notes', e.target.value)
                              }
                              placeholder="Inspection notes..."
                              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overall Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Inspection Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Overall inspection notes..."
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !inspectedBy.trim()}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Complete Inspection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
