/** Tests for useSerialSearch — happy path, success:false, and network error. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { useSerialSearch } from '@/modules/procurement/field-stock/hooks/useSerialSearch';

const ROW = {
  id: 'r1', serialNumber: 'S1', macAddress: null, category: null, itemName: null,
  status: 'available', currentLocationName: null, allocatedProjectName: null,
  installedAtDropNumber: null, lastEventType: null, lastEventAt: null,
};

describe('useSerialSearch', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches rows on mount and bakes the fixed filter into the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { rows: [ROW], total: 1 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useSerialSearch({ warehouseId: 'w1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toEqual([ROW]);
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toContain('warehouseId=w1');
  });

  it('sets an error when the API returns success:false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, error: { message: 'nope' } }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useSerialSearch({ projectId: 'p1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('nope');
    expect(result.current.rows).toEqual([]);
  });

  it('sets an error on a network throw', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const { result } = renderHook(() => useSerialSearch({ warehouseId: 'w1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('offline');
  });
});
