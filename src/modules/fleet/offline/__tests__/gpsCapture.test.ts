/**
 * Tests for captureGPS watchdog + captureGPSWithFallback.
 *
 * The watchdog exists because iOS Safari has been observed to silently
 * ignore the spec geolocation `timeout` in some configurations — the
 * error callback never fires and the caller awaits forever. We add an
 * outer wall-clock timer so a truly-hung call always settles.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureGPS,
  captureGPSWithFallback,
  isGeolocationAvailable,
} from '../gpsCapture';

type GeoCallback = (pos: GeolocationPosition) => void;
type GeoErrorCallback = (err: GeolocationPositionError) => void;

interface MockGeolocationOptions {
  /** Succeed after `ms` ms with these coords. */
  succeedWith?: { ms: number; coords: Partial<GeolocationCoordinates>; timestamp?: number };
  /** Fail after `ms` ms with this error code. */
  failWith?: { ms: number; code: 1 | 2 | 3 };
  /** Never call either callback. Simulates iOS Safari silent hang. */
  hang?: boolean;
}

function installMockGeolocation(opts: MockGeolocationOptions | MockGeolocationOptions[]) {
  const plans = Array.isArray(opts) ? [...opts] : [opts];
  let callIndex = 0;

  const impl = vi.fn<
    [GeoCallback, GeoErrorCallback, PositionOptions | undefined],
    void
  >((success, error) => {
    const plan = plans[Math.min(callIndex, plans.length - 1)];
    callIndex++;
    if (!plan) return;

    if (plan.hang) return;

    if (plan.succeedWith) {
      const { ms, coords, timestamp } = plan.succeedWith;
      setTimeout(() => {
        success({
          coords: {
            latitude: coords.latitude ?? 0,
            longitude: coords.longitude ?? 0,
            accuracy: coords.accuracy ?? 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          } as GeolocationCoordinates,
          timestamp: timestamp ?? Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition);
      }, ms);
    }

    if (plan.failWith) {
      const { ms, code } = plan.failWith;
      setTimeout(() => {
        error({
          code,
          message: 'mock error',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      }, ms);
    }
  });

  const mockGeo = { getCurrentPosition: impl } as unknown as Geolocation;
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: mockGeo,
    configurable: true,
  });
  return impl;
}

describe('isGeolocationAvailable', () => {
  it('returns true when navigator.geolocation is present', () => {
    installMockGeolocation({ succeedWith: { ms: 0, coords: {} } });
    expect(isGeolocationAvailable()).toBe(true);
  });
});

describe('captureGPS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on high-accuracy success', async () => {
    installMockGeolocation({
      succeedWith: { ms: 100, coords: { latitude: -33.9, longitude: 18.4, accuracy: 15 } },
    });
    const p = captureGPS(5000, true);
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    expect(r.success).toBe(true);
    expect(r.coordinates?.latitude).toBe(-33.9);
    expect(r.coordinates?.longitude).toBe(18.4);
    expect(r.errorKind).toBeUndefined();
  });

  it('maps PERMISSION_DENIED (code 1) to errorKind: "denied"', async () => {
    installMockGeolocation({ failWith: { ms: 50, code: 1 } });
    const p = captureGPS(5000, true);
    await vi.advanceTimersByTimeAsync(50);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('denied');
  });

  it('maps POSITION_UNAVAILABLE (code 2) to errorKind: "unavailable"', async () => {
    installMockGeolocation({ failWith: { ms: 50, code: 2 } });
    const p = captureGPS(5000, true);
    await vi.advanceTimersByTimeAsync(50);
    const r = await p;
    expect(r.errorKind).toBe('unavailable');
  });

  it('maps TIMEOUT (code 3) to errorKind: "timeout"', async () => {
    installMockGeolocation({ failWith: { ms: 50, code: 3 } });
    const p = captureGPS(5000, true);
    await vi.advanceTimersByTimeAsync(50);
    const r = await p;
    expect(r.errorKind).toBe('timeout');
  });

  it('watchdog fires when browser silently hangs (iOS Safari parity)', async () => {
    // Simulate iOS Safari bug: neither callback ever fires.
    installMockGeolocation({ hang: true });
    const p = captureGPS(5000, true);
    // Spec timeout = 5000. Watchdog = 5000 + 2000 = 7000.
    await vi.advanceTimersByTimeAsync(6999);
    // Not settled yet
    let settled = false;
    void p.then(() => { settled = true; });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('timeout');
    expect(r.error).toMatch(/stalled/i);
  });
});

describe('captureGPSWithFallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns high-accuracy result when first call succeeds', async () => {
    const impl = installMockGeolocation({
      succeedWith: { ms: 100, coords: { latitude: 1, longitude: 2, accuracy: 10 } },
    });
    const p = captureGPSWithFallback(5000, 10000);
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    expect(r.success).toBe(true);
    expect(impl).toHaveBeenCalledTimes(1);
    expect((impl.mock.calls[0]?.[2] as PositionOptions | undefined)?.enableHighAccuracy).toBe(true);
  });

  it('retries with low-accuracy when high-accuracy times out', async () => {
    const impl = installMockGeolocation([
      { failWith: { ms: 100, code: 3 } }, // high-acc TIMEOUT
      { succeedWith: { ms: 100, coords: { latitude: 5, longitude: 6, accuracy: 200 } } }, // low-acc OK
    ]);
    const p = captureGPSWithFallback(5000, 10000);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    expect(r.success).toBe(true);
    expect(r.coordinates?.accuracy).toBe(200);
    expect(impl).toHaveBeenCalledTimes(2);
    expect((impl.mock.calls[1]?.[2] as PositionOptions | undefined)?.enableHighAccuracy).toBe(false);
  });

  it('retries with low-accuracy when high-accuracy reports unavailable', async () => {
    const impl = installMockGeolocation([
      { failWith: { ms: 100, code: 2 } }, // high-acc POSITION_UNAVAILABLE
      { succeedWith: { ms: 100, coords: { accuracy: 150 } } },
    ]);
    const p = captureGPSWithFallback(5000, 10000);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r.success).toBe(true);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry when permission is denied — retry with different accuracy wouldnt help', async () => {
    const impl = installMockGeolocation({ failWith: { ms: 50, code: 1 } });
    const p = captureGPSWithFallback(5000, 10000);
    await vi.advanceTimersByTimeAsync(50);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('denied');
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
