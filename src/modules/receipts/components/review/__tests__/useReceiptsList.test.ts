/** @vitest-environment jsdom */
/**
 * useReceiptsList — paging state machine.
 *
 * Covers the race a blind review caught on PR #2641: loadMore() computing
 * an offset from items.length while a page-1 refetch (filters/refreshTick
 * changed) is still in flight would send offset for the OLD list against
 * the NEW filter. The guard is `if (!items || loading || loadingMore) return`.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReceiptsList } from '../useReceiptsList';
import { DEFAULT_FILTERS, type Filters } from '../types';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function page(items: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { items, summary: { submitted: { count: 5, totalCents: 0 } } },
    }),
  } as Response;
}

function receipt(id: string) {
  return { id, status: 'submitted' };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useReceiptsList', () => {
  it('loads page 1 and calls onPage1Loaded on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(page([receipt('1'), receipt('2')]));
    const onPage1Loaded = vi.fn();

    const { result } = renderHook(() => useReceiptsList(DEFAULT_FILTERS, 0, onPage1Loaded));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(onPage1Loaded).toHaveBeenCalledTimes(1);
  });

  it('loadMore appends rows using offset = current item count', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([receipt('1'), receipt('2')]))
      .mockResolvedValueOnce(page([receipt('3')]));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useReceiptsList(DEFAULT_FILTERS, 0, vi.fn()));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.items).toHaveLength(3);
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('offset=2');
  });

  it('loadMore is a no-op while a page-1 refetch is still in flight (the race guard)', async () => {
    // items must already be populated (a stale, pre-change page) with a
    // SECOND page-1 fetch (from a filters/tick change) left pending — a
    // guard that only checked `!items` would miss this: items is non-null
    // the whole time, so only `loading` catches the in-flight refetch.
    const pendingPage1 = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(page([receipt('1'), receipt('2')])).mockReturnValue(pendingPage1);
    global.fetch = fetchMock;

    const { result, rerender } = renderHook(
      ({ filters, tick }: { filters: Filters; tick: number }) => useReceiptsList(filters, tick, vi.fn()),
      { initialProps: { filters: DEFAULT_FILTERS, tick: 0 } }
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      rerender({ filters: DEFAULT_FILTERS, tick: 1 }); // triggers the pending refetch above
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    // items is still the STALE 2-row list here — the refetch hasn't resolved.
    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      await result.current.loadMore();
    });

    // Only 2 calls: initial page-1 + the in-flight refetch. loadMore must
    // NOT have fired a third request while loading was true.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not call onPage1Loaded when the page-1 fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: 'boom' } }),
    } as Response);
    const onPage1Loaded = vi.fn();

    const { result } = renderHook(() => useReceiptsList(DEFAULT_FILTERS, 0, onPage1Loaded));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(onPage1Loaded).not.toHaveBeenCalled();
    expect(result.current.errorMsg).toBeTruthy();
  });

  it('re-fetches page 1 (offset=0) when filters change, discarding loaded pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([receipt('1')]));
    global.fetch = fetchMock;

    const initialFilters: Filters = { ...DEFAULT_FILTERS, status: 'submitted' };
    const { result, rerender } = renderHook(
      ({ filters, tick }: { filters: Filters; tick: number }) => useReceiptsList(filters, tick, vi.fn()),
      { initialProps: { filters: initialFilters, tick: 0 } }
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const changedFilters: Filters = { ...DEFAULT_FILTERS, status: 'approved' };
    act(() => {
      rerender({ filters: changedFilters, tick: 0 });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('offset=0');
    expect(secondCallUrl).toContain('status=approved');
  });
});
