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
/**
 * An upstream whose body honours the abort signal.
 *
 * Load-bearing for the timing tests: if the mock ignores `signal`, `controller.abort()`
 * changes nothing observable and the test passes no matter what the route does with its
 * timers. Two mutations survived exactly that mistake before this was wired up.
 */
function abortableUpstream(chunkCount: number, gapMs: number) {
  return vi.fn().mockImplementation(async (_url: string, opts: { signal?: AbortSignal } = {}) => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    body: new ReadableStream({
      async start(controller) {
        let closed = false;
        // The `closed` flag is the guard, not a try/catch: erroring a stream twice is
        // the only way this throws, and the flag already makes that unreachable.
        const fail = () => {
          if (closed) return;
          closed = true;
          controller.error(new Error('aborted'));
        };
        opts.signal?.addEventListener('abort', fail);
        for (let i = 0; i < chunkCount; i += 1) {
          await new Promise((r) => setTimeout(r, gapMs));
          if (closed) return;
          controller.enqueue(new Uint8Array([i + 1]));
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      },
    }),
  }));
}

/** A real writable standing in for the response, because the route pipes into it. */
function streamingRes() {
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
  return { res, headers, received: () => chunks };
}

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
    delete process.env.PHOTO_DOWNLOAD_STALL_MS;
    delete process.env.PHOTO_DOWNLOAD_FETCH_MS;
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

  it('survives a slow transfer that never actually stalls', async () => {
    // THE regression guard. A total-duration cap here truncated real downloads: 8.9 MB
    // on a congested link takes as long as it takes. This transfer runs well past the
    // stall window but is never idle for it, so it must complete intact.
    process.env.PHOTO_DOWNLOAD_STALL_MS = '200';
    // 6 chunks, 80ms apart: 480ms total — well past the 200ms window, never idle for it.
    vi.stubGlobal('fetch', abortableUpstream(6, 80));

    const { res, received } = streamingRes();
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { req } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { key: KEY, source: 'local', uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
    });

    await handler(req, res);

    expect(Buffer.concat(received()).length).toBe(6);
  }, 10_000);

  it('gives up on an upstream that stalls mid-body instead of hanging forever', async () => {
    // Measured: without an idle timer, `pipeline` stays pending indefinitely, holding
    // this handler, its socket and the upstream connection — on a route built for
    // thousands of concurrent pulls.
    process.env.PHOTO_DOWNLOAD_STALL_MS = '150';
    // One chunk, then silence for far longer than the window.
    vi.stubGlobal('fetch', abortableUpstream(1, 10_000));

    const { res } = streamingRes();
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { req } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { key: KEY, source: 'local', uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
    });

    const settled = await Promise.race([
      handler(req, res).then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('HUNG'), 4000)),
    ]);

    expect(settled).toBe('settled');
  }, 10_000);

  it('stops the fetch timer once headers arrive, so it cannot cut the body', async () => {
    // Pins the disarm. Leaving the fetch timer armed makes it bound the whole transfer:
    // aborting the controller after the fetch resolves kills the in-flight body, which
    // truncates any download slower than the timeout — silently, since qfield upstreams
    // send no Content-Length.
    process.env.PHOTO_DOWNLOAD_FETCH_MS = '100';
    process.env.PHOTO_DOWNLOAD_STALL_MS = '2000';
    vi.stubGlobal('fetch', abortableUpstream(6, 80)); // 480ms — 4.8x the fetch timeout

    const { res, received } = streamingRes();
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { req } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { key: KEY, source: 'local', uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
    });

    await handler(req, res);

    expect(Buffer.concat(received()).length).toBe(6);
  }, 10_000);

  it('gives up when the body never delivers a single byte', async () => {
    // Pins the INITIAL arming of the watchdog. If the timer were only started by the
    // first chunk, an upstream that sends headers and then nothing hangs forever.
    process.env.PHOTO_DOWNLOAD_STALL_MS = '150';
    vi.stubGlobal('fetch', abortableUpstream(1, 10_000));

    const { res } = streamingRes();
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1', purpose: 'download' })!;
    const { req } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { key: KEY, source: 'local', uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
    });

    const settled = await Promise.race([
      handler(req, res).then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('HUNG'), 4000)),
    ]);

    expect(settled).toBe('settled');
  }, 10_000);

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
