import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityFixture,
  ponStageId,
  projectId,
  snagId,
  zoneFixture,
} from '../../components/__tests__/zoneDeliveryWorkspaceFixture';
import { useZoneDeliveryZone } from '../useZoneDeliveryZone';

const fetchMock = vi.fn();
const response = (data: unknown, ok = true) => ({
  ok,
  json: async () => ({ success: ok, data }),
});
const deferred = <T,>() => {
  let resolve = (_value: T) => undefined;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};
const reads = () => {
  fetchMock
    .mockResolvedValueOnce(response(zoneFixture))
    .mockResolvedValueOnce(response(activityFixture));
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('useZoneDeliveryZone reads', () => {
  it('uses exact snake-case keys and loads zone plus activity', async () => {
    reads();
    const { result } = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/zone-delivery/zone?project_id=${projectId}&zone_no=12`,
      `/api/zone-delivery/activity?project_id=${projectId}&zone_no=12`,
    ]);
    expect(result.current.zone).toEqual(zoneFixture);
    expect(result.current.activity).toEqual(activityFixture);
  });

  it('aborts and suppresses a stale read after the key changes', async () => {
    const oldZone = deferred<ReturnType<typeof response>>();
    const oldActivity = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(oldZone.promise).mockReturnValueOnce(oldActivity.promise);
    const { result, rerender } = renderHook(
      ({ zoneNo }) => useZoneDeliveryZone({ projectId, zoneNo }),
      { initialProps: { zoneNo: 12 } },
    );
    reads();
    rerender({ zoneNo: 13 });
    await waitFor(() => expect(result.current.zone?.zoneNo).toBe(12));
    const signals = fetchMock.mock.calls.slice(0, 2).map(([, options]) =>
      (options as RequestInit).signal);
    expect(signals.every(signal => signal?.aborted)).toBe(true);
    oldZone.resolve(response({ ...zoneFixture, zoneNo: 99 }));
    oldActivity.resolve(response(activityFixture));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.zone?.zoneNo).toBe(12);
  });

  it('preserves current data only during an explicit refresh', async () => {
    reads();
    const { result } = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
    await waitFor(() => expect(result.current.zone).toEqual(zoneFixture));
    const refreshZone = deferred<ReturnType<typeof response>>();
    const refreshActivity = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(refreshZone.promise).mockReturnValueOnce(refreshActivity.promise);
    act(() => { void result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.zone).toEqual(zoneFixture);
    refreshZone.resolve(response({ ...zoneFixture, status: 'handed_over' }));
    refreshActivity.resolve(response(activityFixture));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.zone?.status).toBe('handed_over');
  });
});

describe('useZoneDeliveryZone commands', () => {
  it('sends the PON row version and audited milestone values then refetches on success', async () => {
    reads();
    const { result } = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce(response(zoneFixture));
    reads();
    await act(() => result.current.confirmMilestone({
      ponStageId,
      milestone: 'testing_passed',
      action: 'reopen',
      expectedRowVersion: 7,
      effectiveAt: '2026-07-30T08:00:00.000Z',
      source: 'Supervisor review',
      reason: 'Incorrect original test',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/zone-delivery/pon-milestone',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId, zoneNo: 12, ponStageId, milestone: 'testing_passed',
          action: 'reopen', expectedRowVersion: 7,
          effectiveAt: '2026-07-30T08:00:00.000Z',
          source: 'Supervisor review', reason: 'Incorrect original test',
        }),
      }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('keeps a version conflict visible and does not refetch a failed command', async () => {
    reads();
    const { result } = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: { code: 'VERSION_CONFLICT', message: 'Zone version is stale' },
      }),
    });
    await act(() => result.current.recordZoneQa({
      discipline: 'optical', status: 'failed', notes: 'Repair needed',
      snagIds: [snagId], expectedRowVersion: 11,
      effectiveAt: '2026-07-30T08:00:00.000Z',
      source: 'Zone inspection', reason: 'Backdated inspection',
    }));
    expect(result.current.error).toContain('Zone version is stale');
    expect(result.current.errorCode).toBe('VERSION_CONFLICT');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let an old successful command refetch or mutate a new route key', async () => {
    reads();
    const { result, rerender } = renderHook(
      ({ zoneNo }) => useZoneDeliveryZone({ projectId, zoneNo }),
      { initialProps: { zoneNo: 12 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const command = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(command.promise);
    let completion: Promise<boolean> | undefined;
    act(() => {
      completion = result.current.confirmMilestone({
        ponStageId, milestone: 'technically_live', action: 'confirm',
        expectedRowVersion: 7, effectiveAt: '2026-07-30T08:00:00.000Z', source: 'Operations',
      });
    });
    fetchMock
      .mockResolvedValueOnce(response({ ...zoneFixture, zoneNo: 13 }))
      .mockResolvedValueOnce(response(activityFixture));
    rerender({ zoneNo: 13 });
    await waitFor(() => expect(result.current.zone?.zoneNo).toBe(13));
    command.resolve(response(zoneFixture));
    await act(async () => { expect(await completion).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.current.zone?.zoneNo).toBe(13);
    expect(result.current.error).toBeNull();
    expect(result.current.mutating).toBe(false);
  });

  it('ignores a delayed command failure after unmount', async () => {
    reads();
    const { result, unmount } = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const command = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(command.promise);
    let completion: Promise<boolean> | undefined;
    act(() => {
      completion = result.current.confirmMilestone({
        ponStageId, milestone: 'technically_live', action: 'confirm',
        expectedRowVersion: 7, effectiveAt: '2026-07-30T08:00:00.000Z', source: 'Operations',
      });
    });
    unmount();
    command.resolve({
      ok: false,
      json: async () => ({ success: false, error: { code: 'VERSION_CONFLICT', message: 'Old error' } }),
    });
    await act(async () => { expect(await completion).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
