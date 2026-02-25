/**
 * RequisitionItemsTable — items table sub-component for Step1Requirements.
 * Extracted to keep Step1Requirements under 300 lines.
 */

import { Plus, Trash2 } from 'lucide-react';
import { calcLineTotal, formatCurrency } from './requisitionUtils';
import { StockItemSearch } from '@/modules/procurement/components/StockItemSearch';

const UOM_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'meters', label: 'Meters' },
  { value: 'rolls', label: 'Rolls' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'sets', label: 'Sets' },
  { value: 'liters', label: 'Liters' },
  { value: 'kg', label: 'Kilograms' },
];

export interface FormItem {
  id: string;
  itemDescription: string;
  quantity: number | '';
  uom: string;
  estimatedUnitPrice: number | '';
}

export interface RequisitionItemsTableProps {
  items: FormItem[];
  fieldErrors: Record<string, string>;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: <K extends keyof FormItem>(index: number, field: K, value: FormItem[K]) => void;
  /** Called when a stock item is selected — atomically updates description + uom */
  onSelectStock: (index: number, patch: { itemDescription: string; uom: string }) => void;
}

/** Editable items table used in the requisition creation form. */
export function RequisitionItemsTable({
  items,
  fieldErrors,
  onAdd,
  onRemove,
  onUpdate,
  onSelectStock,
}: RequisitionItemsTableProps) {
  const estimatedTotal = items.reduce(
    (sum, item) => sum + calcLineTotal(item.quantity, item.estimatedUnitPrice),
    0,
  );

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-[var(--ff-text-primary)]">Items</h3>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {fieldErrors.items && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{fieldErrors.items}</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                Description *
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-24">
                Qty *
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                UOM *
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-32">
                Unit Price (ZAR)
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-32">
                Line Total
              </th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {items.map((item, index) => (
              <tr key={item.id} className="group">
                <td className="px-3 py-2">
                  <StockItemSearch
                    value={item.itemDescription}
                    onChange={(val) => onUpdate(index, 'itemDescription', val)}
                    onSelect={(stock) =>
                      onSelectStock(index, {
                        itemDescription: stock.name,
                        uom: stock.uom || 'units',
                      })
                    }
                    placeholder="Search stock or type description..."
                  />
                  {fieldErrors[`item_${index}_description`] && (
                    <p className="mt-1 text-xs text-red-400">{fieldErrors[`item_${index}_description`]}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      onUpdate(index, 'quantity', e.target.value === '' ? '' : Number(e.target.value))
                    }
                    placeholder="0"
                    min="0"
                    step="0.001"
                    className="w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  {fieldErrors[`item_${index}_quantity`] && (
                    <p className="mt-1 text-xs text-red-400">{fieldErrors[`item_${index}_quantity`]}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={item.uom}
                    onChange={(e) => onUpdate(index, 'uom', e.target.value)}
                    className="w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
                  >
                    {UOM_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ff-text-tertiary)]">
                      R
                    </span>
                    <input
                      type="number"
                      value={item.estimatedUnitPrice}
                      onChange={(e) =>
                        onUpdate(index, 'estimatedUnitPrice', e.target.value === '' ? '' : Number(e.target.value))
                      }
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="w-full pl-7 pr-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatCurrency(calcLineTotal(item.quantity, item.estimatedUnitPrice))}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Running estimated total */}
      <div className="mt-4 flex justify-end border-t border-[var(--ff-border-light)] pt-4">
        <div className="text-right">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Estimated Total</p>
          <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(estimatedTotal)}
          </p>
        </div>
      </div>
    </div>
  );
}
