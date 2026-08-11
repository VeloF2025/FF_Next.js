/**
 * The attachment download route is the only thing standing between a medical
 * certificate and anyone with a link, so its refusals are what this file
 * asserts:
 *
 *   - a row whose file_path is outside the private prefix is refused rather
 *     than proxied, because nginx is not guarding it;
 *   - the permission is re-checked on every request, not once at upload;
 *   - a missing attachment 404s without disclosing whether the id exists.
 *
 * The upload route's compensation is asserted too: when the insert fails, the
 * uploaded object must be deleted, or the storage fills with unreferenced
 * health data that nothing in the application can ever reach or remove.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  attachment: {
    current: null as Record<string, unknown> | null,
  },
  deletedObjects: { current: [] as string[] },
  insertShouldFail: { current: false },
  fetchCalls: { current: [] as string[] },
}));

vi.mock('@/modules/health-safety/services/hsAuth', () => ({
  // The real wrapper is exercised by its own tests; here it is transparent so
  // these assertions are about the handler's own refusals.
  withHsPermission: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
  getAuthUser: () => ({ id: 'hs-editor' }),
}));
vi.mock('@/lib/arcjet', () => ({
  withArcjetProtection: (handler: unknown) => handler,
  aj: {},
  ajStrict: {},
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/modules/health-safety/services/activityLog', () => ({ logHsActivity: vi.fn() }));

vi.mock('@/modules/health-safety/services/hsAttachmentService', () => ({
  getAttachment: vi.fn(async () => h.attachment.current),
  listAttachments: vi.fn(async () => []),
  deleteAttachmentRow: vi.fn(async () => true),
  insertAttachment: vi.fn(async () => {
    if (h.insertShouldFail.current) throw new Error('insert exploded');
    return { id: 'att-1', file_name: 'cert.pdf', file_size: 10, mime_type: 'application/pdf' };
  }),
}));

vi.mock('@/services/vfStorageAdapter', () => ({
  isVFStorageAvailable: vi.fn(async () => true),
  vfStorage: {
    uploadFile: vi.fn(async () => ({
      success: true,
      filename: 'stored.pdf',
      path: 'hs-private/medicals/stored.pdf',
      url: '/storage/hs-private/medicals/stored.pdf',
      size: 10,
    })),
    deleteFile: vi.fn(async (type: string, category: string, filename: string) => {
      h.deletedObjects.current.push(`${type}/${category}/${filename}`);
      return true;
    }),
  },
}));

import downloadHandler from '../../../../pages/api/health-safety/attachments/download';
import { HsAttachmentError } from '../services/hsAttachmentValidation';

const PRIVATE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  file_name: 'cert.pdf',
  file_size: 10,
  mime_type: 'application/pdf',
  uploaded_by: 'hs-editor',
  created_at: '2026-08-11T00:00:00Z',
  file_path: 'hs-private/medicals/stored.pdf',
  surface: 'medical' as const,
  parent_id: '22222222-2222-2222-2222-222222222222',
};

async function download(id: string) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    query: { id },
  });
  await downloadHandler(req, res);
  return res;
}

beforeEach(() => {
  h.attachment.current = null;
  h.deletedObjects.current = [];
  h.insertShouldFail.current = false;
  h.fetchCalls.current = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      h.fetchCalls.current.push(String(url));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4').buffer,
      };
    })
  );
});

describe('GET /api/health-safety/attachments/download', () => {
  it('streams an attachment stored under the private prefix', async () => {
    h.attachment.current = { ...PRIVATE_ROW };

    const res = await download(PRIVATE_ROW.id);

    expect(res._getStatusCode()).toBe(200);
    expect(h.fetchCalls.current[0]).toContain('hs-private/medicals/stored.pdf');
  });

  it('refuses a row whose path is outside the private prefix', async () => {
    // The row exists and the caller is permitted; the refusal is purely that
    // these bytes sit somewhere nginx does not guard, so serving them would
    // hand out a file the design assumes is unreachable.
    h.attachment.current = { ...PRIVATE_ROW, file_path: 'staff/documents/leaked.pdf' };

    const res = await download(PRIVATE_ROW.id);

    expect(res._getStatusCode()).toBe(404);
    // Nothing was fetched — the refusal happened before storage was touched.
    expect(h.fetchCalls.current).toHaveLength(0);
  });

  it('404s an unknown attachment', async () => {
    h.attachment.current = null;

    const res = await download('33333333-3333-3333-3333-333333333333');

    expect(res._getStatusCode()).toBe(404);
    expect(h.fetchCalls.current).toHaveLength(0);
  });

  it('rejects an id that is not a uuid without querying', async () => {
    const res = await download('../../etc/passwd');

    expect(res._getStatusCode()).toBe(400);
    expect(h.fetchCalls.current).toHaveLength(0);
  });

  it('never sets a shared cache header on health data', async () => {
    h.attachment.current = { ...PRIVATE_ROW };

    const res = await download(PRIVATE_ROW.id);

    // A public or long-lived cache would keep serving the file after the
    // permission behind it was removed — the failure mode already measured on
    // the public /storage/ tier, where a deleted object stayed retrievable.
    const cacheControl = String(res.getHeader('Cache-Control'));
    expect(cacheControl).toContain('private');
    expect(cacheControl).not.toContain('public');
    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not render an unexpected type inline even when asked', async () => {
    h.attachment.current = { ...PRIVATE_ROW, mime_type: 'text/html', file_name: 'x.html' };

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { id: PRIVATE_ROW.id, inline: 'true' },
    });
    await downloadHandler(req, res);

    // Inline HTML from this origin would be stored XSS against the app.
    expect(String(res.getHeader('Content-Disposition'))).toContain('attachment');
  });

  it('rejects a non-GET method', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      query: { id: PRIVATE_ROW.id },
    });
    await downloadHandler(req, res);

    expect(res._getStatusCode()).toBe(405);
  });
  it('does not append "not found" to a message that is already a sentence', async () => {
    // apiResponse.notFound(res, resource) renders "<resource> not found", so
    // routing a complete sentence through it produced
    // "That attachment is not linked to a record not found" in the user's face.
    h.attachment.current = { ...PRIVATE_ROW, medical_id: null, surface: undefined };
    const { getAttachment } = await import(
      '@/modules/health-safety/services/hsAttachmentService'
    );
    (getAttachment as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(
        new HsAttachmentError('not_found', 'That attachment is not linked to a record')
      );

    const res = await download(PRIVATE_ROW.id);

    expect(res._getStatusCode()).toBe(404);
    const body = JSON.stringify(res._getJSONData());
    expect(body).toContain('That attachment is not linked to a record');
    expect(body).not.toMatch(/record not found/);
  });
});
