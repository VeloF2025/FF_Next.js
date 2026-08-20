/**
 * The manifest route carries three things nothing else tests: which permission gates a
 * bulk export, that a download link cannot outlive the manifest that minted it, and
 * that minted URLs point only at hosts we own.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQuery, requiredPermission, logInfo } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  requiredPermission: { value: '' as string },
  logInfo: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: logInfo, debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ default: { query: poolQuery } }));
vi.mock('@/lib/auth/middleware', () => ({
  // Mirrors the real wrappers' contract rather than passing through blindly: an
  // unauthenticated request must 401, and the permission string is RECORDED so the test
  // below can assert which one gates the export.
  withAuth:
    (h: (req: unknown, res: unknown) => unknown) =>
    (req: { user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      if (!req.user) return res.status(401).json({ success: false });
      return h(req, res);
    },
  withPermission: (permission: string) => {
    requiredPermission.value = permission;
    return (h: unknown) => h;
  },
}));

import handler from '@/pages/api/photos/manifest';
import { signLink } from '@/lib/photos/photoLinks';

const KEYS = [
  { storage_key: 'etwatwa/ETW.P.F283/a.jpg', filename: 'a.jpg', step_label: 'Depth Photo', file_size_bytes: '900000', captured_at: '2026-08-01T10:00:00Z' },
  { storage_key: 'projects/uuid/files/DCIM/b.jpg', filename: null, step_label: 'pole_installation', file_size_bytes: null, captured_at: '2026-08-02T10:00:00Z' },
];

function get(query: Record<string, string>, host = 'app.fibreflow.app') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  req.headers = { host };
  return { req, res };
}

describe('GET /api/photos/manifest', () => {
  beforeEach(() => {
    process.env.PHOTO_LINK_SECRET = 'test-photo-link-secret';
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: KEYS });
  });
  afterEach(() => {
    delete process.env.PHOTO_LINK_SECRET;
  });

  it('gates minting on the export permission, not the view permission', () => {
    // An uncapped bulk export of both corpora. The module already splits view from
    // export — /api/construction-qa/export and both works-qa zips gate on an `.export`
    // key, and the RBAC seed grants qa-centre to a role it does not grant export to.
    expect(requiredPermission.value).toBe('construction-qa.export');
  });

  it('refuses an unauthenticated mint, so the auth wrapper is provably wired', async () => {
    // Every other test presents a signature and routes to mode 2, which never touches
    // withAuth. Without this, dropping withAuth from the mint path passes the suite.
    poolQuery.mockResolvedValue({ rows: [{ matched: 5, sized: 5, total_bytes: '5000' }] });
    const { req, res } = get({ project: 'Etwatwa' }); // no sig -> mint path, no user

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('mints a manifest URL for an authenticated user', async () => {
    poolQuery.mockResolvedValue({ rows: [{ matched: 1496, sized: 267, total_bytes: '238000000' }] });
    const { req, res } = get({ project: 'Etwatwa', type: 'depth' });
    (req as unknown as { user: { id: string } }).user = { id: 'user-5' };

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData().data;
    expect(body.matched).toBe(1496);
    // Size is unknown for most rows, so the total must be labelled an estimate.
    expect(body.sizeUnknownFor).toBe(1496 - 267);
    expect(body.sizeNote).toContain('Estimate');
    const url = new URL(body.manifestUrl);
    expect(url.origin).toBe('https://app.fibreflow.app');
    expect(url.searchParams.get('uid')).toBe('user-5');
    expect(url.searchParams.get('sig')).toBeTruthy();
  });

  it('never mints a download link that outlives the manifest link', async () => {
    // A fresh full TTL per fetch would double the real window: fetch the manifest at
    // T+59m and hold working downloads until T+119m.
    const parentTtl = 90;
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const signedF = signLink({ f, uid: 'user-1', purpose: 'manifest' }, parentTtl)!;

    const { req, res } = get({ f, uid: 'user-1', exp: String(signedF.exp), sig: signedF.sig });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData().data;
    expect(body.photoCount).toBe(2);
    expect(body.expiresInSeconds).toBeLessThanOrEqual(parentTtl);
    for (const file of body.files) {
      const childExp = Number(new URL(file.url).searchParams.get('exp'));
      expect(childExp).toBeLessThanOrEqual(signedF.exp);
    }
  });

  it('routes projects/ keys to the qfield backend and the rest to local', async () => {
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const signed = signLink({ f, uid: 'user-1', purpose: 'manifest' })!;

    const { req, res } = get({ f, uid: 'user-1', exp: String(signed.exp), sig: signed.sig });
    await handler(req, res);

    const files = res._getJSONData().data.files;
    expect(new URL(files[0].url).searchParams.get('source')).toBe('local');
    expect(new URL(files[1].url).searchParams.get('source')).toBe('qfield');
  });

  it('refuses an unsigned manifest fetch and runs no query', async () => {
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const { req, res } = get({ f, uid: 'user-1', exp: '99999999999', sig: 'forged' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('will not point a minted URL at a host it does not own', async () => {
    // `host` reaches the app unmodified from any caller — nginx does not rewrite it.
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const signed = signLink({ f, uid: 'user-1', purpose: 'manifest' })!;

    const { req, res } = get(
      { f, uid: 'user-1', exp: String(signed.exp), sig: signed.sig },
      'evil.example',
    );
    await handler(req, res);

    for (const file of res._getJSONData().data.files) {
      expect(file.url.startsWith('https://app.fibreflow.app/')).toBe(true);
    }
  });

  it('logs who fetched a manifest and how many photos it covered', async () => {
    // The export is uncapped by decision, so attribution after the fact is the control.
    logInfo.mockClear();
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const signed = signLink({ f, uid: 'user-77', purpose: 'manifest' })!;

    const { req, res } = get({ f, uid: 'user-77', exp: String(signed.exp), sig: signed.sig });
    await handler(req, res);

    expect(logInfo).toHaveBeenCalledWith(
      'Photo manifest served',
      expect.objectContaining({ userId: 'user-77', photos: 2 }),
      'photos-manifest',
    );
  });

  it('fails closed when no signing secret is configured', async () => {
    const f = Buffer.from(JSON.stringify({ project: 'Etwatwa' }), 'utf8').toString('base64url');
    const signed = signLink({ f, uid: 'user-1', purpose: 'manifest' })!;
    delete process.env.PHOTO_LINK_SECRET;

    const { req, res } = get({ f, uid: 'user-1', exp: String(signed.exp), sig: signed.sig });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});
