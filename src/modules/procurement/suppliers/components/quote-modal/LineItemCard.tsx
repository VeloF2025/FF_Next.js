import React from 'react';
import { Trash2 } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import type { QuoteLineItem } from './types';

interface LineItemCardProps {
  item: QuoteLineItem;
  index: number;
  readOnly: boolean;
  errors: Record<string, string>;
  onUpdate: (index: number, field: keyof QuoteLineItem, value: any) => void;
  onRemove?: (index: number) => void;
}

export const LineItemCard: React.FC<LineItemCardProps> = ({
  item,
  index,
  readOnly,
  errors,
  onUpdate,
  onRemove
}) => {
  return (
    <GlassCard>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Item Code
          </label>
          <input
            type="text"
            value={item.itemCode}
            onChange={(e) => onUpdate(index, 'itemCode', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly={readOnly}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Item Name
          </label>
          <input
            type="text"
            value={item.itemName}
            onChange={(e) => onUpdate(index, 'itemName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Quantity
          </label>
          <input
            type="number"
            value={item.quantity}
            onChange={(e) => onUpdate(index, 'quantity', parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly={readOnly}
          />
        </div>
        <div className="flex items-end">
          {!readOnly && onRemove && (
            <button
              onClick={() => onRemove(index)}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Unit Price (ZAR)
          </label>
          <input
            type="number"
            step="0.01"
            value={item.unitPrice}
            onChange={(e) => onUpdate(index, 'unitPrice', parseFloat(e.target.value) || 0)}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors[`unitPrice_${index}`] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
          {errors[`unitPrice_${index}`] && (
            <p className="text-red-600 text-xs mt-1">{errors[`unitPrice_${index}`]}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Unit
          </label>
          <input
            type="text"
            value={item.unit}
            onChange={(e) => onUpdate(index, 'unit', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Delivery Time (days)
          </label>
          <input
            type="number"
            value={item.deliveryTime}
            onChange={(e) => onUpdate(index, 'deliveryTime', parseInt(e.target.value) || 0)}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors[`deliveryTime_${index}`] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
          {errors[`deliveryTime_${index}`] && (
            <p className="text-red-600 text-xs mt-1">{errors[`deliveryTime_${index}`]}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Total Price
          </label>
          <input
            type="text"
            value={`R ${item.totalPrice.toLocaleString()}`}
            readOnly
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 font-medium"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Notes
        </label>
        <textarea
          value={item.notes || ''}
          onChange={(e) => onUpdate(index, 'notes', e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Add any notes or special requirements..."
        />
      </div>
    </GlassCard>
  );
};
