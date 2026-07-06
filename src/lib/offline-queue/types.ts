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
  /**
   * On-device size of this item in bytes, used by the byte-aware quota
   * (see `maxQueueBytes`). Written at enqueue from `OfflineQueueConfig.sizeOf`
   * (0 when the workflow declares no size — e.g. small-JSON queues). The store
   * sums this over pending rows; it is derived accounting, never authoritative.
   * Required going forward, but IndexedDB is schemaless: rows written before
   * this field existed may lack it, so read sites coalesce a missing value to 0.
   */
  byteSize: number;
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
  /**
   * Upper bound on total on-device bytes across pending items. When set, an
   * enqueue that would push `sum(byteSize) + incoming > maxQueueBytes` throws
   * `QuotaExceededError`. Undefined (the default, e.g. small-JSON queues) means
   * no byte cap — only the count cap applies. Coexists with `maxQueueSize`;
   * whichever trips first wins.
   */
  maxQueueBytes?: number;
  /**
   * Compute the on-device byte size of a payload, written to the queued item
   * so the byte budget can be enforced without decoding the payload again.
   * Omit for count-only queues (byteSize defaults to 0).
   */
  sizeOf?: (payload: TPayload) => number;
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

/** Which limit an enqueue tripped. `queue` = this queue's own byte budget
 *  (currentBytes/budgetBytes are queue-scoped). `device` = the browser's
 *  origin-wide storage estimate (currentBytes/budgetBytes are the device
 *  usage/quota, which may be far larger). The UI/logs must not conflate them. */
export type QuotaExceededKind = 'queue' | 'device';

/**
 * Thrown when an enqueue would exceed the per-queue byte budget (`maxQueueBytes`)
 * or the browser's projected storage estimate. Distinct from `QueueFullError`
 * (a count cap) so the UI can render photo-specific "not saved, sync to free
 * space" copy. Carries the raw byte figures for logging and UI messaging, and a
 * `kind` discriminant so a consumer can tell the queue-budget case (its own
 * bytes) apart from the device-storage case (origin-wide usage vs quota).
 */
export class QuotaExceededError extends Error {
  readonly currentBytes: number;
  readonly addBytes: number;
  readonly budgetBytes: number;
  readonly kind: QuotaExceededKind;
  constructor(
    currentBytes: number,
    addBytes: number,
    budgetBytes: number,
    kind: QuotaExceededKind = 'queue'
  ) {
    const detail =
      kind === 'device'
        ? `device storage nearly full: ${currentBytes} used + ${addBytes} incoming ` +
          `approaches the ${budgetBytes} byte device quota`
        : `offline queue byte budget exceeded: ${currentBytes} stored + ${addBytes} incoming ` +
          `exceeds the ${budgetBytes} byte budget`;
    super(`${detail}. Reconnect to sync before capturing more.`);
    this.name = 'QuotaExceededError';
    this.currentBytes = currentBytes;
    this.addBytes = addBytes;
    this.budgetBytes = budgetBytes;
    this.kind = kind;
  }
}
