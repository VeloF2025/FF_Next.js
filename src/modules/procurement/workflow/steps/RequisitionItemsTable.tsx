/**
 * RequisitionItemsTable — items table sub-component for Step1Requirements.
 * Extracted to keep Step1Requirements under 300 lines.
 * Supports BOQ/ad-hoc toggle per row when a project with a BOQ is selected.
 */

import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { calcLineTotal, calcVat, formatCurrency, VAT_RATE } from './requisitionUtils';
import { StockItemSearch } from '@/modules/procurement/components/StockItemSearch';
import { BOQLinePicker } from './BOQLinePicker';
import type { BOQLineUtilization } from '@/types/procurement/boq-utilization.types';

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
  itemType: 'boq' | 'adhoc';     // default 'adhoc'
  boqItemId?: string;             // set when itemType='boq'
  itemDescription: string;
  itemCode?: string;
  quantity: number | '';
  uom: string;
  estimatedUnitPrice: number | '';
}

export interface RequisitionItemsTableProps {
  items: FormItem[];
  fieldErrors: Record<string, string>;
  boqLines: BOQLineUtilization[];   // empty if project has no BOQ
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: <K extends keyof FormItem>(index: number, field: K, value: FormItem[K]) => void;
  /** Called when a stock item is selected — atomically updates description + uom */
  onSelectStock: (index: number, patch: { itemDescription: string; uom: string }) => void;
  /** Called when a BOQ line is selected — atomically updates all BOQ-derived fields */
  onSelectBOQ: (
    index: number,
    patch: { boqItemId: string; itemDescription: string; itemCode: string; uom: string; quantity: number | '' }
  ) => void;
  /** Called when BOQ picker is cleared */
  onClearBOQ: (index: number) => void;
}

/** Editable items table used in the requisition creation form. */
export function RequisitionItemsTable({
  items,
  fieldErrors,
  boqLines,
  onAdd,
  onRemove,
  onUpdate,
  onSelectStock,
  onSelectBOQ,
  onClearBOQ,
}: RequisitionItemsTableProps) {
  const hasBOQ = boqLines.length > 0;

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
              {hasBOQ && (
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-24">
                  Type
                </th>
              )}
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
                Unit Price (excl.)
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
                {/* BOQ / Ad-hoc toggle — only shown when project has a BOQ */}
                {hasBOQ && (
                  <td className="px-3 py-2 align-top pt-3">
                    <div className="flex rounded-md overflow-hidden border border-[var(--ff-border-light)] text-xs">
                      <button
                        type="button"
                        onClick={() => onUpdate(index, 'itemType', 'boq')}
                        className={`px-2 py-1 transition-colors ${
                          item.itemType === 'boq'
                            ? 'bg-purple-600 text-white'
                            : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-hover)]'
                        }`}
                      >
                        BOQ
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdate(index, 'itemType', 'adhoc')}
                        className={`px-2 py-1 transition-colors ${
                          item.itemType === 'adhoc'
                            ? 'bg-amber-600 text-white'
                            : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-hover)]'
                        }`}
                      >
                        Ad-hoc
                      </button>
                    </div>
                  </td>
                )}

                {/* Description / BOQ Picker */}
                <td className="px-3 py-2">
                  {item.itemType === 'boq' && hasBOQ ? (
                    <BOQLinePicker
                      boqLines={boqLines}
                      selectedId={item.boqItemId}
                      onSelect={(line) =>
                        onSelectBOQ(index, {
                          boqItemId: line.id,
                          itemDescription: line.description,
                          itemCode: line.itemCode ?? '',
                          uom: line.uom,
                          quantity: line.outstandingQty > 0 ? line.outstandingQty : '',
                        })
                      }
                      onClear={() => onClearBOQ(index)}
                    />
                  ) : (
                    <>
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
                      {/* Subtle warning when project has BOQ but item is ad-hoc */}
                      {hasBOQ && item.itemDescription.trim().length > 0 && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-amber-500/70">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>Ad-hoc — not in BOQ</span>
                        </div>
                      )}
                    </>
                  )}
                  {fieldErrors[`item_${index}_description`] && (
                    <p className="mt-1 text-xs text-red-400">{fieldErrors[`item_${index}_description`]}</p>
                  )}
                </td>

                {/* Quantity */}
                <td className="px-3 py-2 align-top pt-3">
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

                {/* UOM */}
                <td className="px-3 py-2 align-top pt-3">
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
                    {/* Include BOQ uom if not in standard list */}
                    {item.uom && !UOM_OPTIONS.find((o) => o.value === item.uom) && (
                      <option value={item.uom}>{item.uom}</option>
                    )}
                  </select>
                </td>

                {/* Unit Price */}
                <td className="px-3 py-2 align-top pt-3">
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

                {/* Line Total */}
                <td className="px-3 py-2 text-right align-top pt-3">
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatCurrency(calcLineTotal(item.quantity, item.estimatedUnitPrice))}
                  </span>
                </td>

                {/* Remove */}
                <td className="px-3 py-2 align-top pt-2">
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

      {/* Running estimated total with VAT breakdown */}
      <div className="mt-4 flex justify-end border-t border-[var(--ff-border-light)] pt-4">
        <div className="text-right space-y-1">
          <div className="flex justify-between gap-8">
            <span className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Subtotal (excl. VAT)</span>
            <span className="text-sm text-[var(--ff-text-secondary)]">{formatCurrency(estimatedTotal)}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">VAT ({VAT_RATE}%)</span>
            <span className="text-sm text-[var(--ff-text-secondary)]">{formatCurrency(calcVat(estimatedTotal))}</span>
          </div>
          <div className="flex justify-between gap-8 border-t border-[var(--ff-border-light)] pt-1">
            <span className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide font-medium">Total (incl. VAT)</span>
            <span className="text-2xl font-semibold text-[var(--ff-text-primary)]">
              {formatCurrency(estimatedTotal + calcVat(estimatedTotal))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
