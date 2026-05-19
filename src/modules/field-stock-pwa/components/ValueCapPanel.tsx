'use client';

/**
 * ValueCapPanel — R5,000 pending-tech issue cap warning/block.
 *
 * Displayed only when the technician's account_status is 'pending'.
 * Extracted from SignAndSubmitStep to keep that component under 200 lines.
 *
 * States:
 *  - unitValueZar is null: amber soft-warning (server will recheck).
 *  - total <= cap:         green confirmation with computed value.
 *  - total > cap:          rose block with named-tech instruction.
 */

// 🟢 WORKING: pure display, no fetch, props only

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { StockValueGuardResult } from '@/modules/field-stock-pwa/lib/stockValueGuard';

function formatZar(amount: number): string {
  return 'R ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface ValueCapPanelProps {
  /**
   * null   = tech is not pending; panel hides entirely.
   * {unknown:true} = unit value unavailable; show amber warning.
   * StockValueGuardResult = known value; show computed total.
   */
  guard: null | { unknown: true } | StockValueGuardResult;
  technicianName: string;
}

export function ValueCapPanel({ guard, technicianName }: ValueCapPanelProps) {
  if (guard === null) return null;

  if ('unknown' in guard) {
    return (
      <div className="flex gap-2 rounded-lg bg-amber-950/60 border border-amber-800 px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300">
          Unit value unavailable -- the R5,000 cap cannot be enforced
          client-side. The server will recheck on submit.
        </p>
      </div>
    );
  }

  const { totalZar, capZar, over } = guard;

  return (
    <div
      className={
        'flex gap-2 rounded-lg border px-4 py-3 ' +
        (over ? 'bg-rose-950/60 border-rose-700' : 'bg-neutral-900 border-neutral-800')
      }
    >
      {over ? (
        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
      )}
      <div className="text-xs space-y-0.5">
        <p className={over ? 'text-rose-300' : 'text-neutral-300'}>
          {'Projected value: '}
          <span className="font-semibold">{formatZar(totalZar)}</span>
          {' / cap '}
          {formatZar(capZar)}
        </p>
        {over && (
          <p className="text-rose-200">
            Pending technicians are limited to {formatZar(capZar)} of stock --
            ask an admin to approve{' '}
            <span className="font-semibold">{technicianName}</span>{' '}
            first, then retry.
          </p>
        )}
      </div>
    </div>
  );
}
