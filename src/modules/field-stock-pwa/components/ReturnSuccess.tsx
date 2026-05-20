/**
 * ReturnSuccess — terminal screen shown after a successful or queued return.
 *
 * Shown at step='done' inside ReturnOrchestrator.
 * Handles two cases:
 *  - result.returnNumber !== 'QUEUED' → confirmed with return number.
 *  - result.returnNumber === 'QUEUED' → offline-queued; will sync when online.
 *
 * Mirrors IssueSuccess.tsx patterns (icon, badge, action buttons).
 */

import { CheckCircle, Upload } from 'lucide-react';
import type { PwaReturnResult } from '@/modules/field-stock-pwa/types';

export interface ReturnSuccessProps {
  result: PwaReturnResult;
  onStartAnother: () => void;
  onBackToHub: () => void;
}

function isQueued(result: PwaReturnResult): boolean {
  return result.returnNumber === 'QUEUED';
}

export function ReturnSuccess({ result, onStartAnother, onBackToHub }: ReturnSuccessProps) {
  const queued = isQueued(result);

  return (
    <div className="flex flex-col items-center gap-6 pt-8 pb-4 text-center">
      {/* Status icon */}
      <div
        className={`flex items-center justify-center w-20 h-20 rounded-full ${
          queued
            ? 'bg-amber-500/15 text-amber-300'
            : 'bg-emerald-500/15 text-emerald-300'
        }`}
      >
        {queued ? (
          <Upload className="w-10 h-10" aria-hidden="true" />
        ) : (
          <CheckCircle className="w-10 h-10" aria-hidden="true" />
        )}
      </div>

      {/* Headline + return number */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-100">
          {queued ? 'Queued' : 'Returned'}
        </h1>
        {queued ? (
          <p className="text-sm text-amber-300 max-w-xs mx-auto">
            Saved offline — will sync automatically when you are back online.
          </p>
        ) : (
          <p className="text-sm text-neutral-400">Return submitted successfully.</p>
        )}

        {/* Return number badge */}
        <div className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Return</span>
          <span
            className={`font-mono text-sm font-semibold ${
              queued ? 'text-amber-300' : 'text-emerald-300'
            }`}
          >
            {result.returnNumber}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="w-full max-w-xs space-y-3 pt-2">
        <button
          type="button"
          onClick={onStartAnother}
          className="w-full py-3.5 rounded-lg bg-emerald-700 text-white font-medium text-sm hover:bg-emerald-600 active:bg-emerald-800"
        >
          Start another
        </button>
        <button
          type="button"
          onClick={onBackToHub}
          className="w-full py-3.5 rounded-lg border border-neutral-700 text-neutral-300 font-medium text-sm hover:bg-neutral-800 active:bg-neutral-700"
        >
          Back to /my/stores
        </button>
      </div>
    </div>
  );
}
