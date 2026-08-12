/**
 * The signature IS the access control on this route — there is no session behind it,
 * because the caller is a sandbox that cannot hold one. So these tests are the boundary.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createMocks } from 'node-mocks-http';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: logWarn, info: vi.fn(), debug: vi.fn() },
}));

import handler from '../download';
import { signLink } from '@/lib/photos/photoLinks';

const KEY = 'etwatwa/ETW.P.F283/civil-audit.jpg';

function call(query: Record<string, string>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  return { req, res, run: () => handler(req, res) };
}

/**
 * Upstream must expose a real web ReadableStream: the route PIPES it rather than
 * buffering, so a mock that only offers arrayBuffer() would pass a test the production
 * code path can no longer take.
 */
function okUpstream(body = Buffer.from([0xff, 0xd8, 0xff, 0xe0])) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(body));
        controller.close();
      },
    }),
  }));
}

describe('GET /api/photos/download', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.PHOTO_LINK_SECRET = 'test-photo-link-secret';
    process.env.VLM_PROXY_SECRET = 'test-vlm-secret';
    fetchSpy = okUpstream();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    delete process.env.PHOTO_LINK_SECRET;
    delete process.env.VLM_PROXY_SECRET;
    vi.unstubAllGlobals();
  });

  it('streams the photo through for a valid signature, never buffering it', async () => {
    // A real writable, because the route PIPES. node-mocks-http's response is not a
    // stream, so piping into it never completes — and a test that swapped the pipe for
    // a buffer would pass while reintroducing the 12 GB-heap failure this avoids.
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    vi.stubGlobal('fetch', okUpstream(bytes));

    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    const headers: Record<string, unknown> = {};
    const res = Object.assign(sink, {
      setHeader: (k: string, v: unknown) => {
        headers[k] = v;
      },
      getHeader: (k: string) => headers[k],
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    }) as unknown as NextApiResponse;

    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { req } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { key: KEY, source: 'local', uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
    });

    await handler(req, res);

    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(headers['Content-Disposition']).toContain('attachment;');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    // A signed link is a credential — a shared cache must not retain what it fetched.
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('refuses a source the manifest never mints, even when signed', async () => {
    // photo-proxy also serves `sharepoint` (MS Graph) and `upload` (public/uploads).
    const signed = signLink({ key: KEY, source: 'sharepoint', uid: 'user-1', purpose: 'download' })!;
    const { res, run } = call({
      key: KEY,
      source: 'sharepoint',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a link signed for a different purpose', async () => {
    // Manifest links and download links must not be substitutable for one another.
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'manifest' })!;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an unsigned request and never reaches the photo store', async () => {
    const { res, run } = call({ key: KEY, source: 'local', uid: 'user-1', exp: '99999999999', sig: 'nope' });

    await run();

    expect(res._getStatusCode()).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a signature minted for a different photo', async () => {
    const signed = signLink({ key: 'other/photo.jpg', source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an expired link with a message that says so', async () => {
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' }, -60)!;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.stringify(res._getJSONData())).toContain('expired');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses shell metacharacters before they can reach docker exec', async () => {
    const nasty = 'a;rm -rf /.jpg';
    const signed = signLink({ key: nasty, source: 'qfield', uid: 'user-1', purpose: 'download' })!;
    const { res, run } = call({
      key: nasty,
      source: 'qfield',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses traversal in the key even when correctly signed', async () => {
    const key = '../../etc/passwd';
    const signed = signLink({ key, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { res, run } = call({
      key,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed when no signing secret is configured', async () => {
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    delete process.env.PHOTO_LINK_SECRET;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs the real cause when the photo proxy rejects the internal call', async () => {
    // A 401 upstream means VLM_PROXY_SECRET is unset — a config fault, not a bad link.
    // The response body is sanitised by design, so the diagnosis has to reach the log.
    logWarn.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(500);
    expect(logWarn).toHaveBeenCalledWith(
      'Photo download upstream failed',
      expect.objectContaining({ status: 401, diagnosis: expect.stringContaining('VLM_PROXY_SECRET') }),
      'photos-download',
    );
    // The client is told nothing about server configuration.
    expect(JSON.stringify(res._getJSONData())).not.toContain('VLM_PROXY_SECRET');
  });

  it('rejects a non-GET method', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', query: {} });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});
