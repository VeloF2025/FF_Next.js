/**
 * submitIssue — non-serial drafts send plannedQuantity + proof photo fields
 * and omit serialIds; serial drafts unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.fn();
vi.mock('../request', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import { submitIssue } from '../pickings';
import type { PwaIssueDraft } from '../../types';

const BASE: PwaIssueDraft = {
  technicianId: 't1', contractorId: null, stockItemId: 'i1',
  serials: [], signatureDataUrl: 'data:image/png;base64,x', notes: '',
  sourceLocationId: 'src1', destinationLocationId: 'dst1',
};

describe('submitIssue body mapping', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ id: 'p1', picking_number: 'PCK-1', status: 'draft' });
  });

  it('non-serial: plannedQuantity from draft.quantity, no serialIds, proof fields present', async () => {
    await submitIssue({ ...BASE, quantity: 25, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k' });
    const body = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(body.lines[0].plannedQuantity).toBe(25);
    expect(body.lines[0].serialIds).toBeUndefined();
    expect(body.proofPhotoKey).toBe('k');
    expect(body.proofPhotoUrl).toBe('/storage/k');
  });

  it('serial: plannedQuantity = serial count, serialIds present, no proof fields', async () => {
    await submitIssue({
      ...BASE,
      serials: [{ serialNumber: 'S1', stockItemId: 'i1', stockItemName: 'x', scannedAt: 1, state: 'valid' }],
    });
    const body = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(body.lines[0].plannedQuantity).toBe(1);
    expect(body.lines[0].serialIds).toEqual(['S1']);
    expect(body.proofPhotoKey).toBeUndefined();
  });

  it('threads projectId into the picking body (undefined when absent)', async () => {
    await submitIssue({ ...BASE, quantity: 5, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k', projectId: 'proj-1' });
    const withProject = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(withProject.projectId).toBe('proj-1');

    requestMock.mockClear();
    requestMock.mockResolvedValue({ id: 'p2', picking_number: 'PCK-2', status: 'draft' });
    await submitIssue({ ...BASE, quantity: 5, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k' });
    const noProject = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(noProject.projectId).toBeUndefined();
  });
});
