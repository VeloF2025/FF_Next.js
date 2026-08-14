/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalMapOverlay } from '../../mapOverlayService';
import type { OperationalOverview } from '../../presentationTypes';
import { useFleetMapLayers } from '../useFleetMapLayers';
import { useOperationalOverview } from '../useOperationalOverview';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-14T08:00:00.000Z';
const currentFilters = { projectId: PROJECT_A, workDate: '2026-08-14', asOf: NOW } as const;
const historicalFilters = { projectId: PROJECT_A, workDate: '2026-08-13', asOf: '2026-08-13T08:00:00.000Z' } as const;

const overview: OperationalOverview & { workDate: string; evaluatedAt: string; rule: { id: string | null; version: number | null } } = {
  selectionState: 'no_attention', groups: [{ group: 'normal', count: 1 }],
  attention: { items: [], page: 1, limit: 25, total: 0, hasMore: false },
  roster: { page: 1, limit: 100, total: 1, hasMore: false }, workDate: '2026-08-14', evaluatedAt: NOW,
  rule: { id: '33333333-3333-4333-8333-333333333333', version: 1 },
};
const overlay: OperationalMapOverlay = {
  badges: [], attendancePoints: [], unplottable: [], page: 1, limit: 100,
  total: 0, hasMore: false, workDate: '2026-08-14', evaluatedAt: NOW,
};
const telemetry = {
  vehicles: [{ vehicleId: '44444444-4444-4444-8444-444444444444', registration: 'CA123',
    driverName: 'Driver One', provider: 'cartrack', lat: -26.1, lon: 28.1, speedKph: 0,
    ignition: false, isSpeeding: false, recordedAt: NOW, ageSeconds: 10, isStale: false,
    staleAfterSeconds: 300, trackingState: 'tracked' as const }],
};

function ok(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}
function fail(status: number, code: string, message: string): Response {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response;
}
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useOperationalOverview', () => {
  it('fetches immediately and refreshes a current work date every 30 seconds', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok(overview));
    const hook = renderHook(() => useOperationalOverview(currentFilters));
    await flush();

    expect(hook.result.current.data).toEqual(overview);
    expect(hook.result.current.lastSuccessAt).toBe(NOW);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not auto-refresh history but supports manual refresh', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok(overview));
    const hook = renderHook(() => useOperationalOverview(historicalFilters));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { await hook.result.current.refresh(); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts superseded and unmounted requests', async () => {
    const signals: AbortSignal[] = [];
    global.fetch = vi.fn((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    });
    const hook = renderHook(({ projectId }) => useOperationalOverview({ ...currentFilters, projectId }), {
      initialProps: { projectId: PROJECT_A },
    });
    await flush();
    hook.rerender({ projectId: PROJECT_B });
    await flush();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    hook.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('retains the last success and distinguishes transient failures from permission denial', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(ok(overview))
      .mockResolvedValueOnce(fail(503, 'SERVICE_UNAVAILABLE', 'Try again'))
      .mockResolvedValueOnce(fail(403, 'FORBIDDEN', 'No access'));
    const hook = renderHook(() => useOperationalOverview(historicalFilters));
    await flush();
    const lastSuccessAt = hook.result.current.lastSuccessAt;

    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.data).toEqual(overview);
    expect(hook.result.current.lastSuccessAt).toBe(lastSuccessAt);
    expect(hook.result.current.error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', kind: 'transient' });

    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.data).toEqual(overview);
    expect(hook.result.current.error).toMatchObject({ status: 403, code: 'FORBIDDEN', kind: 'permission' });
  });

  it('represents a malformed API envelope as a typed invalid-response failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => null,
    } as unknown as Response);
    const hook = renderHook(() => useOperationalOverview(historicalFilters));
    await flush();

    expect(hook.result.current.error).toMatchObject({
      status: 200, code: 'INVALID_RESPONSE', kind: 'transient',
    });
  });
});

describe('useFleetMapLayers', () => {
  it('keeps telemetry and operational overlay successes and errors independent', async () => {
    let telemetryCalls = 0;
    let overlayCalls = 0;
    global.fetch = vi.fn((input) => {
      if (String(input) === '/api/fleet/positions/live') {
        telemetryCalls += 1;
        return Promise.resolve(telemetryCalls === 1 ? ok(telemetry) : fail(502, 'BAD_GATEWAY', 'Telemetry down'));
      }
      overlayCalls += 1;
      return Promise.resolve(overlayCalls === 1 ? fail(503, 'SERVICE_UNAVAILABLE', 'Overlay down') : ok(overlay));
    });
    const hook = renderHook(() => useFleetMapLayers(historicalFilters));
    await flush();

    expect(hook.result.current.telemetry.data).toEqual(telemetry);
    expect(hook.result.current.telemetry.error).toBeNull();
    expect(hook.result.current.overlay.data).toBeNull();
    expect(hook.result.current.overlay.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    await act(async () => { await hook.result.current.overlay.refresh(); });
    await act(async () => { await hook.result.current.telemetry.refresh(); });
    expect(hook.result.current.overlay.data).toEqual(overlay);
    expect(hook.result.current.overlay.error).toBeNull();
    expect(hook.result.current.telemetry.data).toEqual(telemetry);
    expect(hook.result.current.telemetry.error).toMatchObject({ code: 'BAD_GATEWAY' });
  });

  it('refreshes both current layers at 30 seconds and aborts both on unmount', async () => {
    const signals: AbortSignal[] = [];
    global.fetch = vi.fn((input, init) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve(ok(String(input) === '/api/fleet/positions/live' ? telemetry : overlay));
    });
    const hook = renderHook(() => useFleetMapLayers(currentFilters));
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(global.fetch).toHaveBeenCalledTimes(4);

    hook.unmount();
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
