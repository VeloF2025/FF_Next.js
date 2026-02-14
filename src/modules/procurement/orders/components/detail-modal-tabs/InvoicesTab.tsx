// ============= Invoices Tab Component =============
// Display invoice status and list

import React from 'react';
import { FileCheck } from 'lucide-react';
import { GlassCard, StatusBadge } from '../../../../../components/ui';
import type { PurchaseOrder } from '../../../../../types/procurement/po.types';

interface InvoicesTabProps {
  po: PurchaseOrder;
}

export const InvoicesTab: React.FC<InvoicesTabProps> = ({ po }) => {
  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <FileCheck className="h-5 w-5 mr-2" />
          Invoice Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p>
              <span className="font-medium">Status:</span>{' '}
              <StatusBadge status={po.invoiceStatus} />
            </p>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h4 className="font-semibold mb-4">Invoices</h4>
        <p className="text-center text-muted-foreground">No invoices submitted yet</p>
      </GlassCard>
    </div>
  );
};
