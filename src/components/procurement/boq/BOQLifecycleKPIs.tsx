/**
 * BOQLifecycleKPIs — 5 KPI summary cards for BOQ procurement lifecycle.
 */
import type { BOQLifecycleSummary } from '@/types/procurement/boq-lifecycle.types';

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

interface KPICardProps {
  label: string;
  value: number;
  percent: number;
  borderColor: string;
  valueColor: string;
  barColor: string;
  subtitle?: string;
}

function KPICard({ label, value, percent, borderColor, valueColor, barColor, subtitle }: KPICardProps) {
  return (
    <div className={`bg-[var(--ff-bg-secondary)] border ${borderColor} rounded-lg p-4`}>
      <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueColor}`}>{fmtZAR(value)}</p>
      <div className="mt-2">
        <div className="flex justify-between text-xs text-[var(--ff-text-tertiary)] mb-1">
          <span>{percent}% of BOQ</span>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <div className="h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

interface BOQLifecycleKPIsProps {
  summary: BOQLifecycleSummary;
}

export function BOQLifecycleKPIs({ summary }: BOQLifecycleKPIsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KPICard
        label="BOQ Value"
        value={summary.totalBoqValue}
        percent={100}
        borderColor="border-[var(--ff-border-light)]"
        valueColor="text-[var(--ff-text-primary)]"
        barColor="bg-gray-500"
        subtitle="budget"
      />
      <KPICard
        label="Ordered"
        value={summary.totalOrderedValue}
        percent={summary.orderedPercent}
        borderColor="border-purple-500/30"
        valueColor="text-purple-400"
        barColor="bg-purple-500"
      />
      <KPICard
        label="Delivered"
        value={summary.totalReceivedValue}
        percent={summary.receivedPercent}
        borderColor="border-green-500/30"
        valueColor="text-green-400"
        barColor="bg-green-500"
      />
      <KPICard
        label="Invoiced"
        value={summary.totalInvoicedValue}
        percent={summary.invoicedPercent}
        borderColor="border-blue-500/30"
        valueColor="text-blue-400"
        barColor="bg-blue-500"
      />
      <KPICard
        label="Paid"
        value={summary.totalPaidValue}
        percent={summary.paidPercent}
        borderColor="border-emerald-500/30"
        valueColor="text-emerald-400"
        barColor="bg-emerald-500"
      />
    </div>
  );
}
