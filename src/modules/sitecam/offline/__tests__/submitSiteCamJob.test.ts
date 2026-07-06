import { describe, expect, it } from 'vitest';
import { QueueFullError, QuotaExceededError } from '@/lib/offline-queue';
import { blobToBase64, buildUploadPayload, classifySubmit } from '../submitSiteCamJob';
import type { SiteCamJobMeta, StoredStepPhoto } from '../photoStore';
import type { SiteInfo } from '../../lib/sitecamTypes';
import type { GeofencePayload } from '../../lib/geofence';

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

function jobMeta(over: Partial<SiteCamJobMeta> = {}): SiteCamJobMeta {
  return {
    siteInfo: SITE_INFO,
    clientSubmissionId: 'uuid-1234',
    submitState: 'capturing',
    ...over,
  };
}

function stepPhoto(stepNumber: number, bytes: number[], needsManualReview = false): StoredStepPhoto {
  return {
    stepNumber,
    photoBlob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    byteSize: bytes.length,
    needsManualReview,
    capturedAt: '2026-07-06T10:00:00.000Z',
  };
}

describe('blobToBase64', () => {
  it('round-trips known bytes as raw base64 (no data: prefix)', async () => {
    const bytes = [1, 2, 3, 250, 251, 252];
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });

    const base64 = await blobToBase64(blob);

    expect(base64.startsWith('data:')).toBe(false);
    const decoded = Array.from(Buffer.from(base64, 'base64'));
    expect(decoded).toEqual(bytes);
  });
});

describe('buildUploadPayload', () => {
  it('emits the exact /api/sitecam/upload shape plus clientSubmissionId', async () => {
    const meta = jobMeta();
    const photos = [stepPhoto(2, [9, 9]), stepPhoto(1, [1, 2, 3], true)];
    const geofence: GeofencePayload = {
      plannedLat: -26.1, plannedLon: 27.9, deviceLat: -26.1, deviceLon: 27.9,
      accuracyM: 5, status: 'on_site', distanceM: 2, submitLat: -26.1, submitLon: 27.9,
    };

    const payload = await buildUploadPayload(meta, photos, geofence);

    expect(payload.jobType).toBe('activations');
    expect(payload.siteId).toBe('DR1866766');
    expect(payload.clientSubmissionId).toBe('uuid-1234');
    expect(payload.geofence).toEqual(geofence);
    expect(payload.photos).toHaveLength(2);

    const step1 = payload.photos.find((p) => p.stepNumber === 1);
    expect(step1).toMatchObject({
      stepNumber: 1,
      stepLabel: 'House / Property Photo',
      filename: 'step-1.jpg',
      needsManualReview: true,
    });
    expect(Array.from(Buffer.from(step1!.base64, 'base64'))).toEqual([1, 2, 3]);

    const step2 = payload.photos.find((p) => p.stepNumber === 2);
    expect(step2).toMatchObject({ stepNumber: 2, stepLabel: 'Cable from Pole', filename: 'step-2.jpg', needsManualReview: false });
  });

  it('defaults geofence to null when omitted', async () => {
    const payload = await buildUploadPayload(jobMeta(), [stepPhoto(1, [1])]);
    expect(payload.geofence).toBeNull();
  });

  it('falls back to a generic label for an unknown step number', async () => {
    const payload = await buildUploadPayload(jobMeta(), [stepPhoto(999, [1])]);
    expect(payload.photos[0].stepLabel).toBe('Step 999');
  });
});

describe('classifySubmit', () => {
  it('offline with no quota error → queued', () => {
    expect(classifySubmit(false, undefined)).toBe('queued');
    expect(classifySubmit(false, new Error('anything'))).toBe('queued');
  });

  it('a network TypeError while online → queued (retry)', () => {
    expect(classifySubmit(true, new TypeError('Failed to fetch'))).toBe('queued');
  });

  it('QuotaExceededError → not_saved', () => {
    expect(classifySubmit(true, new QuotaExceededError(100, 50, 100, 'queue'))).toBe('not_saved');
  });

  it('QueueFullError → not_saved', () => {
    expect(classifySubmit(true, new QueueFullError(50))).toBe('not_saved');
  });

  it('a hard storage failure wins over connectivity: offline + QuotaExceededError → not_saved, not queued', () => {
    expect(classifySubmit(false, new QuotaExceededError(100, 50, 100, 'queue'))).toBe('not_saved');
    expect(classifySubmit(false, new QueueFullError(50))).toBe('not_saved');
  });

  it('a definitive 4xx → error', () => {
    expect(classifySubmit(true, { status: 404 })).toBe('error');
  });

  it('a 5xx while online → queued (retry)', () => {
    expect(classifySubmit(true, { status: 503 })).toBe('queued');
  });
});
