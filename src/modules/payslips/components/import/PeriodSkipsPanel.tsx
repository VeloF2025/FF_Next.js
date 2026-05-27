import React from 'react';

import type { PeriodSkip } from '@/modules/payslips/types';

export function PeriodSkipsPanel({ skips }: { skips: PeriodSkip[] }) {
  const unresolved = skips.filter((s) => s.resolvedAt === null);
  return (
    <section className="rounded-2xl border border-amber-800 bg-amber-950/40 px-5 py-4 space-y-2">
      <h2 className="text-sm font-semibold text-amber-100">
        Skipped this period ({unresolved.length})
      </h2>
      <p className="text-xs text-amber-200/80">
        These empCodes were skipped on a previous import for this period.
        They&apos;ll clear automatically when the matching staff record exists
        and you re-run the import.
      </p>
      <ul className="text-xs text-amber-100 space-y-1">
        {unresolved.map((s) => (
          <li key={s.id} className="flex flex-wrap gap-x-3">
            <code className="font-mono">{s.empCode}</code>
            <span>{s.empName ?? '—'}</span>
            <span className="text-amber-300/70">
              {s.reason ?? 'no reason given'}
            </span>
            <span className="text-amber-400/60">
              {new Date(s.skippedAt).toLocaleDateString('en-ZA')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
