/**
 * OltAutoDetectBanner — running process status banner visible on all OLT tabs
 */

'use client';

import { Loader2 } from 'lucide-react';
import type { AutoDetectStatus } from '../../../types';

interface OltAutoDetectBannerProps {
  autoDetectStatus: AutoDetectStatus | null;
}

export function OltAutoDetectBanner({ autoDetectStatus }: OltAutoDetectBannerProps) {
  if (!autoDetectStatus?.hasRun || !autoDetectStatus.run) return null;
  const { run, queue } = autoDetectStatus;
  if (run.status !== 'running' && run.status !== 'processing_queue') return null;

  return (
    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          <span className="text-sm font-medium text-purple-300">
            OLT Mismatch Check Running
          </span>
          {queue && queue.total > 0 && (
            <span className="text-sm text-[var(--ff-text-secondary)]">
              {queue.completed}/{queue.total} checked
              <span className="ml-1 text-[var(--ff-text-tertiary)]">
                ({Math.round((queue.completed / queue.total) * 100)}%)
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-400">{run.matches} matches</span>
          {run.mismatchesNote4 > 0 && (
            <span className="text-amber-400">{run.mismatchesNote4} mismatches</span>
          )}
          {run.mismatchesNote2 > 0 && (
            <span className="text-red-400">{run.mismatchesNote2} not found</span>
          )}
          {run.upsSwaps > 0 && (
            <span className="text-orange-400">{run.upsSwaps} swaps</span>
          )}
        </div>
      </div>
      {queue && queue.total > 0 && (
        <div className="mt-2 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${(queue.completed / queue.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
