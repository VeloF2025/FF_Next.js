import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitSnagPhoto } from '../submitSnagPhoto';
import type { PendingSnagPhoto } from '../photoQueue';

function payload(overrides: Partial<PendingSnagPhoto> = {}): PendingSnagPhoto {
  return {
    token: 'tok-123',
    stepId: 'step-1',
    slotKey: 'front',
    actorId: 'actor-9',
    clientUploadId: '11111111-2222-4333-8444-555555555555',
    photoBlob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
    filename: 'p.jpg',
    mimeType: 'image/jpeg',
    byteSize: 10,
    capturedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('submitSnagPhoto', () => {
  it('POSTs multipart FormData with every upload_photo field incl. clientUploadId', async () => {
    let captured: { url: string; body: FormData } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, body: init.body as FormData };
      return { ok: true, status: 200 } as Response;
    }));

    await submitSnagPhoto(payload());

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe('/api/snags/shared/tok-123');
    const fd = captured!.body;
    expect(fd.get('action')).toBe('upload_photo');
    expect(fd.get('stepId')).toBe('step-1');
    expect(fd.get('slotKey')).toBe('front');
    expect(fd.get('actorId')).toBe('actor-9');
    expect(fd.get('clientUploadId')).toBe('11111111-2222-4333-8444-555555555555');
    expect(fd.get('file')).toBeInstanceOf(Blob);
  });

  it('omits slotKey and actorId when absent (legacy single-photo / no actor)', async () => {
    let fd: FormData | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      fd = init.body as FormData;
      return { ok: true, status: 200 } as Response;
    }));
    await submitSnagPhoto(payload({ slotKey: undefined, actorId: undefined }));
    expect(fd!.has('slotKey')).toBe(false);
    expect(fd!.has('actorId')).toBe(false);
    // clientUploadId is always sent.
    expect(fd!.get('clientUploadId')).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('resolves on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201 } as Response)));
    await expect(submitSnagPhoto(payload())).resolves.toBeUndefined();
  });

  it('throws with .status on a 4xx so the queue drains it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409 } as Response)));
    await expect(submitSnagPhoto(payload())).rejects.toMatchObject({ status: 409 });
  });

  it('throws with .status on a 5xx so the queue keeps and retries it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as Response)));
    await expect(submitSnagPhoto(payload())).rejects.toMatchObject({ status: 503 });
  });

  it('propagates a network error (no .status) so the queue keeps it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await submitSnagPhoto(payload()).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { status?: number }).status).toBeUndefined();
  });
});
