/**
 * Generic offline-write queue types. Generalised from the proven /my
 * attendance clock-event queue (src/modules/attendance/portal/client/offline/).
 * The load-bearing policies (conservative draining, dropped-record retention,
 * attempts + depth caps) live in store.ts / flush.ts; this file is the shared
 * vocabulary those modules and every consumer speak.
 */

/** One item awaiting sync. `payload` is the workflow-specific body. */
export interface QueuedItem<TPayload> {
  id: string;
  payload: TPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

/** A permanently-dropped item, retained on-device for user visibility/dispute. */
export interface DroppedItem<TPayload> extends QueuedItem<TPayload> {
  droppedAt: string;
  dropReason: string;
}

/**
 * Result of trying to submit one item.
 *
 * Contract: `drain: true` with NO `errorMessage` = success — the item is
 * removed from the queue entirely (NOT the dropped store). `drain: true`
 * WITH an `errorMessage` = permanent failure — the item is moved to the
 * dropped store for user visibility/dispute. `drain: false` = transient —
 * the item is kept and retried.
 *
 * This is load-bearing: a permanent-failure result MUST set a non-empty
 * `errorMessage`. The flush engine treats `drain: true` with an
 * empty/absent `errorMessage` as SUCCESS (item deleted), and `drain: true`
 * with a non-empty `errorMessage` as a permanent failure (item moved to the
 * dropped store).
 */
export interface SubmitResult {
  /** True → remove from pending (success OR permanent failure). */
  drain: boolean;
  /** Shown to the user AND persisted on the dropped row when `drain` is true. */
  errorMessage?: string;
}

export interface FlushReport {
  attempted: number;
  succeeded: number;
  drained: number;
  kept: number;
  failures: Array<{ id: string; message: string }>;
}

export interface FlushHooks {
  onSuccess: (id: string) => Promise<void>;
  onDrain: (id: string, reason: string) => Promise<void>;
  onTransient: (id: string, message: string) => Promise<void>;
  onAbandon: (id: string, reason: string) => Promise<void>;
}

/** Per-workflow configuration. One config == one IndexedDB database. */
export interface OfflineQueueConfig<TPayload> {
  /** Unique per workflow — becomes the IndexedDB database name. */
  queueName: string;
  /** Upper bound on pending depth. Default 50. */
  maxQueueSize?: number;
  /** Attempts before an item is abandoned to the dropped store. Default 10. */
  maxAttemptsBeforeDrain?: number;
  /** The network call. Return normally on success; throw on failure. */
  submit: (payload: TPayload) => Promise<void>;
  /** Map a thrown error to drain-vs-keep. Default: keep unless it's a known
   *  permanent failure (see defaultClassify in flush.ts). */
  classify?: (err: unknown, payload: TPayload) => SubmitResult;
}

export class QueueFullError extends Error {
  constructor(size: number) {
    super(`Offline queue is full (${size} items). Reconnect to sync before adding more.`);
    this.name = 'QueueFullError';
  }
}
