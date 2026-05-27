import type { ReceiptStatus } from '@/modules/receipts/queries';
import { formatRand } from './format';
import { emptySummary, type SummaryShape } from './types';

const BUCKETS: { key: ReceiptStatus; label: string; tone: string }[] = [
  { key: 'submitted', label: 'Awaiting review', tone: 'border-amber-700 bg-amber-950/40 text-amber-200' },
  { key: 'approved', label: 'Approved', tone: 'border-emerald-700 bg-emerald-950/40 text-emerald-200' },
  { key: 'reconciled', label: 'Reconciled', tone: 'border-blue-700 bg-blue-950/40 text-blue-200' },
  { key: 'rejected', label: 'Rejected', tone: 'border-red-800 bg-red-950/40 text-red-200' },
];

export function SummaryBar({
  summary,
  loading,
}: {
  summary: SummaryShape | null;
  loading: boolean;
}) {
  const data = summary ?? emptySummary();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {BUCKETS.map((b) => {
        const bucket = data[b.key];
        return (
          <div key={b.key} className={`rounded-2xl border ${b.tone} px-4 py-3`}>
            <div className="text-xs uppercase tracking-wide opacity-80">{b.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {loading ? <span className="opacity-60">…</span> : bucket.count}
            </div>
            <div className="text-xs opacity-80 tabular-nums">
              {loading ? '' : formatRand(bucket.totalCents)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
