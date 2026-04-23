/**
 * Cartrack HTTP client.
 *
 * Basic Auth against `CARTRACK_BASE_URL`. The REST shape below reflects
 * Cartrack's SA v2 API — a paginated `/vehicles/{id}/positions` endpoint
 * for historical samples and `/vehicles` for the fleet list.
 *
 * Design notes:
 *   - Fetch is injected via the factory so unit tests don't need network
 *     access. Production callers go through `cartrackClientFromEnv()`.
 *   - Every non-2xx except 404 throws — the reconcile job treats 404 as
 *     "vehicle not mapped" (an expected steady-state outcome for a
 *     fleet_vehicles row with a stale cartrack_vehicle_id), and anything
 *     else is a transient problem to surface loud so ops can retry.
 *   - Nearest-sample picker is pure: tests can feed in a hand-rolled
 *     sample array without hitting fetch.
 *   - Timeouts are enforced with AbortController — if the Cartrack side
 *     stalls, a nightly cron would otherwise hang for the whole window.
 */

import type {
  CartrackClient,
  CartrackFetchResult,
  CartrackPositionSample,
  CartrackVehicleSummary,
} from './types';

/** Default ±5 min search window per the PRD. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface CartrackClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 15s. */
  timeoutMs?: number;
}

interface PositionsResponse {
  positions?: Array<{
    timestamp?: string;
    latitude?: number;
    longitude?: number;
  }>;
}

interface VehiclesResponse {
  vehicles?: Array<{
    id?: string;
    registration?: string | null;
    description?: string | null;
  }>;
}

class HttpCartrackClient implements CartrackClient {
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: CartrackClientOptions) {
    this.auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchPositionAt(
    vehicleId: string,
    at: Date,
    toleranceMs: number = DEFAULT_TOLERANCE_MS
  ): Promise<CartrackFetchResult> {
    const from = new Date(at.getTime() - toleranceMs).toISOString();
    const to = new Date(at.getTime() + toleranceMs).toISOString();
    const url = `${trimSlash(this.opts.baseUrl)}/vehicles/${encodeURIComponent(
      vehicleId
    )}/positions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    let res: Response;
    try {
      res = await this.doFetch(url);
    } catch (err) {
      throw new CartrackError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 404) return { status: 'vehicle_not_mapped' };
    if (!res.ok) {
      throw new CartrackError('http', `Cartrack positions ${vehicleId}: HTTP ${res.status}`);
    }
    let body: PositionsResponse;
    try {
      body = (await res.json()) as PositionsResponse;
    } catch (parseErr) {
      throw new CartrackError(
        'http',
        `Cartrack positions ${vehicleId}: malformed JSON body (${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        })`
      );
    }
    if (body.positions !== undefined && !Array.isArray(body.positions)) {
      // Proxy rewrite, error envelope in 200, or Cartrack schema change.
      // Typed error lets the reconcile per-entry catch record it cleanly.
      throw new CartrackError(
        'http',
        `Cartrack positions ${vehicleId}: expected positions[] array, got ${typeof body.positions}`
      );
    }
    const samples = (body.positions ?? [])
      .map((p) => toSample(vehicleId, p))
      .filter((s): s is CartrackPositionSample => s !== null);

    const nearest = pickNearestSample(samples, at, toleranceMs);
    if (!nearest) return { status: 'no_data' };
    return { status: 'ok', sample: nearest };
  }

  async listVehicles(): Promise<CartrackVehicleSummary[]> {
    const url = `${trimSlash(this.opts.baseUrl)}/vehicles`;
    const res = await this.doFetch(url);
    if (!res.ok) {
      throw new CartrackError('http', `Cartrack vehicles list: HTTP ${res.status}`);
    }
    const body = (await res.json()) as VehiclesResponse;
    return (body.vehicles ?? [])
      .map((v) => ({
        cartrackId: v.id ?? '',
        registration: v.registration ?? null,
        description: v.description ?? null,
      }))
      .filter((v) => v.cartrackId.length > 0);
  }

  private async doFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.auth, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export class CartrackError extends Error {
  constructor(
    public readonly kind: 'network' | 'http' | 'config',
    message: string
  ) {
    super(`[cartrack/${kind}] ${message}`);
    this.name = 'CartrackError';
  }
}

export function cartrackClient(opts: CartrackClientOptions): CartrackClient {
  return new HttpCartrackClient(opts);
}

/**
 * Build a client from env vars. Throws `CartrackError(kind=config)` when
 * any of the three required vars is missing — the reconcile cron catches
 * that and exits non-zero with a clear stderr trail.
 */
export function cartrackClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): CartrackClient {
  const baseUrl = env.CARTRACK_BASE_URL;
  const username = env.CARTRACK_API_USER;
  const password = env.CARTRACK_API_PASS;
  if (!baseUrl || !username || !password) {
    throw new CartrackError(
      'config',
      'CARTRACK_BASE_URL, CARTRACK_API_USER and CARTRACK_API_PASS must all be set'
    );
  }
  return cartrackClient({ baseUrl, username, password, fetchImpl });
}

/**
 * Pure: pick the sample whose timestamp is closest to `at`, within
 * `toleranceMs`. Returns null if no sample is in range. Exported so
 * tests can exercise the picker without hitting HTTP.
 */
export function pickNearestSample(
  samples: CartrackPositionSample[],
  at: Date,
  toleranceMs: number
): CartrackPositionSample | null {
  if (samples.length === 0) return null;
  const atMs = at.getTime();
  let best: CartrackPositionSample | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    const delta = Math.abs(s.ts.getTime() - atMs);
    if (delta > toleranceMs) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}

function toSample(
  vehicleId: string,
  raw: { timestamp?: string; latitude?: number; longitude?: number }
): CartrackPositionSample | null {
  if (!raw.timestamp || raw.latitude == null || raw.longitude == null) return null;
  const ts = new Date(raw.timestamp);
  if (Number.isNaN(ts.getTime())) return null;
  return { vehicleId, lat: raw.latitude, lon: raw.longitude, ts };
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
