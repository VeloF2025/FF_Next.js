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
          <h4 className="font-semibold text-foreground">
            Line {item.lineNumber}: {item.description}
          </h4>
          {item.itemCode && (
            <p className="text-sm text-muted-foreground">Code: {item.itemCode}</p>
          )}
          {item.category && (
            <p className="text-sm text-muted-foreground">Category: {item.category}</p>
          )}
        </div>
        <StatusBadge status={item.itemStatus} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="font-medium text-muted-foreground">Quantity:</span>
          <p className="text-foreground">
            {item.quantity.toLocaleString()} {item.uom}
          </p>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Unit Price:</span>
          <p className="text-foreground">{formatCurrency(item.unitPrice)}</p>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Line Total:</span>
          <p className="text-foreground font-semibold">{formatCurrency(item.lineTotal)}</p>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Delivered:</span>
          <p className="text-foreground">
            {item.quantityDelivered.toLocaleString()} {item.uom}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Delivery Progress</span>
          <span>{deliveryPercentage}%</span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full"
            style={{ width: `${Math.min(deliveryPercentage, 100)}%` }}
          />
        </div>
      </div>
    </GlassCard>
  );
};
