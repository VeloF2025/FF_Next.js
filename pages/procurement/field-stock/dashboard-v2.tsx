import { AppLayout } from '@/components/layout';
import { ShoppingCart } from 'lucide-react';
import { DashboardV2Body } from '@/components/field-stock/dashboard-v2/DashboardV2Body';

export default function FieldStockDashboardV2() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2"><ShoppingCart className="h-6 w-6 text-purple-500" /></div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Field Stock — Dashboard v2</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">Stock value, contractor exposure, serial lifecycle &amp; ageing</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <DashboardV2Body />
        </div>
      </div>
    </AppLayout>
  );
}
