import { AlertTriangle } from 'lucide-react';

interface Props {
  show: boolean;
}

/**
 * Emphatic "photo NOT saved" banner (Task 5/7) — rendered when a byte-quota
 * rejection blocked the last capture from being durably stored in IndexedDB.
 * The step stays un-captured (never green) until a retry succeeds. Renders
 * nothing when `show` is false — this is a hard failure, never a check.
 */
export function PhotoNotSavedBanner({ show }: Props) {
  if (!show) return null;
  return (
    <div role="alert" className="rounded-xl border-2 border-red-600 bg-red-950/60 px-4 py-3 text-sm text-red-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
        <div>
          <p className="font-semibold text-red-100">Photo not saved on this device</p>
          <p className="mt-0.5">Reconnect to free space, then retake this photo.</p>
        </div>
      </div>
    </div>
  );
}
