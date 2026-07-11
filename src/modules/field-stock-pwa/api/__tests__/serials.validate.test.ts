/**
 * Tests for validateSerial — location fields must pass through so the scan
 * step can cross-check the serial's warehouse against the selected source.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSerial } from '../serials';
import { ApiError } from '../request';

vi.mock('../request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../request')>();
  return { ...actual, request: vi.fn() };
});

import { request } from '../request';
const requestMock = vi.mocked(request);

describe('validateSerial', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('returns valid with the serial location when status is in_stock', async () => {
    requestMock.mockResolvedValueOnce({
      id: 'uuid-1',
      stockItemId: 'item-ont',
      serialNumber: 'ALCLB465A813',
      status: 'in_stock',
      currentLocationId: 'loc-lawley',
      currentLocationName: 'Lawley',
    });

    const result = await validateSerial('ALCLB465A813');

    expect(result.valid).toBe(true);
    expect(result.stockItemId).toBe('item-ont');
    expect(result.currentLocationId).toBe('loc-lawley');
    expect(result.currentLocationName).toBe('Lawley');
  });

  it('returns invalid with the status when the serial is not available', async () => {
    requestMock.mockResolvedValueOnce({
      id: 'uuid-2',
      stockItemId: 'item-ont',
      serialNumber: 'ALCLB4AAAAAA',
      status: 'activated',
      currentLocationId: null,
    });

    const result = await validateSerial('ALCLB4AAAAAA');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('activated');
  });

  it('returns invalid "not found" on 404', async () => {
    requestMock.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Serial not found'));

    const result = await validateSerial('ALCLB4ZZZZZZ');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe('Serial number not found');
  });
});
