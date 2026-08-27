import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeliveryTree } from '../useDeliveryTree';
import type { DeliveryTreeFilters } from '../useDeliveryTree';
import type { DeliveryTreeResult } from '../types';

const fetchMock = vi.fn();

const tree = (projectName: string): DeliveryTreeResult => ({
  projects: [{
    id: projectName,
    name: projectName,
    zones: [{
      zone_no: 1,
      status: 'WIP',
      counts: { poles_total: 1, poles_planted: 0, activation_total: 0, activation_complete: 0 },
      pons: [],
    }],
  }],
});

const success = (data: DeliveryTreeResult) => ({ ok: true, json: async () => ({ success: true, data }) });

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const filters = (projectId: string): DeliveryTreeFilters => ({ projectId, opticalSubmittedOnly: false });

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

describe('useDeliveryTree', () => {
  it('sends projectId and opticalSubmittedOnly only when they are set', async () => {
    fetchMock.mockResolvedValue(success(tree('First')));
    const { rerender } = renderHook(
      ({ current }) => useDeliveryTree(current),
      { initialProps: { current: { projectId: '', opticalSubmittedOnly: false } } },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/construction-qa/delivery-tree');

    rerender({ current: { projectId: 'abc', opticalSubmittedOnly: true } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://localhost');
    expect(request.searchParams.get('projectId')).toBe('abc');
    expect(request.searchParams.get('opticalSubmittedOnly')).toBe('1');
  });

  it('aborts the in-flight request when the filters change', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise(() => undefined);
    });

    const { rerender } = renderHook(
      ({ current }) => useDeliveryTree(current),
      { initialProps: { current: filters('') } },
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    rerender({ current: filters('second') });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it('aborts the in-flight request when refresh is called', async () => {
    // Distinct from the filter-change path above: no effect cleanup runs here,
    // so only the abort inside the loader can cancel the previous request.
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise(() => undefined);
    });

    const { result } = renderHook(() => useDeliveryTree(filters('')));
    await waitFor(() => expect(signals).toHaveLength(1));

    await act(async () => { void result.current.refresh(); });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it('ignores a stale response that resolves after a newer request started', async () => {
    const stale = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fresh = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const { result, rerender } = renderHook(
      ({ current }) => useDeliveryTree(current),
      { initialProps: { current: filters('') } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ current: filters('second') });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The newer request lands first, then the superseded one resolves.
    await act(async () => { fresh.resolve(success(tree('Fresh'))); await fresh.promise; });
    await waitFor(() => expect(result.current.data?.projects[0]?.name).toBe('Fresh'));

    await act(async () => { stale.resolve(success(tree('Stale'))); await stale.promise; });
    expect(result.current.data?.projects[0]?.name).toBe('Fresh');
  });

  it('surfaces the API error message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { message: 'projectId must be a UUID' } }),
    });

    const { result } = renderHook(() => useDeliveryTree(filters('')));

    await waitFor(() => expect(result.current.error).toBe('projectId must be a UUID'));
    expect(result.current.loading).toBe(false);
  });
});
