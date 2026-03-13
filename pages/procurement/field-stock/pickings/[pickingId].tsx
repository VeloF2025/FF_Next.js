/**
 * Stock Picking Detail Page
 * /procurement/field-stock/pickings/[pickingId]
 */

import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import { PickingDetail } from '@/modules/procurement/field-stock/components/pickings/PickingDetail';
import { ShoppingCart, MapPin } from 'lucide-react';

export default function PickingDetailPage() {
  const router = useRouter();
  const { pickingId } = router.query;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Module Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2">
                <ShoppingCart className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage procurement across all projects
                </p>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--ff-border-light)] px-6">
            <ProcurementTabs activeTab="field-stock" categoriesOnly />
          </div>
        </div>

        {/* Sub Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Transfer Detail</h2>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {typeof pickingId === 'string' ? (
            <PickingDetail pickingId={pickingId} />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
