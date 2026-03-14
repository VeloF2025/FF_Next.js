/**
 * Stock Picking Detail Page
 * /procurement/field-stock/pickings/[pickingId]
 */

import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';

import { PickingDetail } from '@/modules/procurement/field-stock/components/pickings/PickingDetail';
import { MapPin } from 'lucide-react';

export default function PickingDetailPage() {
  const router = useRouter();
  const { pickingId } = router.query;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">

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
