// ============= PO Item Card Component =============
// Display individual line item with delivery progress

import React from 'react';
import { GlassCard, StatusBadge } from '../../../../components/ui';
import type { POItem } from '../../../../types/procurement/po.types';
import { formatterService } from '../../../../services/core/formatting';

interface POItemCardProps {
  item: POItem;
  currency: string;
}

export const POItemCard: React.FC<POItemCardProps> = ({ item, currency }) => {
  const formatCurrency = (amount: number) =>
    formatterService.currency(amount, { currency });

  const deliveryPercentage = Math.round((item.quantityDelivered / item.quantity) * 100);

  return (
    <GlassCard className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">
            Line {item.lineNumber}: {item.description}
          </h4>
          {item.itemCode && (
            <p className="text-sm text-gray-600 dark:text-gray-400">Code: {item.itemCode}</p>
          )}
          {item.category && (
            <p className="text-sm text-gray-600 dark:text-gray-400">Category: {item.category}</p>
          )}
        </div>
        <StatusBadge status={item.itemStatus} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Quantity:</span>
          <p className="text-gray-900 dark:text-gray-100">
            {item.quantity.toLocaleString()} {item.uom}
          </p>
        </div>
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Unit Price:</span>
          <p className="text-gray-900 dark:text-gray-100">{formatCurrency(item.unitPrice)}</p>
        </div>
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Line Total:</span>
          <p className="text-gray-900 dark:text-gray-100 font-semibold">{formatCurrency(item.lineTotal)}</p>
        </div>
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Delivered:</span>
          <p className="text-gray-900 dark:text-gray-100">
            {item.quantityDelivered.toLocaleString()} {item.uom}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
          <span>Delivery Progress</span>
          <span>{deliveryPercentage}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full"
            style={{ width: `${Math.min(deliveryPercentage, 100)}%` }}
          />
        </div>
      </div>
    </GlassCard>
  );
};
