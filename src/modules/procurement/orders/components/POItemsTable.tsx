/**
 * POItemsTable — Editable PO line items table.
 * Inline editing of quantity and unit price with save/cancel.
 */

import { useState, useCallback } from 'react';
import { Edit, Save, X, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface POLineItem {
  id: string;
  lineNumber: number;
  description: string;
  itemCode: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPending: number;
  unitOfMeasure: string;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
  boqUnitRate: number | null;
  boqQuantity: number | null;
  boqMatchSource: 'id' | 'code' | 'description' | null;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(n);
}

function getReceiptStatus(item: POLineItem) {
  if (item.quantityReceived >= item.quantityOrdered) return { label: 'Received', color: 'text-green-400' };
  if (item.quantityReceived > 0) return { label: 'Partial', color: 'text-amber-400' };
  return { label: 'Pending', color: 'text-[var(--ff-text-tertiary)]' };
}

interface EditRow {
  id: string;
  quantityOrdered: string;
  unitPrice: string;
}

interface Props {
  poId: string;
  items: POLineItem[];
  canEdit?: boolean;
  onItemsUpdated: () => void;
}

export function POItemsTable({ poId, items, canEdit = false, onItemsUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = useCallback(() => {
    setEditRows(items.map((item) => ({
      id: item.id,
      quantityOrdered: String(item.quantityOrdered),
      unitPrice: String(item.unitPrice),
    })));
    setEditing(true);
    setError(null);
  }, [items]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditRows([]);
    setError(null);
  }, []);

  const updateRow = useCallback((id: string, field: 'quantityOrdered' | 'unitPrice', value: string) => {
    setEditRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const itemUpdates = editRows.map((r) => ({
        id: r.id,
        quantityOrdered: parseFloat(r.quantityOrdered) || 0,
        unitPrice: parseFloat(r.unitPrice) || 0,
      }));

      const res = await fetch(`/api/procurement/purchase-orders/${poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_items', items: itemUpdates }),
      });
      const data = await res.json();

      if (data.success) {
        setEditing(false);
        setEditRows([]);
        onItemsUpdated();
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch (err) {
      log.error('Failed to save PO items', err);
      setError('Failed to save items');
    } finally {
      setSaving(false);
    }
  }, [editRows, poId, onItemsUpdated]);

  const getEditRow = (id: string) => editRows.find((r) => r.id === id);

  const calcLineTotal = (row: EditRow) => {
    const qty = parseFloat(row.quantityOrdered) || 0;
    const price = parseFloat(row.unitPrice) || 0;
    return qty * price;
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ff-border-light)]">
        <span className="text-sm text-[var(--ff-text-secondary)]">{items.length} line items</span>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={cancelEditing}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </button>
            </>
          ) : canEdit ? (
            <button
              onClick={startEditing}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded transition-colors"
            >
              <Edit className="h-3.5 w-3.5" /> Edit Items
            </button>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs">{error}</div>
      )}

      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--ff-border-light)]">
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">#</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Description</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Code</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Ordered</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Received</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">UOM</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">BOQ Rate</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">BOQ Qty</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Unit Price</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Line Total</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ff-border-light)]">
          {items.map((item) => {
            const editRow = editing ? getEditRow(item.id) : null;
            const receiptStatus = getReceiptStatus(item);
            const lineTotal = editRow ? calcLineTotal(editRow) : item.lineTotal;

            return (
              <tr key={item.id} className="hover:bg-[var(--ff-bg-hover)]">
                <td className="px-4 py-3 text-[var(--ff-text-tertiary)]">{item.lineNumber}</td>
                <td className="px-4 py-3 text-[var(--ff-text-primary)]">{item.description}</td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">{item.itemCode || '-'}</td>
                <td className="px-4 py-3 text-right">
                  {editRow ? (
                    <input
                      type="number"
                      value={editRow.quantityOrdered}
                      onChange={(e) => updateRow(item.id, 'quantityOrdered', e.target.value)}
                      className="w-24 px-2 py-1 text-right bg-[var(--ff-bg-tertiary)] border border-amber-500/50 rounded text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                      min="0"
                      step="any"
                    />
                  ) : (
                    <span className="text-[var(--ff-text-primary)]">{item.quantityOrdered}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-[var(--ff-text-primary)]">{item.quantityReceived}</td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">{item.unitOfMeasure}</td>
                <td className="px-4 py-3 text-right">
                  {item.boqUnitRate != null ? (
                    <span
                      className="text-sm font-medium"
                      title={`BOQ rate (matched by ${item.boqMatchSource ?? 'id'})`}
                      style={{
                        color: item.unitPrice > item.boqUnitRate
                          ? 'var(--ff-warning)'
                          : 'var(--ff-text-secondary)',
                      }}
                    >
                      {fmtZAR(item.boqUnitRate)}
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--ff-text-tertiary)' }}>—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {item.boqQuantity != null ? (
                    <span
                      className="text-sm"
                      title={`BOQ quantity (matched by ${item.boqMatchSource ?? 'id'})`}
                      style={{ color: 'var(--ff-text-secondary)' }}
                    >
                      {item.boqQuantity.toLocaleString('en-ZA')}
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--ff-text-tertiary)' }}>—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {editRow ? (
                    <input
                      type="number"
                      value={editRow.unitPrice}
                      onChange={(e) => updateRow(item.id, 'unitPrice', e.target.value)}
                      className="w-28 px-2 py-1 text-right bg-[var(--ff-bg-tertiary)] border border-amber-500/50 rounded text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                      min="0"
                      step="0.0001"
                    />
                  ) : (
                    <span className="text-[var(--ff-text-primary)]">{fmtZAR(item.unitPrice)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-[var(--ff-text-primary)]">
                  {fmtZAR(lineTotal)}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-sm font-medium ${receiptStatus.color}`}>{receiptStatus.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
