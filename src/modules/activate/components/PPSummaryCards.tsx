/**
 * PPSummaryCards — PP-specific banners shown OUTSIDE the main container card.
 * SummaryCards has been replaced by PPStatsBar (ring-2 active style, OLT-aligned).
 * Banners must remain in PPDataTab's outer space-y-6 scope so they show even when
 * stats.total === 0.
 */

'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { type LookupStatus } from './ppDataShared';
import { Button } from '@/components/ui/button';

export function LookupProgressBanner({ status }: { status: LookupStatus }) {
  return (
    <div className="bg-purple-900/20 border border-purple-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <InlineSpinner size="sm" />
        <span className="text-sm font-medium text-purple-300">1Map Serial Search in Progress</span>
        <span className="text-xs text-purple-400 ml-auto">
          {status.elapsed_seconds ? `${status.elapsed_seconds}s elapsed` : ''}
        </span>
      </div>
      <div className="w-full bg-purple-900/40 rounded-full h-2">
        <div
          className="bg-purple-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.round((status.searched / status.total) * 100)}%` }}
        />
      </div>
      <div className="flex gap-6 text-xs text-purple-300">
        <span>Searched: <strong>{status.searched}</strong> / {status.total}</span>
        <span className="text-teal-400">Found: <strong>{status.resolved}</strong></span>
        <span className="text-amber-400">Not Found: <strong>{status.not_found}</strong></span>
        {status.errors > 0 && <span className="text-red-400">Errors: <strong>{status.errors}</strong></span>}
      </div>
    </div>
  );
}

export function LookupCompleteBanner({ status, onDismiss }: { status: LookupStatus; onDismiss: () => void }) {
  return (
    <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 flex items-center gap-3">
      <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
      <div className="text-sm text-green-300">
        <strong>1Map search complete.</strong>{' '}
        Searched {status.total} serials — found <strong>{status.resolved}</strong>,
        not found {status.not_found}
        {status.elapsed_seconds ? ` in ${status.elapsed_seconds}s` : ''}.
      </div>
      <Button variant="ghost" size="icon" onClick={onDismiss} className="ml-auto" aria-label="Dismiss">
        <XCircle className="w-4 h-4" />
      </Button>
    </div>
  );
}
