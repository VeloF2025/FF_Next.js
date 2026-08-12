/**
 * The signature IS the access control on this route — there is no session behind it,
 * because the caller is a sandbox that cannot hold one. So these tests are the boundary.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createMocks } from 'node-mocks-http';
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

function okUpstream(body = Buffer.from([0xff, 0xd8, 0xff, 0xe0])) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });
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

  it('serves the photo for a valid signature', async () => {
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1' })!;
    const { res, run } = call({
      key: KEY,
      source: 'local',
      uid: 'user-1',
      exp: String(signed.exp),
      sig: signed.sig,
    });

    await run();

    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader('Content-Disposition')).toContain('attachment;');
    // A signed link is a credential — a shared cache must not retain what it fetched.
    expect(res.getHeader('Cache-Control')).toBe('private, no-store');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('refuses an unsigned request and never reaches the photo store', async () => {
    const { res, run } = call({ key: KEY, source: 'local', uid: 'user-1', exp: '99999999999', sig: 'nope' });

    await run();

    expect(res._getStatusCode()).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a signature minted for a different photo', async () => {
    const signed = signLink({ key: 'other/photo.jpg', source: 'local', uid: 'user-1' })!;
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
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1' }, -60)!;
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
    const signed = signLink({ key: nasty, source: 'qfield', uid: 'user-1' })!;
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
    const signed = signLink({ key, source: 'local', uid: 'user-1' })!;
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
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1' })!;
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
    const signed = signLink({ key: KEY, source: 'local', uid: 'user-1' })!;
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
