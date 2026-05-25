import { useState } from 'react';
import { AppLayout } from '@/components/layout';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { useDashboardV2 } from '@/modules/procurement/field-stock/hooks/useDashboardV2';
import { KpiHeroRow } from '@/components/field-stock/dashboard-v2/KpiHeroRow';
import { StockValueByLocation } from '@/components/field-stock/dashboard-v2/StockValueByLocation';
import { ContractorExposureTable } from '@/components/field-stock/dashboard-v2/ContractorExposureTable';
import { SerialLifecyclePanel } from '@/components/field-stock/dashboard-v2/SerialLifecyclePanel';
import { AgeingPanel } from '@/components/field-stock/dashboard-v2/AgeingPanel';

export default function FieldStockDashboardV2() {
  const { summary, loading, error, refresh } = useDashboardV2();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

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
            <button onClick={handleRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing…' : 'Refresh'}
              className="flex items-center gap-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {loading && !summary && (
            <div className="py-20 text-center text-[var(--ff-text-secondary)]">Loading dashboard…</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-500">
              <p className="font-medium">Error loading dashboard</p>
              <p className="text-sm">{error}</p>
              <button onClick={handleRefresh} disabled={refreshing} className="mt-2 text-sm underline disabled:opacity-50">Try again</button>
            </div>
          )}
          {summary && (
            <>
              <KpiHeroRow summary={summary} />
              <div className="grid gap-6 lg:grid-cols-2">
                <StockValueByLocation summary={summary} />
                <ContractorExposureTable summary={summary} />
              </div>
              <SerialLifecyclePanel summary={summary} />
              <AgeingPanel summary={summary} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
