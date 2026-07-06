/**
 * Emphatic photo-failure banners for the public snag/resolve page.
 *
 * Two distinct failure surfaces the tech must never miss (a re-captured photo is
 * expensive on site):
 *   - `notSaved`: the capture was neither uploaded nor even queued (quota/queue
 *     full, or an undecodable image). Dismissible.
 *   - `dropped`: a queued photo the server PERMANENTLY rejected on flush (e.g.
 *     the step was already completed elsewhere). Retained on-device by the queue
 *     and surfaced here per spec R5 — never a silent drop. Each is acknowledged
 *     individually.
 *
 * Renders nothing when there is no failure.
 */

import { AlertTriangle } from 'lucide-react';
import type { DroppedItem } from '@/lib/offline-queue';
import type { PendingSnagPhoto } from './offline/photoQueue';

interface Props {
  notSaved: string | null;
  onClearNotSaved: () => void;
  dropped: DroppedItem<PendingSnagPhoto>[];
  onAcknowledgeDropped: (id: string) => void;
}

const BANNER_CLASS = 'mb-4 rounded-md bg-red-950/60 border-2 border-red-600 px-4 py-3 text-xs text-red-200';

export function PhotoFailureBanners({ notSaved, onClearNotSaved, dropped, onAcknowledgeDropped }: Props) {
  if (!notSaved && dropped.length === 0) return null;
  return (
    <>
      {notSaved && (
        <div role="alert" className={BANNER_CLASS}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-semibold text-red-100">Photo NOT saved</p>
              <p className="mt-0.5">{notSaved}</p>
            </div>
            <button
              type="button"
              onClick={onClearNotSaved}
              className="text-red-400 hover:text-red-200 font-medium"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {dropped.map((item) => (
        <div role="alert" key={item.id} className={BANNER_CLASS}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-semibold text-red-100">Photo rejected — not uploaded</p>
              <p className="mt-0.5">
                {item.payload.slotKey ? `Slot "${item.payload.slotKey}"` : 'Photo'} was rejected by the
                server and was NOT stored: {item.dropReason} You may need to retake it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAcknowledgeDropped(item.id)}
              className="text-red-400 hover:text-red-200 font-medium"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
