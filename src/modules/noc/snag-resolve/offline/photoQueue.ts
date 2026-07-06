/**
 * Offline queue vocabulary for snag verification-step photos.
 *
 * One IndexedDB database per share token (`SnagPhotoDB:<token>`) so a device
 * resolving several snags can't mix queues — mirrors the Phase-0
 * `SnagCompleteDB:<token>` isolation. The payload stores the downscaled JPEG
 * **Blob** natively (IndexedDB structured-clone handles Blobs; −33 % vs base64),
 * plus the `clientUploadId` the server dedupes retries on (migration 438).
 */

/** Byte budget for the on-device photo queue (spec O2 — tunable). ~50 × 500 KB
 *  downscaled photos with headroom. */
export const SNAG_PHOTO_MAX_QUEUE_BYTES = 40 * 1024 * 1024;
/** Count cap (coexists with the byte budget; whichever trips first wins). */
export const SNAG_PHOTO_MAX_QUEUE_SIZE = 50;

/** Per-token IndexedDB database name for the photo queue. */
export function snagPhotoQueueName(token: string): string {
  return `SnagPhotoDB:${token}`;
}

/** Byte-size accessor for the queue's `sizeOf`. Module-scoped so its identity is
 *  stable across renders (an inline closure would churn the hook's enqueue/
 *  handler identities — mirrors the offline-queue lib's own `defaultClassifyFn`). */
export const sizeOfSnagPhoto = (p: PendingSnagPhoto): number => p.byteSize;

/** One queued snag photo awaiting upload. `photoBlob` is stored natively. */
export interface PendingSnagPhoto {
  token: string;
  stepId: string;
  slotKey?: string;
  actorId?: string;
  /** UUID minted at capture, reused on every retry → server-side idempotency. */
  clientUploadId: string;
  photoBlob: Blob;
  filename: string;
  mimeType: string;
  /** Size of `photoBlob` — the byte budget is enforced from this. */
  byteSize: number;
  capturedAt: string;
}
