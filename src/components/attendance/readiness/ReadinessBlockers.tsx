import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { PeriodBlocker } from './usePeriodReadiness';

const OWNER_LABELS = {
  worker: 'Worker actions', supervisor: 'Supervisor actions', hr: 'HR / integrity actions',
} as const;

export function ReadinessBlockers({ blockers }: { blockers: PeriodBlocker[] }) {
  if (blockers.length === 0) {
    return <section className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-5 text-sm text-emerald-200">No unresolved readiness blockers.</section>;
  }
  return (
    <section className="space-y-3" aria-labelledby="readiness-blockers-heading">
      <h2 id="readiness-blockers-heading" className="text-lg font-semibold text-[var(--ff-text-primary)]">Readiness blockers</h2>
      {(['worker', 'supervisor', 'hr'] as const).map((owner) => {
        const owned = blockers.filter((item) => item.owner === owner);
        if (owned.length === 0) return null;
        return (
          <div key={owner} className="overflow-hidden rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)]">
            <h3 className="border-b border-[var(--ff-border-primary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--ff-text-tertiary)]">{OWNER_LABELS[owner]} ({owned.length})</h3>
            <ul className="divide-y divide-[var(--ff-border-primary)]">
              {owned.map((blocker) => (
                <li key={`${blocker.staffId}-${blocker.workDate}-${blocker.kind}`} className="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center">
                  <div>
                    <div className="text-sm font-medium text-[var(--ff-text-primary)]">{blocker.kind.replaceAll('_', ' ')}</div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">Staff {blocker.staffId} · {blocker.workDate} · {blocker.status}</div>
                  </div>
                  <Link href={blocker.actionUrl} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300">
                    {owner === 'worker' ? 'Open worker action' : owner === 'supervisor' ? 'Open supervisor action' : 'Open HR action'}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
