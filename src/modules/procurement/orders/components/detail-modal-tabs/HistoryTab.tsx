// ============= History Tab Component =============
// Display activity history timeline

import React from 'react';
import { Clock } from 'lucide-react';
import { GlassCard } from '../../../../../components/ui';
import type { PurchaseOrder } from '../../../../../types/procurement/po.types';
import { formatterService } from '../../../../../services/core/formatting';

interface HistoryTabProps {
  po: PurchaseOrder;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ po }) => {
  const formatDate = (date: Date | undefined) =>
    date ? formatterService.date(date, { dateStyle: 'long' }) : '-';

  const activities = [
    { date: po.createdAt, action: 'Purchase Order created', user: po.createdBy },
    po.issuedAt && { date: po.issuedAt, action: 'Purchase Order issued', user: po.issuedBy },
    po.sentAt && { date: po.sentAt, action: 'Purchase Order sent to supplier', user: po.issuedBy },
    po.acknowledgedAt && {
      date: po.acknowledgedAt,
      action: 'Purchase Order acknowledged by supplier',
      user: 'Supplier'
    }
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Activity History
        </h3>

        <div className="space-y-4">
          {activities.map((entry: any, index) => (
            <div
              key={index}
              className="flex items-start space-x-4 border-l-2 border-blue-500 pl-4"
            >
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-gray-100">{entry.action}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">by {entry.user}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(entry.date)}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
};
