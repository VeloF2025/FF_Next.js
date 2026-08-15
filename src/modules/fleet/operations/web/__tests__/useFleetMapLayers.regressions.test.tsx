/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalMapOverlay } from '../../mapOverlayService';
import { useFleetMapLayers } from '../useFleetMapLayers';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-14T08:00:00.000Z';
const filters = { projectId: PROJECT_ID, workDate: '2026-08-13', asOf: NOW } as const;
const overlay: OperationalMapOverlay = {
  badges: [], attendancePoints: [], unplottable: [], page: 1, limit: 100, total: 0, hasMore: false,
  workDate: '2026-08-13', evaluatedAt: NOW,
};
const telemetry = { vehicles: [{ vehicleId: 'vehicle-1', registration: 'ABC 123', driverName: null,
  provider: 'cartrack', lat: -26.1, lon: 28.1, speedKph: 0, ignition: false, isSpeeding: false,
  recordedAt: NOW, ageSeconds: 10, isStale: false, staleAfterSeconds: 300, trackingState: 'tracked' as const }] };

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}
function forbidden(): Response {
  return { ok: false, status: 403, json: async () => ({
    success: false, error: { code: 'FORBIDDEN', message: 'Private scope' },
  }) } as Response;
}
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); }); }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useFleetMapLayers permission and presentation regressions', () => {
  it('clears a successful protected overlay after 403 while retaining telemetry', async () => {
    let overlayCalls = 0;
    global.fetch = vi.fn((input) => {
      if (String(input) === '/api/fleet/positions/live') return Promise.resolve(response(telemetry));
      overlayCalls += 1;
      return Promise.resolve(overlayCalls === 1 ? response(overlay) : forbidden());
    });
    const hook = renderHook(() => useFleetMapLayers(filters));
    await flush();
    expect(hook.result.current.overlay.data).toEqual(overlay);

    await act(async () => { await hook.result.current.overlay.refresh(); });

    expect(hook.result.current.overlay.data).toBeNull();
    expect(hook.result.current.overlay.lastSuccessAt).toBeNull();
    expect(hook.result.current.overlay.error).toMatchObject({ status: 403, kind: 'permission' });
    expect(hook.result.current.telemetry.data).toEqual(telemetry);
  });

  it('does not refetch or clear a valid overlay for presentation-only filter changes', async () => {
    global.fetch = vi.fn((input) => Promise.resolve(response(
      String(input) === '/api/fleet/positions/live' ? telemetry : overlay,
    )));
    const hook = renderHook(({ status, visibility }) => useFleetMapLayers({
      ...filters, status, visibility,
    }), { initialProps: { status: undefined as 'late' | undefined, visibility: 'all' as 'all' | 'drivers' } });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    hook.rerender({ status: 'late', visibility: 'drivers' });
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.overlay.data).toEqual(overlay);
  });
});
