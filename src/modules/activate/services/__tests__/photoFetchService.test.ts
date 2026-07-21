import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Graph token helper is mocked so the test never hits Azure AD.
vi.mock('@/lib/graph/auth', () => ({
  getGraphAccessToken: vi.fn(async () => 'test-graph-token'),
}));

import { fetchPhotoAsBase64 } from '../photoFetchService';
import { getGraphAccessToken } from '@/lib/graph/auth';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

describe('fetchPhotoAsBase64 — Microsoft Graph gallery photos', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getGraphAccessToken).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the Graph Bearer token when fetching a canonical Graph URL', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => PNG_BYTES.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const url = 'https://graph.microsoft.com/v1.0/drives/abc/items/xyz/content';
    const b64 = await fetchPhotoAsBase64(url);

    expect(getGraphAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-graph-token' },
      })
    );
    expect(b64).toBe(Buffer.from(PNG_BYTES).toString('base64'));
  });

  it('never requests a Graph token for a non-Graph URL (no credential leak)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => PNG_BYTES.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchPhotoAsBase64('http://100.96.203.105:8003/api/photo/DR123/x.jpg');

    expect(getGraphAccessToken).not.toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    // Plain backend fetch carries no Authorization header.
    expect(init).toBeUndefined();
  });

  it('resolves a relative photo-proxy path to the internal OneMap URL, not the withAuth-protected proxy', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => PNG_BYTES.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchPhotoAsBase64('/api/activate/photo/DR1729653/DR1729653_ph_outs_1.jpg');

    const [calledUrl] = fetchSpy.mock.calls[0] ?? [];
    // Must go straight to the internal photo server. Routing it back through
    // /api/activate/photo (withAuth) 401s on a credential-less server-side
    // fetch, which silently broke every VLM quality check.
    expect(calledUrl).toBe(
      'http://100.96.203.105:8003/api/photo/DR1729653/DR1729653_ph_outs_1.jpg'
    );
    expect(String(calledUrl)).not.toContain('/api/activate/photo/');
  });

  it('routes a WhatsApp photo to the VPS photo server, not the 1Map server', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => PNG_BYTES.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchPhotoAsBase64('/api/activate/photo/DR1729653/wa_12345.jpg');

    const [calledUrl] = fetchSpy.mock.calls[0] ?? [];
    expect(calledUrl).toBe('http://72.61.197.178:8866/photos/DR1729653/wa_12345.jpg');
  });

  it('throws when Graph returns a non-OK status (so the example is reported, not silently hashed)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      fetchPhotoAsBase64('https://graph.microsoft.com/v1.0/drives/abc/items/missing/content')
    ).rejects.toThrow(/404/);
  });
});
