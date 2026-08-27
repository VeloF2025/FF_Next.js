import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ReceiptStatus } from '@/modules/receipts/queries';
import type { Filters } from './types';
import { MoreFiltersPanel } from './MoreFiltersPanel';

const STATUS_CHIPS: { value: ReceiptStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'rejected', label: 'Rejected' },
];

const ADVANCED_KEYS: (keyof Filters)[] = ['category', 'staffId', 'projectId'];

/**
 * Single-line toolbar for the common case (status + month). Category /
 * staff / project live behind "More filters" so the bar stays compact —
 * status is also settable from SummaryBar's clickable stat cards, both
 * write the same `filters.status`.
 */
export function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const advancedActive = ADVANCED_KEYS.some((k) => filters[k]);
  const [showMore, setShowMore] = React.useState(advancedActive);

  // filters hydrates from the URL asynchronously (router.isReady effect in
  // the page), after this component's first render — so a deep-link like
  // ?staffId=<uuid> mounts with advancedActive=false and the useState
  // initial value above never re-evaluates. Expand once the deep-linked
  // filter actually arrives; never auto-collapse a panel the reviewer
  // opened manually.
  React.useEffect(() => {
    if (advancedActive) setShowMore(true);
  }, [advancedActive]);

  const update = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    onChange({ ...filters, [k]: v });
  };

  return (
    <section className="ff-card">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="inline-flex rounded-lg border p-0.5"
          style={{ borderColor: 'var(--ff-border-medium)' }}
        >
          {STATUS_CHIPS.map((chip) => {
            const active = filters.status === chip.value;
            return (
              <button
                key={chip.value || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => update('status', chip.value)}
                className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                style={
                  active
                    ? { background: 'var(--ff-primary-600)', color: 'var(--ff-text-white)' }
                    : { color: 'var(--ff-text-secondary)' }
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--ff-text-secondary)' }}>
            Month
          </span>
          <input
            type="month"
            value={filters.month}
            onChange={(e) => update('month', e.target.value)}
            className="ff-input text-sm w-auto"
          />
        </label>

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          aria-expanded={showMore}
          className="ff-button ff-button--secondary text-xs ml-auto"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          More filters
          {advancedActive && !showMore && (
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--ff-primary-600)' }}
              aria-hidden="true"
            />
          )}
        </button>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--ff-text-secondary)' }}
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      {showMore && <MoreFiltersPanel filters={filters} onChange={onChange} />}
    </section>
  );
}
