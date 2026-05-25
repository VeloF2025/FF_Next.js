import Link from 'next/link';
import type { DashboardV2Summary } from '@/types/field-stock';

const STATUS_ORDER = [
  'available', 'reserved', 'allocated_to_project', 'in_transit', 'issued',
  'installed', 'activated', 'faulty', 'in_repair', 'returned', 'scrapped',
] as const;

export function SerialLifecyclePanel({ summary }: { summary: DashboardV2Summary }) {
  const { byStatus, installed, activated, recentlyInstalled, recentlyActivated } = summary.serialsLifecycle;
  const activationRate = installed > 0 ? Math.round((activated / installed) * 100) : 0;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Serial lifecycle</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <Link key={s} href={`/procurement/field-stock/serials?status=${s}`}
            className="rounded-full border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-1 text-xs text-[var(--ff-text-primary)] hover:border-blue-500">
            {s} <span className="font-semibold">{(byStatus[s] ?? 0).toLocaleString('en-ZA')}</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3 border-t border-[var(--ff-border-light)] pt-4">
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Installed (7d)</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{recentlyInstalled}</p></div>
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Activated (7d)</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{recentlyActivated}</p></div>
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Install→activate</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{activationRate}%</p></div>
      </div>
    </section>
  );
}
