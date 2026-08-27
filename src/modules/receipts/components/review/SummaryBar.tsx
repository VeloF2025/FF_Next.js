import type { ReceiptStatus } from '@/modules/receipts/queries';
import { formatRand } from './format';
import { emptySummary, type SummaryShape } from './types';

const BUCKETS: { key: ReceiptStatus; label: string; color: string }[] = [
  { key: 'submitted', label: 'Awaiting review', color: 'var(--ff-warning)' },
  { key: 'approved', label: 'Approved', color: 'var(--ff-success)' },
  { key: 'reconciled', label: 'Reconciled', color: 'var(--ff-info)' },
  { key: 'rejected', label: 'Rejected', color: 'var(--ff-error)' },
];

/**
 * Stat cards double as status filter toggles (click a bucket to filter
 * the table to it, click again to clear) — same interaction as GitHub
 * Issues / Linear's status counters. Uses the app's existing
 * .ff-stat-card component class so this matches every other dashboard
 * stat row in the app.
 */
export function SummaryBar({
  summary,
  loading,
  activeStatus,
  onSelect,
}: {
  summary: SummaryShape | null;
  loading: boolean;
  activeStatus: ReceiptStatus | '';
  onSelect: (status: ReceiptStatus | '') => void;
}) {
  const data = summary ?? emptySummary();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {BUCKETS.map((b) => {
        const bucket = data[b.key];
        const isActive = activeStatus === b.key;
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => onSelect(isActive ? '' : b.key)}
            aria-pressed={isActive}
            className="ff-stat-card text-left"
            style={{
              ['--stat-color' as string]: b.color,
              outline: isActive ? `2px solid ${b.color}` : undefined,
              outlineOffset: isActive ? '-1px' : undefined,
            }}
          >
            <div
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--ff-text-secondary)' }}
            >
              {b.label}
            </div>
            <div
              className="mt-1 text-2xl font-bold tabular-nums"
              style={{ color: 'var(--ff-text-primary)' }}
            >
              {loading ? <span className="opacity-60">…</span> : bucket.count}
            </div>
            <div
              className="text-xs tabular-nums"
              style={{ color: 'var(--ff-text-secondary)' }}
            >
              {loading ? '' : formatRand(bucket.totalCents)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
