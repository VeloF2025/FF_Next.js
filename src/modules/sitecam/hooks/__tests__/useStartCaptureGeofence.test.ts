import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useStartCaptureGeofence } from '../useStartCaptureGeofence';
import { encodeGeofenceParam, buildReading } from '../../lib/geofence';

function stubGeo(pos: { latitude: number; longitude: number; accuracy: number } | null) {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback, err: PositionErrorCallback) =>
        pos ? ok({ coords: pos } as GeolocationPosition) : err({ code: 1 } as GeolocationPositionError),
    },
  });
}

beforeEach(() => pushMock.mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
});

const site = { siteId: 'DR1', plannedLat: -26.1, plannedLon: 27.5 };

describe('useStartCaptureGeofence', () => {
  it('navigates immediately when on_site (no warning)', async () => {
    stubGeo({ latitude: -26.1, longitude: 27.5, accuracy: 5 });
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning).toBeNull();
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [arg] = pushMock.mock.calls[0];
    expect(arg.pathname).toContain('/my/sitecam/');
    expect(arg.query.gf).toBe(
      encodeGeofenceParam(buildReading({ plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 })),
    );
  });

  it('surfaces a warning and defers navigation when out_of_range', async () => {
    stubGeo({ latitude: -26.101, longitude: 27.5, accuracy: 5 });
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning?.status).toBe('out_of_range');
    expect(pushMock).not.toHaveBeenCalled();
    act(() => result.current.confirmContinue());
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('warns device_gps_off when GPS denied but planned present', async () => {
    stubGeo(null);
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning?.status).toBe('device_gps_off');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates silently when planned coords missing (no_planned_coords)', async () => {
    stubGeo(null);
    const { result } = renderHook(() =>
      useStartCaptureGeofence({ siteId: 'DR1', plannedLat: null, plannedLon: null }),
    );
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning).toBeNull();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
