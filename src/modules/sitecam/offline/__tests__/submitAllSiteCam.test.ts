import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptSiteCamSubmit } from '../submitAllSiteCam';
import { SiteCamPhotoStore } from '../photoStore';
import type { SiteInfo } from '../../hooks/useSiteCamCapture';
import { buildReading } from '../../lib/geofence';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// A Blob that round-trips through fake-indexeddb's structured-clone loses its
// `Blob` brand (becomes a plain object) — jsdom's real FileReader then rejects
// it as "parameter 1 is not of type 'Blob'". This is a fake-indexeddb/jsdom
// interop gotcha, not a production concern (real browsers' structured clone
// preserves Blob instances). Stub FileReader so `blobToBase64` (used inside
// `buildUploadPayload`) can decode a store-retrieved photo in tests — mirrors
// the MockFileReader already used in useSiteCamCapture.test.ts.
class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  readAsDataURL(_blob: unknown): void {
    this.result = 'data:image/jpeg;base64,RkFLRQ==';
    queueMicrotask(() => this.onload?.());
  }
}

let dbN = 0;
function freshStore(): SiteCamPhotoStore {
  return new SiteCamPhotoStore('activations', `SUB-${dbN++}`);
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

async function seedCapturingJob(store: SiteCamPhotoStore): Promise<void> {
  await store.putMeta({ siteInfo: SITE_INFO, clientSubmissionId: 'uuid-1', submitState: 'capturing' });
  await store.putStepPhoto({
    stepNumber: 1,
    photoBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    byteSize: 3,
    needsManualReview: false,
    capturedAt: '2026-07-06T10:00:00.000Z',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('attemptSiteCamSubmit', () => {
  it('returns "idle" when no job meta exists yet', async () => {
    const store = freshStore();
    const result = await attemptSiteCamSubmit(store, null, { online: true });
    expect(result).toEqual({ outcome: 'idle' });
  });

  it('offline: marks the store queued and returns "queued" without attempting a fetch', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    const fetchImpl = vi.fn();

    const result = await attemptSiteCamSubmit(store, null, { online: false, fetchImpl });

    expect(result).toEqual({ outcome: 'queued' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const meta = await store.getMeta();
    expect(meta?.submitState).toBe('queued');
  });

  it('online 2xx: POSTs clientSubmissionId, clears the store, and returns "submitted"', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    let posted: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(init?.body as string);
      return jsonResponse({ data: { uploadedCount: 1 } });
    });

    const result = await attemptSiteCamSubmit(store, null, { online: true, fetchImpl });

    expect(result).toEqual({ outcome: 'submitted', uploadedCount: 1 });
    expect(posted.clientSubmissionId).toBe('uuid-1');
    expect(posted.jobType).toBe('activations');
    expect(await store.getMeta()).toBeNull();
    expect(await store.listStepPhotos()).toHaveLength(0);
  });

  it('online 5xx: marks queued for retry, does not clear the store', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));

    const result = await attemptSiteCamSubmit(store, null, { online: true, fetchImpl });

    expect(result).toEqual({ outcome: 'queued' });
    expect((await store.getMeta())?.submitState).toBe('queued');
    expect(await store.listStepPhotos()).toHaveLength(1);
  });

  it('online definitive 4xx: returns "error" with the response text, keeps the job intact', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    const fetchImpl = vi.fn(async () => new Response('Site not found', { status: 404 }));

    const result = await attemptSiteCamSubmit(store, null, { online: true, fetchImpl });

    expect(result).toEqual({ outcome: 'error', message: 'Site not found' });
    expect((await store.getMeta())?.submitState).toBe('capturing');
  });

  it('online network throw: marks queued for retry (transient)', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });

    const result = await attemptSiteCamSubmit(store, null, { online: true, fetchImpl });

    expect(result).toEqual({ outcome: 'queued' });
  });

  it('reads a fresh device location for the entry geofence and stamps submitLat/Lon', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    const entryReading = buildReading({
      plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5,
    });
    let posted: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(init?.body as string);
      return jsonResponse({ data: { uploadedCount: 1 } });
    });
    const readLocation = vi.fn(async () => ({ lat: -26.2, lon: 27.6, accuracy: 9 }));

    await attemptSiteCamSubmit(store, entryReading, { online: true, fetchImpl, readLocation });

    expect(posted.geofence).toMatchObject({ submitLat: -26.2, submitLon: 27.6, status: 'out_of_range' });
  });

  it('sends a null geofence when there is no entry reading', async () => {
    const store = freshStore();
    await seedCapturingJob(store);
    let posted: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posted = JSON.parse(init?.body as string);
      return jsonResponse({ data: { uploadedCount: 1 } });
    });

    await attemptSiteCamSubmit(store, null, { online: true, fetchImpl });

    expect(posted.geofence).toBeNull();
  });
});
