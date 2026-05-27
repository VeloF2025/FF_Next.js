/** One reconciliation check rendered as a pass/fail tile. */
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ReconciliationCheckResult } from '@/types/field-stock';

/** Human-readable labels for the check ids in reconcile-queries.sql. */
const CHECK_LABELS: Record<string, string> = {
  assets_without_serial: 'Assets without a serial row',
  issued_without_open_picking: 'Issued serials without an open picking',
  installed_serial_inconsistent_status: 'Installed serials with inconsistent status',
  accountability_issued_counter_drift: 'Contractor issued-counter drift',
  accountability_returned_counter_drift: 'Contractor returned-counter drift',
  latest_event_matches_status: 'Status matches latest event',
};

function labelFor(name: string): string {
  return CHECK_LABELS[name] ?? name.replace(/_/g, ' ');
}

export function ReconciliationTile({ result }: { result: ReconciliationCheckResult }) {
  const { name, drift, tolerance, passed } = result;
  const Icon = passed ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={`rounded-xl border p-4 ${
        passed
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--ff-text-primary)]">{labelFor(name)}</p>
        <Icon className={`h-5 w-5 shrink-0 ${passed ? 'text-green-500' : 'text-red-500'}`} />
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--ff-text-tertiary)]">{name}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${passed ? 'text-[var(--ff-text-primary)]' : 'text-red-500'}`}>
          {drift.toLocaleString('en-ZA')}
        </span>
        <span className="text-xs text-[var(--ff-text-secondary)]">drift (tolerance {tolerance})</span>
      </div>
    </div>
  );
}
