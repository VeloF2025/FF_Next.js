'use client';

import type { EodSheetSlot } from '../../../types';

interface EodDuplicateBannerProps {
  slots: EodSheetSlot[];
  onForceReExtract: (index: number) => void;
}

/**
 * Surfaces the auto-skipped image-hash duplicates with an explicit
 * "Re-extract anyway" override per slot. Mounted in EodBatchQueue only when
 * at least one slot has `status === 'duplicate'`.
 */
export function EodDuplicateBanner({ slots, onForceReExtract }: EodDuplicateBannerProps) {
  const dupCount = slots.filter((s) => s.status === 'duplicate').length;
  if (dupCount === 0) return null;

  return (
    <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-400 space-y-2">
      <div>{dupCount} sheet{dupCount !== 1 ? 's' : ''} already uploaded — skipped automatically.</div>
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
