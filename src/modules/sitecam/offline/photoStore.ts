/**
 * Per-job SiteCam offline photo store — a KEYED IndexedDB database (one row
 * per step, upserted by `stepNumber`), NOT the FIFO `OfflineQueueStore` from
 * `src/lib/offline-queue`. SiteCam's in-progress capture is a mutable job
 * document (steps re-captured, then batch-submitted), so this reuses only the
 * shared lib's byte-quota + `QuotaExceededError` vocabulary, not its store
 * shape. Mirrors `src/lib/offline-queue/store.ts`'s transaction discipline
 * (derived byte-sum via cursor, never a persisted counter).
 */

import { QuotaExceededError } from '@/lib/offline-queue';
import type { SiteCamJobType } from '../lib/sitecamSteps';
import type { SiteInfo } from '../hooks/useSiteCamCapture';

const PHOTOS = 'photos';
const META = 'meta';
/** Fixed key for the single job-meta record — the `meta` store is not keyed
 *  by keyPath, so every read/write addresses this literal key. */
const META_KEY = 'job';
const DB_VERSION = 1;

/** One job ≈ 3.6–7.5 MB of watermarked JPEG Blobs (8–12 steps); generous
 *  headroom over that before an over-budget capture is refused. Tunable. */
export const SITECAM_JOB_MAX_BYTES = 20 * 1024 * 1024;

/** Reject a write once the browser's projected storage usage would cross this
 *  fraction of its quota — mirrors `src/lib/offline-queue/store.ts`'s soft
 *  guard, applied here per-write since a job store has no enqueue-time cap. */
const STORAGE_SAFETY_FRACTION = 0.8;

/** Per-job IndexedDB database name — namespaced by job type + site so
 *  activations vs civils of the same site cannot collide, mirroring the
 *  existing draft key `sitecam:draft:v1:<jobType>:<siteId>`. */
export function sitecamJobDbName(jobType: SiteCamJobType, siteId: string): string {
  return `SiteCamJobDB:${jobType}:${siteId}`;
}

/** One captured step photo, persisted as a native Blob (IndexedDB structured
 *  clone handles Blobs directly — −33% vs base64 at rest). */
export interface StoredStepPhoto {
  stepNumber: number;
  photoBlob: Blob;
  /** Size of `photoBlob` — the byte budget is enforced from this. */
  byteSize: number;
  /** Photo auto-passed because the VLM was unavailable — flagged for manual QA. */
  needsManualReview: boolean;
  capturedAt: string;
}

/** The single per-job metadata record. */
export interface SiteCamJobMeta {
  siteInfo: SiteInfo;
  /** UUID minted once when the job's store is first created — the flush's
   *  idempotency key. */
  clientSubmissionId: string;
  submitState: 'capturing' | 'queued';
  queuedAt?: string;
}

/** Best-effort read of the browser's storage estimate. Returns null when the
 *  API is absent or throws — the caller treats that as "byte-budget check
 *  only", never as a hard block that would strand a legitimate photo. */
async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return null;
    const { usage, quota } = await storage.estimate();
    if (typeof usage === 'number' && typeof quota === 'number') return { usage, quota };
  } catch {
    // API unavailable / rejected — fall through to "unavailable".
  }
  return null;
}

export class SiteCamPhotoStore {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(jobType: SiteCamJobType, siteId: string) {
    this.dbName = sitecamJobDbName(jobType, siteId);
  }

  private openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable in this environment'));
    }
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTOS)) {
          db.createObjectStore(PHOTOS, { keyPath: 'stepNumber' });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onblocked = () => reject(new Error('IDB open blocked — another tab holds an older version'));
    });
    return this.dbPromise;
  }

  private tx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          let result: T;
          Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error ?? new Error('IDB tx failed'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IDB tx aborted'));
        }),
    );
  }

  private req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
  }

  /**
   * Upsert one step's photo, keyed by `stepNumber` — a re-capture overwrites
   * the same row (no orphan Blobs). Byte-budget guarded: the running total is
   * derived by cursor over the CURRENT rows (never a second source of truth),
   * excluding the row being replaced so a re-capture of the same step is never
   * double-counted against its own prior bytes.
   */
  async putStepPhoto(photo: StoredStepPhoto): Promise<void> {
    // Best-effort device-pressure guard BEFORE the atomic write — calls the
    // Storage API (not IndexedDB), so it cannot live inside the transaction
    // below without risking the transaction auto-committing while awaited.
    const est = await estimateStorage();
    if (est && est.quota > 0 && (est.usage + photo.byteSize) / est.quota > STORAGE_SAFETY_FRACTION) {
      throw new QuotaExceededError(est.usage, photo.byteSize, est.quota, 'device');
    }

    await this.tx(
      PHOTOS,
      'readwrite',
      (store) =>
        new Promise<void>((resolve, reject) => {
          let total = 0;
          const cursorReq = store.openCursor();
          cursorReq.onerror = () => reject(cursorReq.error ?? new Error('IDB cursor failed'));
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const row = cursor.value as StoredStepPhoto;
              if (row.stepNumber !== photo.stepNumber) total += row.byteSize ?? 0;
              cursor.continue();
              return;
            }
            if (total + photo.byteSize > SITECAM_JOB_MAX_BYTES) {
              reject(new QuotaExceededError(total, photo.byteSize, SITECAM_JOB_MAX_BYTES, 'queue'));
              return;
            }
            const putReq = store.put(photo);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error ?? new Error('IDB put failed'));
          };
        }),
    );
  }

  /** All captured step photos, ordered by `stepNumber`. */
  async listStepPhotos(): Promise<StoredStepPhoto[]> {
    return this.tx(PHOTOS, 'readonly', async (store) => {
      const rows = await this.req(store.getAll() as IDBRequest<StoredStepPhoto[]>);
      return rows.sort((a, b) => a.stepNumber - b.stepNumber);
    });
  }

  async putMeta(meta: SiteCamJobMeta): Promise<void> {
    await this.tx(META, 'readwrite', (store) => this.req(store.put(meta, META_KEY)));
  }

  async getMeta(): Promise<SiteCamJobMeta | null> {
    return this.tx(META, 'readonly', async (store) => {
      const result = await this.req(store.get(META_KEY) as IDBRequest<SiteCamJobMeta | undefined>);
      return result ?? null;
    });
  }

  /** Empties both object stores — called once a submission has flushed. */
  async clear(): Promise<void> {
    await this.tx(PHOTOS, 'readwrite', (store) => this.req(store.clear()));
    await this.tx(META, 'readwrite', (store) => this.req(store.clear()));
  }
}
