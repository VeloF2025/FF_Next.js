import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteCamPhotoStore, sitecamJobDbName, SITECAM_JOB_MAX_BYTES, type SiteCamJobMeta, type StoredStepPhoto } from '../photoStore';
import { QuotaExceededError } from '@/lib/offline-queue';
import type { SiteInfo } from '../../hooks/useSiteCamCapture';

let dbN = 0;

/** Fresh store per test — a unique siteId keeps IndexedDB databases isolated
 *  (mirrors src/lib/offline-queue/__tests__/store.test.ts). */
function freshStore(): SiteCamPhotoStore {
  return new SiteCamPhotoStore('activations', `SITE-${dbN++}`);
}

function photo(stepNumber: number, byteSize: number, over: Partial<StoredStepPhoto> = {}): StoredStepPhoto {
  return {
    stepNumber,
    photoBlob: new Blob([new Uint8Array(byteSize)], { type: 'image/jpeg' }),
    byteSize,
    needsManualReview: false,
    capturedAt: '2026-07-06T10:00:00.000Z',
    ...over,
  };
}

const SITE_INFO: SiteInfo = {
  jobType: 'activations',
  siteId: 'DR1866766',
  customerName: 'Jane Tech',
  address: '1 Main Rd',
  projectName: 'Lawley',
  plannedLat: -26.1,
  plannedLon: 27.9,
  pon: 3,
  zone: 12,
};

function meta(over: Partial<SiteCamJobMeta> = {}): SiteCamJobMeta {
  return {
    siteInfo: SITE_INFO,
    clientSubmissionId: 'uuid-1',
    submitState: 'capturing',
    ...over,
  };
}

/** Install a navigator.storage.estimate stub (or absence) for one test. */
function stubStorageEstimate(value: { usage: number; quota: number } | undefined): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: value ? { estimate: vi.fn().mockResolvedValue(value) } : undefined,
  });
}

afterEach(() => {
  stubStorageEstimate(undefined);
  vi.restoreAllMocks();
});

describe('sitecamJobDbName', () => {
  it('namespaces by job type + site id', () => {
    expect(sitecamJobDbName('activations', 'DR1866766')).toBe('SiteCamJobDB:activations:DR1866766');
    expect(sitecamJobDbName('civils', 'POLE-1')).toBe('SiteCamJobDB:civils:POLE-1');
  });
});

describe('SiteCamPhotoStore — step photos', () => {
  it('putStepPhoto for two different steps → listStepPhotos returns both, sorted', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(2, 100));
    await store.putStepPhoto(photo(1, 100));

    const rows = await store.listStepPhotos();
    expect(rows.map((r) => r.stepNumber)).toEqual([1, 2]);
  });

  it('re-putting the same stepNumber upserts — list stays length 1 with the new blob', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(1, 100, { needsManualReview: false }));
    await store.putStepPhoto(photo(1, 150, { needsManualReview: true }));

    const rows = await store.listStepPhotos();
    expect(rows).toHaveLength(1);
    expect(rows[0].byteSize).toBe(150);
    expect(rows[0].needsManualReview).toBe(true);
  });

  it('throws QuotaExceededError (kind "queue") when an incoming photo would exceed the job byte budget', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(1, SITECAM_JOB_MAX_BYTES - 100));
    await expect(store.putStepPhoto(photo(2, 200))).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(store.putStepPhoto(photo(2, 200))).rejects.toMatchObject({ kind: 'queue' });
    // The rejected photo must NOT have been written.
    expect(await store.listStepPhotos()).toHaveLength(1);
  });

  it('allows an at-budget put and rejects one byte over', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(1, SITECAM_JOB_MAX_BYTES)); // exactly at budget
    await expect(store.putStepPhoto(photo(2, 1))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('re-capturing the same step near the budget is never double-counted against its own prior bytes', async () => {
    const store = freshStore();
    const big = SITECAM_JOB_MAX_BYTES - 100;
    await store.putStepPhoto(photo(1, big));
    // Re-capturing step 1 again (slightly larger, still within budget) must not
    // be rejected just because the cursor sum still includes the old row.
    await store.putStepPhoto(photo(1, big + 50));
    const rows = await store.listStepPhotos();
    expect(rows).toHaveLength(1);
    expect(rows[0].byteSize).toBe(big + 50);
  });

  it('never hard-blocks when navigator.storage.estimate is unavailable (byte-budget only)', async () => {
    stubStorageEstimate(undefined);
    const store = freshStore();
    await store.putStepPhoto(photo(1, 500));
    expect(await store.listStepPhotos()).toHaveLength(1);
  });

  it('tags a device-storage-pressure rejection with kind "device"', async () => {
    stubStorageEstimate({ usage: 900, quota: 1000 }); // (900+500)/1000 = 1.4 > 0.8
    const store = freshStore();
    await expect(store.putStepPhoto(photo(1, 500))).rejects.toMatchObject({
      name: 'QuotaExceededError',
      kind: 'device',
    });
  });
});

describe('SiteCamPhotoStore — job meta', () => {
  it('getMeta before any putMeta → null', async () => {
    const store = freshStore();
    expect(await store.getMeta()).toBeNull();
  });

  it('putMeta then getMeta round-trips clientSubmissionId and submitState', async () => {
    const store = freshStore();
    await store.putMeta(meta({ clientSubmissionId: 'uuid-abc', submitState: 'queued', queuedAt: '2026-07-06T10:05:00.000Z' }));

    const result = await store.getMeta();
    expect(result?.clientSubmissionId).toBe('uuid-abc');
    expect(result?.submitState).toBe('queued');
    expect(result?.queuedAt).toBe('2026-07-06T10:05:00.000Z');
    expect(result?.siteInfo.siteId).toBe(SITE_INFO.siteId);
  });
});

describe('SiteCamPhotoStore — clear', () => {
  it('clear empties both the photos and meta stores', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(1, 100));
    await store.putMeta(meta());

    await store.clear();

    expect(await store.listStepPhotos()).toHaveLength(0);
    expect(await store.getMeta()).toBeNull();
  });

  // clear() runs both object-store clears in a SINGLE IndexedDB transaction
  // (not two sequential ones) so a crash/tab-close mid-clear can never leave
  // `photos` emptied with a stale `meta` (e.g. submitState:'queued' surviving
  // with no photos behind it, which restore-on-mount would misread).
  it('clear empties multiple step photos and meta together (single-transaction discipline)', async () => {
    const store = freshStore();
    await store.putStepPhoto(photo(1, 100));
    await store.putStepPhoto(photo(2, 100));
    await store.putStepPhoto(photo(3, 100));
    await store.putMeta(meta({ submitState: 'queued', queuedAt: '2026-07-06T10:05:00.000Z' }));

    await store.clear();

    expect(await store.listStepPhotos()).toEqual([]);
    expect(await store.getMeta()).toBeNull();
  });
});
