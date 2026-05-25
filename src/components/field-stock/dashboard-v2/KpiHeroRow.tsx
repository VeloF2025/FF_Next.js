import { Banknote, AlertTriangle, ScanLine, Hourglass } from 'lucide-react';
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

interface KpiCardProps { label: string; value: string; icon: React.ReactNode; accent: string; }

function KpiCard({ label, value, icon, accent }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--ff-text-secondary)]">{label}</p>
        <div className={`rounded-lg p-2 ${accent}`}>{icon}</div>
      </div>
      <p className="mt-2 text-3xl font-bold text-[var(--ff-text-primary)]">{value}</p>
    </div>
  );
}

export function KpiHeroRow({ summary }: { summary: DashboardV2Summary }) {
  const liveSerials = Object.values(summary.serialsLifecycle.byStatus).reduce((a, b) => a + b, 0);
  const ageingAlerts = summary.ageing.stagnantStockCount + summary.ageing.serialsIssuedNotInstalled;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Stock value" value={formatCurrency(summary.stockValue.total)}
        icon={<Banknote className="h-5 w-5 text-emerald-500" />} accent="bg-emerald-500/10" />
      <KpiCard label="Unaccounted exposure" value={formatCurrency(summary.contractorExposure.totalUnaccountedValue)}
        icon={<AlertTriangle className="h-5 w-5 text-red-500" />} accent="bg-red-500/10" />
      <KpiCard label="Live serials" value={liveSerials.toLocaleString('en-ZA')}
        icon={<ScanLine className="h-5 w-5 text-blue-500" />} accent="bg-blue-500/10" />
      <KpiCard label={`Ageing alerts (>${summary.ageing.thresholdDays}d)`} value={ageingAlerts.toLocaleString('en-ZA')}
        icon={<Hourglass className="h-5 w-5 text-amber-500" />} accent="bg-amber-500/10" />
    </div>
  );
}
