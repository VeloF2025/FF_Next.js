/**
 * Tests for useStockExceptions.
 *
 * Covers:
 * - Fetches the exceptions endpoint, coerces held_days via num()
 * - Builds the query string from filters (class / project / includeAll)
 * - Surfaces an error on a non-ok response
 * - refetch re-queries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStockExceptions } from '../useStockExceptions';

const ROW = {
  serial_id: 's-1',
  serial_number: 'ALCLB491AA22',
  status: 'issued',
  holder_id: 'h-1',
  holder_type: 'staff',
  holder_name: 'Louis Ellis',
  stock_item_id: 'i-1',
  item_code: 'FT-ONT',
  item_name: 'Nokia ONT',
  project_id: null,
  project_name: null,
  held_since: '2026-04-27T00:00:00.000Z',
  held_days: '45',
  wa_drop: null,
  oes_drop: null,
  oes_status: null,
  oes_activation_date: null,
  exception_class: 'aged_no_evidence',
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('useStockExceptions', () => {
  it('fetches and coerces held_days to a number', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: [ROW] }));
    const { result } = renderHook(() => useStockExceptions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.exceptions).toHaveLength(1);
    const e = result.current.exceptions[0];
    expect(e.held_days).toBe(45);
    expect(typeof e.held_days).toBe('number');
    expect(e.exception_class).toBe('aged_no_evidence');
    expect(result.current.error).toBeNull();
  });

  it('builds the query string from class + project + includeAll filters', async () => {
    const fetchMock = mockFetchOk({ data: [] });
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() =>
      useStockExceptions({ exceptionClass: 'cross_dr_conflict', projectId: 'p-9', includeAll: true }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/api/procurement/field-stock/accountability/exceptions?');
    expect(url).toContain('class=cross_dr_conflict');
    expect(url).toContain('projectId=p-9');
    expect(url).toContain('includeAll=true');
  });

  it('does not fetch when autoFetch is false until refetch is called', async () => {
    const fetchMock = mockFetchOk({ data: [ROW] });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStockExceptions({ autoFetch: false }));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => { await result.current.refetch(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.exceptions).toHaveLength(1);
  });

  it('surfaces an error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));
    const { result } = renderHook(() => useStockExceptions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch stock exceptions');
    expect(result.current.exceptions).toEqual([]);
  });
});
