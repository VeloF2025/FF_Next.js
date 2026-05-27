import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function StockValueByLocation({ summary }: { summary: DashboardV2Summary }) {
  const rows = summary.stockValue.byLocation;
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Stock value by location</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)]">No valued stock on hand.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.name}-${r.type}`}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[var(--ff-text-primary)]">{r.name}
                  <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">{r.type} · {r.itemCount} items</span>
                </span>
                <span className="font-medium text-[var(--ff-text-primary)]">{formatCurrency(r.value)}</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-[var(--ff-bg-tertiary)]">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
