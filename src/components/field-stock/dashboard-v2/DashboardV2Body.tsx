/**
 * DashboardV2Body — the v2 field-stock dashboard content (refresh toolbar + panels),
 * without page chrome. Rendered by both the standalone /dashboard-v2 page and the
 * default "Dashboard" tab in /procurement/field-stock.
 */
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useDashboardV2 } from '@/modules/procurement/field-stock/hooks/useDashboardV2';
import { KpiHeroRow } from './KpiHeroRow';
import { StockValueByLocation } from './StockValueByLocation';
import { ContractorExposureTable } from './ContractorExposureTable';
import { SerialLifecyclePanel } from './SerialLifecyclePanel';
import { AgeingPanel } from './AgeingPanel';
import { DashboardV2QuickActions } from './DashboardV2QuickActions';

interface DashboardV2BodyProps {
  /** When supplied (tabbed page context), renders quick-action shortcuts that switch tabs. */
  onNavigate?: (tab: string) => void;
}

export function DashboardV2Body({ onNavigate }: DashboardV2BodyProps = {}) {
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
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={handleRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing…' : 'Refresh'}
          className="flex items-center gap-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
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
          {onNavigate && <DashboardV2QuickActions onNavigate={onNavigate} />}
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
  );
}
