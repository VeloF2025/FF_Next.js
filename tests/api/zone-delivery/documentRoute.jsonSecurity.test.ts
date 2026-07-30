import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  registerDocument: vi.fn(),
  getZone: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => ({
    getZone: h.getZone,
    registerDocument: h.registerDocument,
  }),
}));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryDocumentStorage', () => ({
  activeDocumentId: vi.fn(),
  documentAuditMetadata: vi.fn(),
  storeZoneDeliveryDocument: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: { uploadFile: vi.fn(), deleteFile: vi.fn() },
}));

import handler from '@/pages/api/zone-delivery/document';

const user = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'documents@example.com',
};
const body = {
  projectId: '11111111-1111-4111-8111-111111111111',
  zoneNo: 7,
  expectedRowVersion: 2,
  effectiveAt: '2026-07-30T08:00:00.000Z',
  source: 'EXFO job 42',
  documentType: 'test_pack',
  ponStageId: '22222222-2222-4222-8222-222222222222',
  documentSource: 'exfo_result',
  sourceRef: 'exfo://results/job-42',
  filename: 'job-42.json',
  mimeType: 'application/json',
  sizeBytes: 2048,
  checksumSha256: 'a'.repeat(64),
};

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
    setHeader: vi.fn(),
  };
  return res as unknown as NextApiResponse & typeof res;
}

async function call(requestBody: Record<string, unknown>) {
  const res = response();
  await (handler as (req: NextApiRequest, res: NextApiResponse) => Promise<void>)({
    method: 'POST',
    query: {},
    headers: { 'content-type': 'application/json' },
    body: requestBody,
    user,
  } as unknown as NextApiRequest, res);
  return res;
}

describe('zone delivery JSON document security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects EXFO JSON until canonical project, zone, and PON mapping exists', async () => {
    const res = await call(body);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'EVIDENCE_REQUIRED',
        message: expect.stringMatching(/canonical project, zone and PON mapping/i),
      },
    });
    expect(h.getZone).not.toHaveBeenCalled();
    expect(h.registerDocument).not.toHaveBeenCalled();
  });

  it('continues to reject numeric strings before registration', async () => {
    const res = await call({ ...body, zoneNo: '7', expectedRowVersion: '2' });
    expect(res.statusCode).toBe(400);
    expect(h.registerDocument).not.toHaveBeenCalled();
  });
});
