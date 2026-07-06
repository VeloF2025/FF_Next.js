/**
 * "Queued offline" indicators for the public snag/resolve page.
 *
 * The offline queues store `complete_step` actions AND verification-step photos
 * in IndexedDB while the device is offline, then flush on reconnect (see
 * useSnagResolve + useOfflineQueue). Without any UI, a subcontractor who taps
 * "Mark Complete" or captures a photo offline gets no feedback that the work
 * was saved. These badges surface the pending counts so they know it is stored
 * and will sync — a queued photo deliberately does NOT show as an uploaded
 * (green) tile, so this badge is the only signal it is safe.
 *
 * Renders nothing when there is nothing queued.
 */

import { Clock, Camera } from 'lucide-react';

const BADGE_CLASS =
  'inline-flex items-center gap-2 rounded-md bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-xs text-amber-300';

export function PendingSyncIndicator({ count, photoCount = 0 }: { count: number; photoCount?: number }) {
  if (count <= 0 && photoCount <= 0) return null;
  const stepNoun = count === 1 ? 'step completion' : 'step completions';
  const photoNoun = photoCount === 1 ? 'photo' : 'photos';
  return (
    <div className="mb-4 flex flex-col gap-2">
      {count > 0 && (
        <div role="status" className={BADGE_CLASS}>
          <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {count} {stepNoun} saved on this device — will sync automatically when you&apos;re back online.
          </span>
        </div>
      )}
      {photoCount > 0 && (
        <div role="status" className={BADGE_CLASS}>
          <Camera className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {photoCount} {photoNoun} saved on this device — will upload automatically when you&apos;re back online.
          </span>
        </div>
      )}
    </div>
  );
}
