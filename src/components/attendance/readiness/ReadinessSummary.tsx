import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import type { PeriodReadiness } from './usePeriodReadiness';

function metric(id: string, label: string, value: string, flagged = false) {
  return (
    <div data-testid={id} className={`rounded-xl border p-4 ${flagged
      ? 'border-red-800 bg-red-950/20' : 'border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)]'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${flagged ? 'text-red-300' : 'text-[var(--ff-text-primary)]'}`}>{value}</div>
    </div>
  );
}

export function ReadinessSummary({ readiness }: { readiness: PeriodReadiness }) {
  const reconciled = readiness.reconciliationLastSucceededAt
    ? new Date(readiness.reconciliationLastSucceededAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })
    : 'Never';
  return (
    <section data-testid="readiness-summary" aria-label="Period readiness" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metric('readiness-expected', 'Expected days', String(readiness.expectedDayCount))}
        {metric('readiness-approved', 'Approved days', String(readiness.approvedDayCount), readiness.approvedDayCount !== readiness.expectedDayCount)}
        {metric('readiness-blockers', 'Blockers', String(readiness.blockerCount), readiness.blockerCount > 0)}
        {metric('readiness-overtime', 'Unapproved OT', `${readiness.unapprovedOvertimeHours.toFixed(2)}h`, readiness.unapprovedOvertimeHours > 0)}
        {metric('readiness-sunday', 'Unapproved Sunday', `${readiness.unapprovedSundayHours.toFixed(2)}h`, readiness.unapprovedSundayHours > 0)}
      </div>
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${readiness.readyToLock
        ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200'
        : 'border-amber-800 bg-amber-950/20 text-amber-200'}`}>
        {readiness.readyToLock ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <strong>{readiness.readyToLock ? 'Ready to lock' : 'Not ready to lock'}</strong>
        <span className="inline-flex items-center gap-1 text-xs opacity-80"><Clock3 className="h-3.5 w-3.5" /> Reconciled {reconciled}</span>
        {!readiness.reconciliationFresh && <span>Reconciliation is stale.</span>}
        {readiness.expectedDayCount === 0 && <span>No expected attendance days exist for this week.</span>}
      </div>
    </section>
  );
}
