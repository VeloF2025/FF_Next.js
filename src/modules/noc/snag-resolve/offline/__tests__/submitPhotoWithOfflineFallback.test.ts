import { describe, expect, it, vi } from 'vitest';
import { submitPhotoWithOfflineFallback, type SnagPhotoCapture } from '../submitPhotoWithOfflineFallback';
import { QuotaExceededError, QueueFullError } from '@/lib/offline-queue';
import type { PendingSnagPhoto } from '../photoQueue';

function capture(overrides: Partial<SnagPhotoCapture> = {}): SnagPhotoCapture {
  return {
    token: 'tok',
    stepId: 'step-1',
    slotKey: 'front',
    actorId: 'actor-1',
    file: new File([new Uint8Array(5_000_000)], 'huge.jpg', { type: 'image/jpeg' }),
    ...overrides,
  };
}

const downscaled = new Blob([new Uint8Array(300_000)], { type: 'image/jpeg' });

function deps(overrides: Record<string, unknown> = {}) {
  return {
    online: true,
    enqueue: vi.fn(async (_p: PendingSnagPhoto) => {}),
    submitOnline: vi.fn(async (_p: PendingSnagPhoto) => {}),
    downscale: vi.fn(async (_f: File) => downscaled),
    newId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ...overrides,
  };
}

describe('submitPhotoWithOfflineFallback', () => {
  it('offline → downscales, enqueues the blob, returns queued', async () => {
    const d = deps({ online: false });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result).toEqual({ kind: 'queued' });
    expect(d.downscale).toHaveBeenCalledOnce();
    expect(d.submitOnline).not.toHaveBeenCalled();
    const queued = d.enqueue.mock.calls[0][0] as PendingSnagPhoto;
    expect(queued.photoBlob).toBe(downscaled);
    expect(queued.byteSize).toBe(downscaled.size);
    expect(queued.clientUploadId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(queued.stepId).toBe('step-1');
    expect(queued.slotKey).toBe('front');
  });

  it('online 2xx → submitted, uploads the ORIGINAL file, never enqueues', async () => {
    const d = deps();
    const cap = capture();
    const result = await submitPhotoWithOfflineFallback(cap, d);
    expect(result).toEqual({ kind: 'submitted' });
    const uploaded = d.submitOnline.mock.calls[0][0] as PendingSnagPhoto;
    expect(uploaded.photoBlob).toBe(cap.file); // original, not downscaled
    expect(uploaded.clientUploadId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.downscale).not.toHaveBeenCalled();
  });

  it('online but the request fails with no HTTP status (network) → falls back to queued', async () => {
    const d = deps({ submitOnline: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result).toEqual({ kind: 'queued' });
    expect(d.downscale).toHaveBeenCalledOnce();
    expect(d.enqueue).toHaveBeenCalledOnce();
  });

  it('online HTTP error (has .status) → error, does NOT queue', async () => {
    const httpErr = Object.assign(new Error('conflict'), { status: 409 });
    const d = deps({ submitOnline: vi.fn(async () => { throw httpErr; }) });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result.kind).toBe('error');
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('quota exceeded on enqueue → not_saved (emphatic), never queued/submitted', async () => {
    const d = deps({
      online: false,
      enqueue: vi.fn(async () => { throw new QuotaExceededError(40_000_000, 300_000, 40_000_000, 'queue'); }),
    });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result.kind).toBe('not_saved');
    expect((result as { message: string }).message).toMatch(/not saved/i);
  });

  it('queue full (count cap) on enqueue → not_saved', async () => {
    const d = deps({ online: false, enqueue: vi.fn(async () => { throw new QueueFullError(50); }) });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result.kind).toBe('not_saved');
  });

  it('downscale failure (undecodable image) → not_saved with retake copy, never enqueued', async () => {
    const d = deps({ online: false, downscale: vi.fn(async () => { throw new Error('ImageDecodeError'); }) });
    const result = await submitPhotoWithOfflineFallback(capture(), d);
    expect(result.kind).toBe('not_saved');
    expect((result as { message: string }).message).toMatch(/retake/i);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});
