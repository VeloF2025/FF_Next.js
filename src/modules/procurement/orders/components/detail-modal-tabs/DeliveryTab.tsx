// ============= Delivery Tab Component =============
// Display delivery status and notes

import React from 'react';
import { Truck } from 'lucide-react';
import { GlassCard, StatusBadge } from '../../../../../components/ui';
import type { PurchaseOrder } from '../../../../../types/procurement/po.types';
import { formatterService } from '../../../../../services/core/formatting';

interface DeliveryTabProps {
  po: PurchaseOrder;
}

export const DeliveryTab: React.FC<DeliveryTabProps> = ({ po }) => {
  const formatDate = (date: Date | undefined) =>
    date ? formatterService.date(date, { dateStyle: 'long' }) : '-';

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Truck className="h-5 w-5 mr-2" />
          Delivery Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p>
              <span className="font-medium">Status:</span>{' '}
              <StatusBadge status={po.deliveryStatus} />
            </p>
            <p className="mt-2">
              <span className="font-medium">Expected Date:</span> {formatDate(po.expectedDeliveryDate)}
            </p>
            {po.actualDeliveryDate && (
              <p className="mt-2">
                <span className="font-medium">Actual Date:</span> {formatDate(po.actualDeliveryDate)}
              </p>
            )}
          </div>
          <div>
            <p>
              <span className="font-medium">Partial Delivery:</span>{' '}
              {po.partialDeliveryAllowed ? 'Allowed' : 'Not Allowed'}
            </p>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h4 className="font-semibold mb-4">Delivery Notes</h4>
        <p className="text-center text-gray-500 dark:text-gray-400">No delivery notes available</p>
      </GlassCard>
    </div>
  );
};
