import { Clock } from 'lucide-react';

interface Props {
  photoCount: number;
  /** Non-null when the last flush attempt hit a definitive (non-retryable)
   *  failure — surfaced as a visible "couldn't submit" banner, never silent. */
  uploadError: string | null;
  flushing: boolean;
  onRetry: () => void;
}

/**
 * "Saved offline" screen (Task 6/7) — shown INSTEAD of the green
 * `SiteCamSuccess` screen once a submission is queued (offline, or a
 * transient failure while online) but not yet confirmed uploaded. Never
 * implies success — [[feedback_verify_before_confirm]]; a real "Submitted ✓"
 * only happens once the background flush actually clears the job, at which
 * point `SiteCamWizard` swaps to `SiteCamSuccess`.
 */
export function SiteCamOfflineStatus({ photoCount, uploadError, flushing, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-amber-700 bg-amber-950/30 px-4 py-8 text-center">
      <Clock className="h-10 w-10 text-amber-400" />
      <div>
        <h2 className="text-lg font-semibold text-amber-200">Saved offline</h2>
        <p className="mt-1 text-sm text-amber-300/90">
          Will submit automatically when you&apos;re back online.
        </p>
      </div>
      <p className="text-xs text-neutral-400">
        {photoCount} photo{photoCount !== 1 ? 's' : ''} saved on this device — waiting to sync.
      </p>

      {uploadError && (
        <div
          role="alert"
          className="w-full rounded-lg border-2 border-red-600 bg-red-950/60 px-4 py-3 text-left text-sm text-red-200"
        >
          <p className="font-semibold text-red-100">Couldn&apos;t submit</p>
          <p className="mt-0.5">{uploadError}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onRetry}
        disabled={flushing}
        className="w-full rounded-lg border border-amber-600 py-3 text-sm font-medium text-amber-200 hover:bg-amber-900/40 disabled:opacity-50"
      >
        {flushing ? 'Trying…' : 'Try again now'}
      </button>
    </div>
  );
}
