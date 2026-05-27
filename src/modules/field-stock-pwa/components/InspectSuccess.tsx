/**
 * InspectSuccess — terminal screen shown after a return is inspected and restocked.
 *
 * Shown inside InspectOrchestrator when result is set.
 * Mirrors ReturnSuccess.tsx shape (icon, return number badge, action button).
 */

import { CheckCircle } from 'lucide-react';
import type { PwaReturnResult } from '@/modules/field-stock-pwa/types';

export interface InspectSuccessProps {
  result: PwaReturnResult;
  onBack: () => void;
}

export function InspectSuccess({ result, onBack }: InspectSuccessProps) {
  return (
    <div className="flex flex-col items-center gap-6 pt-8 pb-4 text-center">
      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/15 text-emerald-300">
        <CheckCircle className="w-10 h-10" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-100">Restocked</h1>
        <p className="text-sm text-neutral-400">Stock returned to warehouse successfully.</p>
        <div className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Return</span>
          <span className="font-mono text-sm font-semibold text-emerald-300">{result.returnNumber}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="w-full max-w-xs py-3.5 rounded-lg bg-emerald-700 text-white font-medium text-sm hover:bg-emerald-600"
      >
        Back to inspect list
      </button>
    </div>
  );
}
