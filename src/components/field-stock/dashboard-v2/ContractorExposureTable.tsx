import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function ContractorExposureTable({ summary }: { summary: DashboardV2Summary }) {
  const { top, totalHeldValue, totalUnaccountedValue, blockedCount } = summary.contractorExposure;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Contractor exposure</h2>
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          Held {formatCurrency(totalHeldValue)} · Unaccounted {formatCurrency(totalUnaccountedValue)} · {blockedCount} blocked
        </span>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)]">No contractor stock on record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--ff-text-tertiary)]">
                <th className="px-2 py-1">Contractor</th>
                <th className="px-2 py-1 text-right">Held</th>
                <th className="px-2 py-1 text-right">Unaccounted</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {top.map((c) => (
                <tr key={c.name}>
                  <td className="px-2 py-2 text-[var(--ff-text-primary)]">{c.name}</td>
                  <td className="px-2 py-2 text-right text-[var(--ff-text-primary)]">{formatCurrency(c.heldValue)}</td>
                  <td className="px-2 py-2 text-right font-medium text-[var(--ff-text-primary)]">{formatCurrency(c.unaccountedValue)}</td>
                  <td className="px-2 py-2">
                    {c.isBlocked
                      ? <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">Blocked</span>
                      : <span className="text-xs text-[var(--ff-text-tertiary)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
