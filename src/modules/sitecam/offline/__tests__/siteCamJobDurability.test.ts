import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeStoredPhotos,
  ensureSiteCamJobMeta,
  mergeHydratedPhotos,
  newClientSubmissionId,
  persistCapturedPhoto,
} from '../siteCamJobDurability';
import { SiteCamPhotoStore, type StoredStepPhoto } from '../photoStore';
import { QuotaExceededError } from '@/lib/offline-queue';
import type { SiteInfo, StepState } from '../../lib/sitecamTypes';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let dbN = 0;
function freshStore(): SiteCamPhotoStore {
  return new SiteCamPhotoStore('staff-1', 'activations', `DUR-${dbN++}`);
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

function stepFixture(num: number, over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: num, label: `Step ${num}`, hasVlm: true, hasSerialScan: false,
    serialLabel: '', serialDevice: null, serialAttempts: 0, serialScanned: null,
    status: 'pending', photoBase64: null, attemptNumber: 0, failReasons: [],
    corrections: [], needsManualReview: false, ...over,
  };
}

function storedPhoto(stepNumber: number, bytes: number[]): StoredStepPhoto {
  return {
    stepNumber,
    photoBlob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    byteSize: bytes.length,
    needsManualReview: false,
    capturedAt: '2026-07-06T10:00:00.000Z',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newClientSubmissionId', () => {
  it('returns a non-empty string, unique across calls', () => {
    const a = newClientSubmissionId();
    const b = newClientSubmissionId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('ensureSiteCamJobMeta', () => {
  it('mints and persists fresh meta when none exists', async () => {
    const store = freshStore();
    const meta = await ensureSiteCamJobMeta(store, SITE_INFO);

    expect(meta.siteInfo).toEqual(SITE_INFO);
    expect(meta.submitState).toBe('capturing');
    expect(meta.clientSubmissionId.length).toBeGreaterThan(0);

    const persisted = await store.getMeta();
    expect(persisted?.clientSubmissionId).toBe(meta.clientSubmissionId);
  });

  it('reuses existing meta (stable clientSubmissionId) rather than overwriting it', async () => {
    const store = freshStore();
    const first = await ensureSiteCamJobMeta(store, SITE_INFO);
    const second = await ensureSiteCamJobMeta(store, SITE_INFO);

    expect(second.clientSubmissionId).toBe(first.clientSubmissionId);
  });

  it('does not clobber an already-queued submitState', async () => {
    const store = freshStore();
    const first = await ensureSiteCamJobMeta(store, SITE_INFO);
    await store.putMeta({ ...first, submitState: 'queued', queuedAt: '2026-07-06T11:00:00.000Z' });

    const second = await ensureSiteCamJobMeta(store, SITE_INFO);
    expect(second.submitState).toBe('queued');
  });
});

describe('persistCapturedPhoto', () => {
  it('writes the photo and returns "ok"', async () => {
    const store = freshStore();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

    const result = await persistCapturedPhoto(store, 1, blob, false);

    expect(result).toBe('ok');
    const rows = await store.listStepPhotos();
    expect(rows).toHaveLength(1);
    expect(rows[0].byteSize).toBe(3);
    expect(rows[0].needsManualReview).toBe(false);
  });

  it('returns "quota_exceeded" and writes nothing when the store rejects with QuotaExceededError', async () => {
    const store = freshStore();
    vi.spyOn(SiteCamPhotoStore.prototype, 'putStepPhoto').mockRejectedValue(
      new QuotaExceededError(100, 50, 100, 'queue'),
    );

    const result = await persistCapturedPhoto(store, 1, new Blob(['x']), false);

    expect(result).toBe('quota_exceeded');
  });

  it('fails open (returns "ok") on a non-quota store error — durability must never block capture', async () => {
    const store = freshStore();
    vi.spyOn(SiteCamPhotoStore.prototype, 'putStepPhoto').mockRejectedValue(
      new Error('IndexedDB unavailable in this environment'),
    );

    const result = await persistCapturedPhoto(store, 1, new Blob(['x']), false);

    expect(result).toBe('ok');
  });
});

describe('decodeStoredPhotos', () => {
  it('decodes every stored photo to base64, keyed by stepNumber', async () => {
    const photos = [storedPhoto(2, [9, 9]), storedPhoto(1, [1, 2, 3])];

    const decoded = await decodeStoredPhotos(photos);

    expect(Array.from(Buffer.from(decoded.get(1)!, 'base64'))).toEqual([1, 2, 3]);
    expect(Array.from(Buffer.from(decoded.get(2)!, 'base64'))).toEqual([9, 9]);
  });

  it('skips a photo whose blob cannot be decoded rather than throwing', async () => {
    const bad = storedPhoto(1, [1]);
    // Force FileReader to fail for this one blob.
    const originalFileReader = globalThis.FileReader;
    class FailingReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      error = new Error('decode failed');
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('FileReader', FailingReader as unknown as typeof FileReader);

    const decoded = await decodeStoredPhotos([bad]);
    expect(decoded.size).toBe(0);

    vi.stubGlobal('FileReader', originalFileReader);
  });
});

describe('mergeHydratedPhotos', () => {
  it('fills photoBase64 for a captured step whose photo was stripped', () => {
    const states = [stepFixture(1, { status: 'pass', photoBase64: null })];
    const decoded = new Map([[1, 'QUJD']]);

    const result = mergeHydratedPhotos(states, decoded);

    expect(result[0].photoBase64).toBe('QUJD');
  });

  it('leaves a pending step untouched even if a decoded entry exists', () => {
    const states = [stepFixture(1, { status: 'pending', photoBase64: null })];
    const decoded = new Map([[1, 'QUJD']]);

    const result = mergeHydratedPhotos(states, decoded);

    expect(result[0].photoBase64).toBeNull();
  });

  it('never overwrites a step that already carries a live photoBase64 (race-safety)', () => {
    const states = [stepFixture(1, { status: 'pass', photoBase64: 'LIVE_VALUE' })];
    const decoded = new Map([[1, 'STALE_RESTORED_VALUE']]);

    const result = mergeHydratedPhotos(states, decoded);

    expect(result[0].photoBase64).toBe('LIVE_VALUE');
  });

  it('leaves a step untouched when there is no matching decoded entry', () => {
    const states = [stepFixture(1, { status: 'pass', photoBase64: null })];

    const result = mergeHydratedPhotos(states, new Map());

    expect(result[0].photoBase64).toBeNull();
  });
});
