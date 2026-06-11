/**
 * createPicking — proof-photo enforcement for non-serial issue lines.
 * The Neon sql client and validators are mocked; we assert on the HTTP
 * response for the validation branch (no DB writes reached).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@neondatabase/serverless', () => ({
  neon: () => vi.fn().mockResolvedValue([]),
}));
vi.mock('../_validation', () => ({
  validateFieldDefaultDestination: vi.fn().mockResolvedValue({ ok: true }),
  validateSerialsAvailable: vi.fn().mockResolvedValue({ ok: true, resolvedSerialIds: new Map() }),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { createPicking } from '../_create';

function mockRes() {
  const res: Partial<NextApiResponse> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => { res.statusCode = code; return res; }) as never;
  res.json = vi.fn().mockImplementation((body: unknown) => { res.body = body; return res; }) as never;
  return res as NextApiResponse & { statusCode?: number; body?: unknown };
}

const NON_SERIAL_BODY = {
  pickingType: 'issue',
  sourceLocationId: 'src', destinationLocationId: 'dst',
  lines: [{ stockItemId: 'i1', plannedQuantity: 25 }],
};

describe('createPicking proof-photo enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-serial issue without proofPhotoKey', async () => {
    const res = mockRes();
    await createPicking({ body: NON_SERIAL_BODY } as NextApiRequest, res, 'staff1');
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain('proof');
  });

  it('rejects a non-serial issue with plannedQuantity <= 0', async () => {
    const res = mockRes();
    await createPicking(
      { body: { ...NON_SERIAL_BODY, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k',
        lines: [{ stockItemId: 'i1', plannedQuantity: 0 }] } } as NextApiRequest,
      res, 'staff1');
    expect(res.statusCode).toBe(400);
  });

  it('does NOT demand a proof photo for a serial issue', async () => {
    const res = mockRes();
    await createPicking(
      { body: { ...NON_SERIAL_BODY,
        lines: [{ stockItemId: 'i1', plannedQuantity: 1, serialIds: ['S1'] }] } } as NextApiRequest,
      res, 'staff1');
    // With the fully-mocked sql client the create proceeds past validation and
    // reaches pickingResult[0] undefined → internalError 500. Pin only that the
    // proof gate (a 400) did NOT fire.
    expect(res.statusCode).not.toBe(400);
  });

  it('classifies serialIds:[] as non-serial → 400 mentioning proof', async () => {
    const res = mockRes();
    await createPicking(
      { body: { ...NON_SERIAL_BODY,
        lines: [{ stockItemId: 'i1', plannedQuantity: 5, serialIds: [] }] } } as NextApiRequest,
      res, 'staff1');
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain('proof');
  });

  it('rejects proofPhotoUrl with an external origin → 400 INVALID_PROOF_PHOTO_URL', async () => {
    const res = mockRes();
    await createPicking(
      { body: { ...NON_SERIAL_BODY,
        proofPhotoKey: 'stores/picking-proof/valid.jpg',
        proofPhotoUrl: 'https://evil.example/x.gif',
        lines: [{ stockItemId: 'i1', plannedQuantity: 5 }] } } as NextApiRequest,
      res, 'staff1');
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_PROOF_PHOTO_URL');
  });
});
