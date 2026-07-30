import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  registerDocument: vi.fn(),
  getZone: vi.fn(),
  storeDocument: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  logError: vi.fn(),
  permissionCalls: [] as Array<[string, string]>,
  formFields: {} as Record<string, string[]>,
  formFiles: {} as Record<string, unknown>,
}));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => ({
    getZone: h.getZone,
    registerDocument: h.registerDocument,
  }),
}));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryDocumentStorage', () => ({
  storeZoneDeliveryDocument: h.storeDocument,
  activeDocumentId: () => undefined,
  documentAuditMetadata: (input: Record<string, unknown>, actor: Record<string, unknown>) => ({
    source: input.documentSource,
    sourceRef: input.sourceRef,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
    effectiveAt: input.effectiveAt,
    uploader: { userId: actor.userId, email: actor.email },
  }),
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (permission: string, action: string) => {
    h.permissionCalls.push([permission, action]);
    return (handler: unknown) => handler;
  },
}));
vi.mock('@/lib/logger', () => ({
  log: { error: h.logError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('fs', () => ({
  default: { promises: { readFile: h.readFile, unlink: h.unlink } },
}));
vi.mock('formidable', () => ({
  IncomingForm: class {
    parse(_req: unknown, callback: (error: unknown, fields: unknown, files: unknown) => void) {
      callback(null, h.formFields, h.formFiles);
    }
  },
}));
vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: { uploadFile: vi.fn(), deleteFile: vi.fn() },
}));

import handler, { config } from '@/pages/api/zone-delivery/document';

const projectId = '11111111-1111-4111-8111-111111111111';
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'documents@example.com',
};
const meta = {
  projectId,
  zoneNo: 7,
  expectedRowVersion: 2,
  effectiveAt: '2026-07-30T08:00:00.000Z',
  source: 'EXFO job 42',
};
function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return res as unknown as NextApiResponse & typeof res;
}
async function call(req: Partial<NextApiRequest>) {
  const res = response();
  await (handler as (req: NextApiRequest, res: NextApiResponse) => Promise<void>)(
    { method: 'POST', query: {}, body: {}, headers: {}, user, ...req } as unknown as NextApiRequest,
    res,
  );
  return res;
}

describe('zone delivery document route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getZone.mockResolvedValue({ documents: [] });
    h.unlink.mockResolvedValue(undefined);
    h.formFields = {};
    h.formFiles = {};
  });

  it('disables Next body parsing and uses the documents edit permission', () => {
    expect(config.api.bodyParser).toBe(false);
    expect(h.permissionCalls).toEqual([
      ['construction-qa.zone-delivery.documents-manage', 'edit'],
    ]);
  });

  it('registers explicit JSON exfo_result metadata without a VF upload', async () => {
    h.registerDocument.mockResolvedValue({ rowVersion: 3 });
    const body = {
      ...meta,
      documentType: 'test_pack',
      ponStageId: '22222222-2222-4222-8222-222222222222',
      documentSource: 'exfo_result',
      sourceRef: 'exfo://results/job-42',
      filename: 'job-42.json',
      mimeType: 'application/json',
      sizeBytes: 2048,
      checksumSha256: 'a'.repeat(64),
    };
    const res = await call({
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(h.registerDocument).toHaveBeenCalledWith(body, {
      userId: user.id,
      email: user.email,
      permission: 'construction-qa.zone-delivery.documents-manage',
    });
    expect(h.storeDocument).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      data: {
        zone: { rowVersion: 3 },
        document: {
          source: 'exfo_result',
          sourceRef: 'exfo://results/job-42',
          uploader: { userId: user.id, email: user.email },
        },
      },
    });
  });

  it('parses multipart evidence and always unlinks the temporary file', async () => {
    h.formFields = Object.fromEntries(
      Object.entries({ ...meta, documentType: 'fac' })
        .map(([key, value]) => [key, [String(value)]]),
    );
    h.formFiles = {
      file: [{
        filepath: '/tmp/evidence.pdf',
        originalFilename: 'FAC signed.pdf',
        mimetype: 'application/pdf',
        size: 13,
      }],
    };
    h.readFile.mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    h.storeDocument.mockResolvedValue({ zone: { rowVersion: 3 }, document: { source: 'vf_storage' } });
    const res = await call({ headers: { 'content-type': 'multipart/form-data; boundary=x' } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(h.storeDocument).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ projectId, zoneNo: 7, documentType: 'fac' }),
      file: expect.objectContaining({
        originalFilename: 'FAC signed.pdf',
        mimeType: 'application/pdf',
      }),
    }));
    expect(h.unlink).toHaveBeenCalledWith('/tmp/evidence.pdf');
  });

  it('unlinks the temporary file when storage or registration fails', async () => {
    h.formFields = Object.fromEntries(
      Object.entries({ ...meta, documentType: 'fac' })
        .map(([key, value]) => [key, [String(value)]]),
    );
    h.formFiles = {
      file: [{
        filepath: '/tmp/failure.pdf',
        originalFilename: 'failure.pdf',
        mimetype: 'application/pdf',
        size: 13,
      }],
    };
    h.readFile.mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    h.storeDocument.mockRejectedValue(new Error('database unavailable'));
    const res = await call({ headers: { 'content-type': 'multipart/form-data; boundary=x' } });
    expect(res.statusCode).toBe(500);
    expect(h.unlink).toHaveBeenCalledWith('/tmp/failure.pdf');
  });

  it('rejects unsupported content types and methods', async () => {
    const content = await call({ headers: { 'content-type': 'text/plain' } });
    expect(content.statusCode).toBe(400);
    const method = await call({ method: 'GET' });
    expect(method.statusCode).toBe(405);
    expect(method.headers.Allow).toBe('POST');
  });
});
