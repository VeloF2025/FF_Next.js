/**
 * Small "queued offline" indicator for the public snag/resolve page.
 *
 * The offline pilot queues `complete_step` actions in IndexedDB while the
 * device is offline and flushes them on reconnect (see useSnagResolve +
 * useOfflineQueue). Without any UI, a subcontractor who taps "Mark Complete"
 * offline gets no feedback that the action was saved. This badge surfaces the
 * pending count so they know the work is stored and will sync.
 *
 * Renders nothing when there is nothing queued.
 */

import { Clock } from 'lucide-react';

export function PendingSyncIndicator({ count }: { count: number }) {
  if (count <= 0) return null;
  const noun = count === 1 ? 'step completion' : 'step completions';
  return (
    <div
      role="status"
      className="mb-4 inline-flex items-center gap-2 rounded-md bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-xs text-amber-300"
    >
      <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span>
        {count} {noun} saved on this device — will sync automatically when you&apos;re back online.
      </span>
    </div>
  );
}
