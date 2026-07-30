import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ZoneRegisterResult } from '../../types/zoneDelivery.types';
import { useZoneDeliveryRegister } from '../useZoneDeliveryRegister';

const fetchMock = vi.fn();
const emptyFilters = {};
const registerData = (projectName: string): ZoneRegisterResult => ({
  rows: [{
    projectId: projectName, projectName, zoneNo: 1, status: 'civil_construction',
    includedPons: 1, livePons: 0, earliestIncompleteGate: 'civil_complete', blockerCount: 0,
    civilQa: 'not_started', opticalQa: 'not_started', handedOverAt: null,
  }],
  summary: { zones: 1, includedPons: 1, livePons: 0, readyForQa: 0, handedOver: 0 },
});
const success = (data: ZoneRegisterResult) => ({ ok: true, json: async () => ({ success: true, data }) });
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => vi.useRealTimers());

describe('useZoneDeliveryRegister', () => {
  it('clears committed data for a delayed or failed filter request', async () => {
    fetchMock.mockResolvedValueOnce(success(registerData('Initial')));
    const initialFilters = {};
    const filteredFilters = { search: 'north' };
    const { result, rerender } = renderHook(({ filters }) => useZoneDeliveryRegister(filters), { initialProps: { filters: initialFilters } });
    await waitFor(() => expect(result.current.data?.rows[0]?.projectName).toBe('Initial'));
    const filtered = deferred<ReturnType<typeof success>>();
    fetchMock.mockReturnValueOnce(filtered.promise);
    rerender({ filters: filteredFilters });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    filtered.resolve({ ok: false, json: async () => ({ error: { message: 'Filter unavailable' } }) });
    await waitFor(() => expect(result.current.error).toBe('Filter unavailable'));
    expect(result.current.data).toBeNull();
  });

  it('keeps refresh timestamps unchanged until a successful refresh completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T10:00:00Z'));
    fetchMock.mockResolvedValueOnce(success(registerData('Initial')));
    const { result } = renderHook(() => useZoneDeliveryRegister(emptyFilters));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.lastUpdated?.toISOString()).toBe('2026-07-30T10:00:00.000Z');
    const failedRefresh = deferred<ReturnType<typeof success>>();
    fetchMock.mockReturnValueOnce(failedRefresh.promise);
    act(() => { void result.current.refresh(); });
    expect(result.current.lastUpdated?.toISOString()).toBe('2026-07-30T10:00:00.000Z');
    await act(async () => {
      failedRefresh.resolve({ ok: false, json: async () => ({ error: { message: 'Refresh unavailable' } }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBe('Refresh unavailable');
    expect(result.current.lastUpdated?.toISOString()).toBe('2026-07-30T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-07-30T10:05:00Z'));
    fetchMock.mockResolvedValueOnce(success(registerData('Refreshed')));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.lastUpdated?.toISOString()).toBe('2026-07-30T10:05:00.000Z');
  });

  it('suppresses aborted stale responses and aborts on unmount', async () => {
    const first = deferred<ReturnType<typeof success>>();
    const second = deferred<ReturnType<typeof success>>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const initialFilters = {};
    const filteredFilters = { search: 'north' };
    const { result, rerender, unmount } = renderHook(({ filters }) => useZoneDeliveryRegister(filters), { initialProps: { filters: initialFilters } });
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    rerender({ filters: filteredFilters });
    expect(firstSignal.aborted).toBe(true);
    first.resolve(success(registerData('Stale')));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.data).toBeNull();
    second.resolve(success(registerData('Current')));
    await waitFor(() => expect(result.current.data?.rows[0]?.projectName).toBe('Current'));
    const currentSignal = fetchMock.mock.calls[1]?.[1]?.signal as AbortSignal;
    unmount();
    expect(currentSignal.aborted).toBe(true);
  });

  it('rejects an API success false response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false, error: { message: 'Denied' } }) });
    const { result } = renderHook(() => useZoneDeliveryRegister(emptyFilters));
    await waitFor(() => expect(result.current.error).toBe('Denied'));
  });
});
