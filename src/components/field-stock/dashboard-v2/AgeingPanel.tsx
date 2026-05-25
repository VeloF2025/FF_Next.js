import Link from 'next/link';
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function AgeingPanel({ summary }: { summary: DashboardV2Summary }) {
  const a = summary.ageing;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Ageing &amp; slow-movers (&gt;{a.thresholdDays} days)</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Stagnant stock lines</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{a.stagnantStockCount.toLocaleString('en-ZA')}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Stagnant value</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formatCurrency(a.stagnantStockValue)}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Issued, not installed</p>
          <Link href="/procurement/field-stock/serials?status=issued,in_transit"
            className="text-2xl font-bold text-blue-500 hover:underline">
            {a.serialsIssuedNotInstalled.toLocaleString('en-ZA')}
          </Link>
        </div>
      </div>
    </section>
  );
}
