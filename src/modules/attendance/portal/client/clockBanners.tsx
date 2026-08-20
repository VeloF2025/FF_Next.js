/**
 * Banner-style components for /my/attendance/clock. Split out from
 * clockSteps so each file stays focused and under the line cap.
 */

import { CheckCircle, XCircle } from 'lucide-react';

export function QueueUnavailableBanner() {
  return (
    <div className="rounded-lg bg-red-950/40 border border-red-800 px-3 py-2 text-sm text-red-200 mb-3 flex items-start gap-2">
      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>
        <div className="font-semibold">Offline storage unavailable on this device.</div>
        <div className="text-xs mt-0.5">
          Clock events cannot be saved while offline. Contact IT — you may be
          in private-browsing mode or the app storage is full.
        </div>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div className="rounded-lg bg-yellow-950/40 border border-yellow-800 px-3 py-2 text-sm text-yellow-200 mb-3">
      You are offline. Your clock event will be saved on this device and
      synced automatically when you have signal.
    </div>
  );
}

export function PendingQueueBanner({
  pendingCount,
  online,
  syncing,
  onSyncNow,
}: {
  pendingCount: number;
  online: boolean;
  syncing: boolean;
  onSyncNow: () => void;
}) {
  return (
    <div className="rounded-lg bg-blue-950/40 border border-blue-800 px-3 py-2 text-sm text-blue-200 mb-3 flex items-center justify-between">
      <span>
        {pendingCount} event{pendingCount === 1 ? '' : 's'} queued for sync.
      </span>
      {online && (
        <button
          type="button"
          onClick={onSyncNow}
          disabled={syncing}
          className="font-medium underline disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  );
}

export function QueueSyncIssuesBanner({ failureCount }: { failureCount: number }) {
  return (
    <div className="rounded-lg bg-amber-950/40 border border-amber-800 px-3 py-2 text-sm text-amber-200 mb-3">
      {failureCount} other queued event{failureCount === 1 ? '' : 's'}{' '}
      {failureCount === 1 ? 'was' : 'were'} not submitted.
    </div>
  );
}

/**
 * Shown above the inline H&S declaration, between a committed clock-in and the
 * full SuccessView.
 *
 * Deliberately NOT SuccessView: that view carries a Done button, and offering
 * an exit here would let a worker leave before declaring — the exact gap this
 * flow closes. This is a statement that the shift is recorded, nothing more,
 * so a worker whose declaration stalls or fails is never left wondering
 * whether they are on the clock.
 */
export function ClockInRecordedBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-lg bg-emerald-950/40 border border-emerald-800 px-3 py-2 mb-3 flex items-start gap-2 text-emerald-200"
    >
      <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>
        <div className="text-sm font-semibold">{message}</div>
        <div className="text-xs mt-0.5 text-emerald-300/80">
          Your time is recorded. A few safety questions to finish.
        </div>
      </div>
    </div>
  );
}
