import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/** Single line item in the BOQ form */
export interface BOQLineItemRow {
  lineNumber: number;
  itemCode: string;
  description: string;
  category: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  totalPrice: number;
}

const UOM_OPTIONS = ['EA', 'M', 'KM', 'ROLL', 'SET', 'BOX'] as const;

const inputClass =
  'w-full px-2 py-1.5 text-sm rounded border border-[var(--ff-border-light)] ' +
  'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] ' +
  'focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none';

const thClass =
  'px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide';

interface BOQLineItemsTableProps {
  items: BOQLineItemRow[];
  onChange: (items: BOQLineItemRow[]) => void;
}

/** Creates a blank line item with the next sequential line number */
function createBlankItem(nextLine: number): BOQLineItemRow {
  return {
    lineNumber: nextLine,
    itemCode: '',
    description: '',
    category: '',
    quantity: 0,
    uom: 'EA',
    unitPrice: 0,
    totalPrice: 0,
  };
}

/**
 * Editable line items table for BOQ Create and Edit forms.
 * Handles add/remove rows and auto-calculates total price.
 */
export function BOQLineItemsTable({ items, onChange }: BOQLineItemsTableProps) {
  const handleAdd = () => {
    const nextLine = items.length > 0 ? Math.max(...items.map((i) => i.lineNumber)) + 1 : 1;
    onChange([...items, createBlankItem(nextLine)]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleFieldChange = (
    index: number,
    field: keyof BOQLineItemRow,
    value: string | number
  ) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        next.totalPrice = Number(next.quantity) * Number(next.unitPrice);
      }
      return next;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Line Items</h3>
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
            border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Item
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--ff-text-secondary)] border border-dashed border-[var(--ff-border-light)] rounded-lg">
          No line items yet. Click &quot;Add Item&quot; to begin.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="bg-[var(--ff-bg-tertiary,var(--ff-bg-secondary))]">
              <tr>
                <th className={`${thClass} w-12`}>#</th>
                <th className={`${thClass} w-24`}>Code</th>
                <th className={thClass}>Description</th>
                <th className={`${thClass} w-24`}>Category</th>
                <th className={`${thClass} w-20`}>Qty</th>
                <th className={`${thClass} w-20`}>UOM</th>
                <th className={`${thClass} w-24`}>Unit Price</th>
                <th className={`${thClass} w-24`}>Total</th>
                <th className={`${thClass} w-10`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {items.map((item, idx) => (
                <tr key={item.lineNumber} className="bg-[var(--ff-bg-secondary)]">
                  <td className="px-3 py-2 text-xs text-[var(--ff-text-secondary)]">
                    {item.lineNumber}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={item.itemCode}
                      onChange={(e) => handleFieldChange(idx, 'itemCode', e.target.value)}
                      className={inputClass}
                      placeholder="Code"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleFieldChange(idx, 'description', e.target.value)}
                      className={inputClass}
                      placeholder="Description (required)"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={item.category}
                      onChange={(e) => handleFieldChange(idx, 'category', e.target.value)}
                      className={inputClass}
                      placeholder="Cat."
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      value={item.quantity || ''}
                      onChange={(e) => handleFieldChange(idx, 'quantity', Number(e.target.value))}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={item.uom}
                      onChange={(e) => handleFieldChange(idx, 'uom', e.target.value)}
                      className={inputClass}
                    >
                      {UOM_OPTIONS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step={0.0001}
                      value={item.unitPrice || ''}
                      onChange={(e) => handleFieldChange(idx, 'unitPrice', Number(e.target.value))}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)] tabular-nums">
                    {item.totalPrice.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleRemove(idx)}
                      className="p-1 text-red-400 hover:text-red-300 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
