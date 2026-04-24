/**
 * Unit tests for the reverse-geocode TTL cache + in-flight dedupe.
 * The cache backs /api/my/geocode; we need to be confident that:
 *   - Fresh reads hit
 *   - Stale reads miss
 *   - The 3-d.p. rounding groups nearby coords into the same bucket
 *   - A concurrent second call doesn't launch a second Nominatim request
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dedupeInFlight,
  getCachedGeocode,
  setCachedGeocode,
  __resetGeocodeCacheForTests,
  type GeocodeResult,
} from '../geocodeCache';

const sample: GeocodeResult = {
  city: 'Somerset West',
  municipalDistrict: 'City of Cape Town',
  province: 'Western Cape',
};

describe('geocodeCache', () => {
  beforeEach(() => {
    __resetGeocodeCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('miss when nothing set', () => {
    expect(getCachedGeocode(-34.069, 18.844)).toBeUndefined();
  });

  it('hit with the exact same coord', () => {
    setCachedGeocode(-34.069, 18.844, sample);
    expect(getCachedGeocode(-34.069, 18.844)).toEqual(sample);
  });

  it('hit when coords differ by less than ~110m (3-d.p. bucket)', () => {
    setCachedGeocode(-34.0691, 18.8441, sample);
    // Same bucket when rounded to 3 decimals
    expect(getCachedGeocode(-34.0694, 18.8444)).toEqual(sample);
  });

  it('miss when coords are in a neighbouring bucket', () => {
    setCachedGeocode(-34.069, 18.844, sample);
    // 0.002 ≈ 220m away in each axis
    expect(getCachedGeocode(-34.071, 18.846)).toBeUndefined();
  });

  it('expires after 5 minutes', () => {
    setCachedGeocode(-34.069, 18.844, sample);
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(getCachedGeocode(-34.069, 18.844)).toEqual(sample);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getCachedGeocode(-34.069, 18.844)).toBeUndefined();
  });

  it('caches a null result (legit "nothing found" response)', () => {
    setCachedGeocode(-34.069, 18.844, null);
    // null is a valid cached value; distinguishable from `undefined` miss
    expect(getCachedGeocode(-34.069, 18.844)).toBeNull();
  });
});

describe('dedupeInFlight', () => {
  beforeEach(() => {
    __resetGeocodeCacheForTests();
  });

  it('runs fn exactly once for concurrent calls with same key', async () => {
    let calls = 0;
    let resolver: ((v: GeocodeResult | null) => void) | undefined;
    const slowFn = () =>
      new Promise<GeocodeResult | null>((resolve) => {
        calls++;
        resolver = resolve;
      });

    const p1 = dedupeInFlight(-34.069, 18.844, slowFn);
    const p2 = dedupeInFlight(-34.069, 18.844, slowFn);
    const p3 = dedupeInFlight(-34.069, 18.844, slowFn);

    expect(calls).toBe(1);
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    resolver?.(sample);
    await expect(p1).resolves.toEqual(sample);
    await expect(p2).resolves.toEqual(sample);
  });

  it('runs fn for each distinct key', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(sample);
    };

    await Promise.all([
      dedupeInFlight(-34.069, 18.844, fn),
      dedupeInFlight(-34.100, 18.900, fn),
    ]);

    expect(calls).toBe(2);
  });

  it('allows a fresh call after the previous settles', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(sample);
    };

    await dedupeInFlight(-34.069, 18.844, fn);
    await dedupeInFlight(-34.069, 18.844, fn);

    expect(calls).toBe(2);
  });
});
