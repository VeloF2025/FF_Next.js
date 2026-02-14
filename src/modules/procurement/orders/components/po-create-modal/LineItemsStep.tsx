// ============= Line Items Step Component =============

import React from 'react';
import { Package, Plus, Trash2, DollarSign } from 'lucide-react';
import { VelocityButton, GlassCard } from '../../../../../components/ui';
import type { POFormData, POTotals } from './types';
import type { CreatePOItemRequest } from '../../../../../types/procurement/po.types';

interface LineItemsStepProps {
  formData: POFormData;
  totals: POTotals;
  addItem: () => void;
  updateItem: (tempId: string, updates: Partial<CreatePOItemRequest>) => void;
  removeItem: (tempId: string) => void;
}

export const LineItemsStep: React.FC<LineItemsStepProps> = ({
  formData,
  totals,
  addItem,
  updateItem,
  removeItem
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground flex items-center">
          <Package className="h-5 w-5 mr-2" />
          Line Items
        </h3>
        <VelocityButton
          variant="outline"
          size="sm"
          onClick={addItem}
          icon={<Plus className="h-4 w-4" />}
        >
          Add Item
        </VelocityButton>
      </div>

      {formData.items.length === 0 ? (
        <div className="text-center py-12 bg-background rounded-lg">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-muted-foreground">No items added yet</p>
          <VelocityButton
            variant="outline"
            size="sm"
            onClick={addItem}
            className="mt-4"
            icon={<Plus className="h-4 w-4" />}
          >
            Add First Item
          </VelocityButton>
        </div>
      ) : (
        <div className="space-y-4">
          {formData.items.map((item, index) => (
            <GlassCard key={item.tempId} className="p-4">
              <div className="flex items-start justify-between mb-4">
                <h4 className="font-medium text-foreground">Item #{index + 1}</h4>
                <button
                  onClick={() => removeItem(item.tempId)}
                  className="text-red-600 hover:text-red-800 p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Description *
                  </label>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(item.tempId, { description: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter item description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={item.category || ''}
                    onChange={(e) => updateItem(item.tempId, { category: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter category"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    UOM
                  </label>
                  <select
                    value={item.uom}
                    onChange={(e) => updateItem(item.tempId, { uom: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="pieces">Pieces</option>
                    <option value="meters">Meters</option>
                    <option value="kg">Kilograms</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="lots">Lots</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.tempId, { quantity: parseFloat(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Unit Price (ZAR) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item.tempId, { unitPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Line Total
                  </label>
                  <input
                    type="text"
                    value={new Intl.NumberFormat('en-ZA', {
                      style: 'currency',
                      currency: 'ZAR'
                    }).format(item.quantity * item.unitPrice)}
                    readOnly
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-muted-foreground"
                  />
                </div>
              </div>
            </GlassCard>
          ))}

          {/* Order Summary */}
          <GlassCard className="p-4 bg-blue-50">
            <div className="flex items-center justify-between text-lg font-semibold">
              <span className="flex items-center">
                <DollarSign className="h-5 w-5 mr-2" />
                Order Summary
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (15%):</span>
                <span>{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.taxAmount)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold text-lg">
                <span>Total:</span>
                <span>{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.total)}</span>
              </div>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
