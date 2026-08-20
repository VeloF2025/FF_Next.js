'use client';

/**
 * ScanNoticeBanner — dismissible amber banner above the scan list.
 *
 * Carries the messages that are not about one serial: the wrong carton square
 * was scanned, the box read short of its declared quantity, the code held more
 * serials than one scan allows, or the stock ledger disagrees with the shelf.
 *
 * None of these block the handout — they tell the storeman what happened.
 */

export interface ScanNoticeBannerProps {
  notice: string;
  onDismiss: () => void;
}

export function ScanNoticeBanner({ notice, onDismiss }: ScanNoticeBannerProps) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800">
      <p className="flex-1 text-xs text-amber-200">{notice}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-amber-400 hover:text-amber-200 text-xs"
      >
        ✕
      </button>
    </div>
  );
}
