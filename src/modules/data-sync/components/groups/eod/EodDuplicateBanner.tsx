'use client';

import type { EodSheetSlot } from '../../../types';

interface EodDuplicateBannerProps {
  slots: EodSheetSlot[];
  onForceReExtract: (index: number) => void;
  onDismissAll: () => void;
}

/**
 * Surfaces the auto-skipped image-hash duplicates so the user can either
 * (1) Re-extract a specific sheet as a fresh entry (bypassing the hash check),
 * or (2) Dismiss the lot and finalize the batch. The banner stays visible
 * until the user explicitly resolves every duplicate slot.
 */
export function EodDuplicateBanner({ slots, onForceReExtract, onDismissAll }: EodDuplicateBannerProps) {
  const dupCount = slots.filter((s) => s.status === 'duplicate').length;
  if (dupCount === 0) return null;

  return (
    <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-400 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <span>
          {dupCount} sheet{dupCount !== 1 ? 's' : ''} already uploaded with the same image.
          Choose <strong>Re-extract anyway</strong> to reprocess as a new entry,
          or <strong>Dismiss</strong> to skip and finish.
        </span>
        <button
          onClick={onDismissAll}
          className="flex-shrink-0 text-xs text-amber-200 border border-amber-500/30 px-3 py-1 rounded hover:bg-amber-500/10"
        >
          Dismiss all
        </button>
      </div>
      <ul className="space-y-1 text-xs text-amber-300/90">
        {slots.map((slot, i) => slot.status === 'duplicate' ? (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate">{slot.file.name}{slot.error ? ` — ${slot.error}` : ''}</span>
            <button
              onClick={() => onForceReExtract(i)}
              className="flex-shrink-0 text-amber-200 underline hover:no-underline"
              title="Re-extract this sheet as a new entry (bypasses the image-hash check)"
            >
              Re-extract anyway
            </button>
          </li>
        ) : null)}
      </ul>
    </div>
  );
}
