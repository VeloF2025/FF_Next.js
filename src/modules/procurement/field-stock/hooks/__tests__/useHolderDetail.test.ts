/**
 * Tests for useHolderDetail.
 *
 * Covers:
 * - Idle when holderId is null (no fetch, no detail)
 * - Fetches the detail endpoint and coerces pg numeric strings via num()
 * - Maps custody / serials / projectBreakdown arrays
 * - Surfaces an error when the response is not ok
 * - Tolerates a missing data payload (returns null detail)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHolderDetail } from '../useHolderDetail';

const DETAIL_ROW = {
  holder_id: 'h-1',
  holder_type: 'staff',
  staff_id: 's-1',
  contractor_id: null,
  name: 'Louis Ellis',
  is_active: true,
  issued_count: '10',
  issued_value: '1000.50',
  consumed_count: '4',
  consumed_value: '400.00',
  returned_count: '2',
  returned_value: '200.00',
  held_count: '4',
  held_value: '400.50',
  unaccounted_count: '0',
  is_blocked: false,
  blocked_reason: null,
  blocked_at: null,
  blocked_by: null,
  pending_recovery_amount: '0',
  recovered_amount: '0',
  held_age_0_7: '1',
  held_age_8_30: '1',
  held_age_31_plus: '2',
  oldest_held_days: '45',
  oldest_held_at: '2026-04-27T00:00:00.000Z',
  custody: [
    { stock_item_id: 'i-1', item_code: 'CBL-1', item_name: 'Cable', lot_number: 'LOT-9', quantity: '3', total_value: '150.00' },
  ],
  serials: [
    { id: 'sr-1', serial_number: 'ALCLB4XYZ', stock_item_id: 'i-2', status: 'issued' },
  ],
  projectBreakdown: [
    { project_id: 'p-1', project_name: 'Mohadin', held_count: '3', held_value: '300.00' },
    { project_id: null, project_name: null, held_count: '1', held_value: '100.50' },
  ],
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useHolderDetail', () => {
  it('is idle and does not fetch when holderId is null', () => {
    const fetchMock = mockFetchOk({ data: DETAIL_ROW });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useHolderDetail(null));
    expect(result.current.detail).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the detail endpoint and coerces numeric strings', async () => {
    const fetchMock = mockFetchOk({ data: DETAIL_ROW });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useHolderDetail('h-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/procurement/field-stock/accountability/holders/h-1',
    );
    const d = result.current.detail!;
    expect(d).not.toBeNull();
    expect(d.held_value).toBe(400.5);
    expect(typeof d.held_value).toBe('number');
    expect(d.held_age_31_plus).toBe(2);
    expect(d.oldest_held_days).toBe(45);
    expect(result.current.error).toBeNull();
  });

  it('maps custody, serials and projectBreakdown', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: DETAIL_ROW }));
    const { result } = renderHook(() => useHolderDetail('h-1'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    const d = result.current.detail!;
    expect(d.custody).toHaveLength(1);
    expect(d.custody[0].quantity).toBe(3);
    expect(d.serials[0].serial_number).toBe('ALCLB4XYZ');
    expect(d.projectBreakdown).toHaveLength(2);
    expect(d.projectBreakdown[0].project_name).toBe('Mohadin');
    expect(d.projectBreakdown[1].project_id).toBeNull();
    expect(d.projectBreakdown[1].held_value).toBe(100.5);
  });

  it('surfaces an error when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));
    const { result } = renderHook(() => useHolderDetail('h-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch holder detail');
    expect(result.current.detail).toBeNull();
  });

  it('returns null detail when the payload has no data', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const { result } = renderHook(() => useHolderDetail('h-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
