import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFilename } from '../vfStorageUpload';

describe('safeFilename', () => {
  it('passes a normal filename through unchanged', () => {
    expect(safeFilename('step-3.jpg')).toBe('step-3.jpg');
    expect(safeFilename('DR1866766_step4_20260612.jpg')).toBe('DR1866766_step4_20260612.jpg');
  });

  it('strips POSIX path components (path traversal)', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('/var/www/uploads/evil.jpg')).toBe('evil.jpg');
  });

  it('strips Windows path components (path traversal)', () => {
    expect(safeFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
  });

  it('replaces unsafe characters with underscores', () => {
    expect(safeFilename('my photo!@#.jpg')).toBe('my_photo___.jpg');
    expect(safeFilename('réport(1).png')).toBe('r_port_1_.png');
  });

  it('caps the length at 128 characters', () => {
    const long = `${'a'.repeat(200)}.jpg`;
    expect(safeFilename(long)).toHaveLength(128);
  });

  it('falls back to a generated name for empty / all-separator input', () => {
    expect(safeFilename('')).toMatch(/^photo_\d+\.jpg$/);
    expect(safeFilename('///')).toMatch(/^photo_\d+\.jpg$/);
  });

  it('falls back to a generated name for non-string input', () => {
    expect(safeFilename(null)).toMatch(/^photo_\d+\.jpg$/);
    expect(safeFilename(undefined)).toMatch(/^photo_\d+\.jpg$/);
    expect(safeFilename(42)).toMatch(/^photo_\d+\.jpg$/);
    expect(safeFilename({ name: 'x' })).toMatch(/^photo_\d+\.jpg$/);
  });
});

describe('uploadToVfStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VF_STORAGE_URL', 'http://storage.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads SiteCam photos to the typed VF Storage route and returns the /storage proxy path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: 'sitecam/photos/photo-123.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { uploadToVfStorage } = await import('../vfStorageUpload');
    const url = await uploadToVfStorage('photo.jpg', 'aW1hZ2U=');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://storage.test/upload/sitecam/photos');
    expect(url).toBe('/storage/sitecam/photos/photo-123.jpg');
  });
});

describe('uploadCategorizedFile', () => {
  const validBase64 = 'aW1hZ2U=';

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VF_STORAGE_URL', 'http://storage.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads to the caller-provided category with the caller-provided MIME type and returns a same-origin /storage path plus the raw storage key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: 'fleet/incidents/incident-abc.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { uploadCategorizedFile } = await import('../vfStorageUpload');
    const result = await uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'incident-abc.jpg', base64: validBase64,
      mimeType: 'image/jpeg', allowedMimeTypes: ['image/jpeg', 'image/png'], maxBytes: 1_000_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://storage.test/upload/fleet/incidents');
    expect(result).toEqual({ url: '/storage/fleet/incidents/incident-abc.jpg', key: 'fleet/incidents/incident-abc.jpg' });
  });

  it('rejects a disallowed MIME type without calling VF Storage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { uploadCategorizedFile, VfStorageValidationError } = await import('../vfStorageUpload');

    await expect(uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'x.exe', base64: validBase64,
      mimeType: 'application/x-msdownload', allowedMimeTypes: ['image/jpeg'], maxBytes: 1_000_000,
    })).rejects.toThrow(VfStorageValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized file without calling VF Storage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bigBase64 = Buffer.alloc(100, 1).toString('base64');
    const { uploadCategorizedFile, VfStorageValidationError } = await import('../vfStorageUpload');

    await expect(uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'x.jpg', base64: bigBase64,
      mimeType: 'image/jpeg', allowedMimeTypes: ['image/jpeg'], maxBytes: 10,
    })).rejects.toThrow(VfStorageValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid base64 content without calling VF Storage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { uploadCategorizedFile, VfStorageValidationError } = await import('../vfStorageUpload');

    await expect(uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'x.jpg', base64: 'not-valid-base64!!',
      mimeType: 'image/jpeg', allowedMimeTypes: ['image/jpeg'], maxBytes: 1_000_000,
    })).rejects.toThrow(VfStorageValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a returned URL that is not an approved VF Storage origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://evil.example.com/steal.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { uploadCategorizedFile, VfStorageOriginError } = await import('../vfStorageUpload');

    await expect(uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'x.jpg', base64: validBase64,
      mimeType: 'image/jpeg', allowedMimeTypes: ['image/jpeg'], maxBytes: 1_000_000,
    })).rejects.toThrow(VfStorageOriginError);
  });

  it('propagates an HTTP failure from VF Storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { uploadCategorizedFile } = await import('../vfStorageUpload');

    await expect(uploadCategorizedFile({
      category: 'fleet/incidents', storageFilename: 'x.jpg', base64: validBase64,
      mimeType: 'image/jpeg', allowedMimeTypes: ['image/jpeg'], maxBytes: 1_000_000,
    })).rejects.toThrow('HTTP 502');
  });
});
