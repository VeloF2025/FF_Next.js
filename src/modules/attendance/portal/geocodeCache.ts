/**
 * Tiny in-memory cache + in-flight dedupe for the /my portal's reverse-
 * geocode proxy (`/api/my/geocode`).
 *
 * Why the key is rounded to 3 decimal places: ~110 m at the equator. Two
 * staff clocking in at opposite corners of the same work site hit the
 * same cache bucket, so Nominatim gets ONE request per site per 5 min
 * rather than one per person. Matches the accuracy we actually display
 * to the user (5-15 m on a good fix, 50-500 m on low-accuracy fallback
 * — both well inside one bucket).
 *
 * `inFlight` prevents a thundering-herd when multiple staff tap
 * clock-in within milliseconds of each other: the first call hits
 * Nominatim, everyone else awaits the same Promise.
 *
 * Pattern mirrors src/services/middleware/projectAccess/cache.ts but
 * scoped tighter — we don't need per-module eviction hooks or stats.
 */
export interface GeocodeResult {
  city: string;
  municipalDistrict: string;
  province: string;
}

interface Entry {
  data: GeocodeResult | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<GeocodeResult | null>>();

function keyFor(lat: number, lon: number): string {
  return `${lat.toFixed(3)}:${lon.toFixed(3)}`;
}

/** Returns the cached result if fresh, else `undefined` (miss). `null`
 *  is a legitimate cached value meaning "we tried, there was nothing". */
export function getCachedGeocode(
  lat: number,
  lon: number
): GeocodeResult | null | undefined {
  const key = keyFor(lat, lon);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

export function setCachedGeocode(
  lat: number,
  lon: number,
  data: GeocodeResult | null
): void {
  cache.set(keyFor(lat, lon), { data, expiresAt: Date.now() + TTL_MS });
}

/**
 * Dedupe in-flight requests by cache key. Call `tracker(fn)` — if a call
 * for this key is already running, you get the same Promise back;
 * otherwise `fn()` runs and its Promise is shared with any further
 * concurrent callers until it settles.
 */
export function dedupeInFlight(
  lat: number,
  lon: number,
  fn: () => Promise<GeocodeResult | null>
): Promise<GeocodeResult | null> {
  const key = keyFor(lat, lon);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/** Test-only reset — never wired into runtime. Keeps unit tests
 *  deterministic without module-reload gymnastics. */
export function __resetGeocodeCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
