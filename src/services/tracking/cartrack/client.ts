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

import { log } from '@/lib/logger';
import type {
  CartrackClient,
  CartrackFetchResult,
  CartrackPositionSample,
  CartrackVehicleSummary,
} from './types';

/** Default ±5 min search window per the PRD. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Per-request page size for event fetches. Cartrack's /vehicles/events
 * endpoint caps at 1000; we request the cap explicitly so a single
 * default-sized page covers our ±5 min window for fleets up to ~50
 * vehicles pinging once a minute. If `meta.last_page > 1` comes back,
 * we throw rather than silently drop the tail.
 */
const MAX_EVENTS_PER_PAGE = 1000;
/**
 * Per-request page size for fleet list. Cartrack accepts up to 500 per
 * page on /vehicles.
 */
const MAX_VEHICLES_PER_PAGE = 500;
/**
 * Hard cap on pagination depth per call. Our ±5 min events window
 * should not produce more than ~1–2 pages even for a large fleet; a
 * value of 10 is generous headroom before we treat the response as
 * pathological (e.g. tenant misconfigured, stale baseUrl, runaway
 * pagination). For /vehicles this caps the effective fleet size at
 * MAX_PAGES * MAX_VEHICLES_PER_PAGE = 5000 vehicles.
 */
const MAX_PAGES = 10;
/**
 * Warn threshold: if more than this fraction of events returned for the
 * target vehicle within the window lack a GPS fix (null lat/lon), log
 * a warning so supervisors can triage mismatch exceptions that were
 * really "no usable fix."
 */
const NO_FIX_WARN_FRACTION = 0.5;

export interface CartrackClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 15s. */
  timeoutMs?: number;
}

/**
 * Shape of `GET /vehicles/events` response per Cartrack developer docs:
 * https://developer.cartrack.com/docs/fleet-api/get-events-for-all-vehicles
 *
 * Returns events for ALL vehicles in the window (24h max). We filter by
 * `vehicle_id` in-memory. Fields beyond lat/lon/ts/vehicle_id are ignored.
 */
interface EventsResponse {
  data?: Array<{
    vehicle_id?: number | string;
    registration?: string | null;
    event_ts?: string;
    latitude?: number | null;
    longitude?: number | null;
  }>;
  meta?: { total?: number; current_page?: number; last_page?: number };
}

/**
 * Shape of `GET /vehicles` response. The SA tenant uses:
 *   - `vehicle_id` (opaque integer) — stable identifier
 *   - `registration` (string) — INTERNAL placeholder like "TEMP-2084956"
 *   - `vehicle_name` (string) — the actual license plate (e.g. "MW67LFGP")
 *   - `client_vehicle_description` (string | null) — customer's own label
 *   - `chassis_number`, `model`, `manufacturer` — metadata for the mapping UI
 */
interface VehiclesResponse {
  data?: Array<{
    vehicle_id?: number | string;
    registration?: string | null;
    vehicle_name?: string | null;
    client_vehicle_description?: string | null;
    model?: string | null;
    manufacturer?: string | null;
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
    // Reject empty / whitespace vehicleId up front. A stored mapping of
    // '' (which the DB today doesn't forbid with a CHECK — see migration
    // 322 for the hardening) would otherwise match every Cartrack event
    // that happened to have a null vehicle_id in its payload, producing
    // garbage `match` verdicts.
    if (!vehicleId || !vehicleId.trim()) {
      throw new CartrackError(
        'config',
        'fetchPositionAt: vehicleId is required and must be non-empty'
      );
    }

    // Cartrack's events endpoint returns all vehicles in the window; filter
    // in-memory by vehicle_id. The endpoint caps the window at 24h, which
    // comfortably exceeds our default ±5 min tolerance.
    //
    // Date format per docs: `YYYY-MM-DD hh:mm:ss` (no timezone, assumed UTC).
    const from = cartrackTsFormat(new Date(at.getTime() - toleranceMs));
    const to = cartrackTsFormat(new Date(at.getTime() + toleranceMs));
    const buildUrl = (page: number) =>
      `${trimSlash(this.opts.baseUrl)}/vehicles/events` +
      `?start_timestamp=${encodeURIComponent(from)}` +
      `&end_timestamp=${encodeURIComponent(to)}` +
      `&limit=${MAX_EVENTS_PER_PAGE}` +
      `&page=${page}`;

    const { data: events, pages } = await this.fetchAllPages<
      NonNullable<EventsResponse['data']>[number]
    >(buildUrl, 'Cartrack events');

    // Malformed payload: an event row without a vehicle_id can't be
    // routed to any staff member — throw rather than silently drop.
    // Don't validate every row (defensive) — only the ones we'd match:
    // Cartrack is allowed to return rows for vehicles we don't care
    // about, but rows without a vehicle_id at all indicate a contract
    // breach.
    for (const e of events) {
      if (e.vehicle_id === undefined || e.vehicle_id === null) {
        throw new CartrackError(
          'http',
          'Cartrack events: row missing vehicle_id — payload malformation'
        );
      }
    }

    // Filter by vehicle_id. Both number and string are accepted (Cartrack
    // returns numeric IDs; stored mappings are strings). `String(…)` on a
    // validated non-null value is total.
    const forVehicle = events.filter(
      (e) => String(e.vehicle_id) === vehicleId
    );
    const samples = forVehicle
      .map((e) => toSample(vehicleId, e))
      .filter((s): s is CartrackPositionSample => s !== null);

    // Warn when a majority of matched events lacked a GPS fix — supervisors
    // triaging a downstream `mismatch` exception can see that the miss
    // was really "no usable fix in window," not a genuine discrepancy.
    if (
      forVehicle.length > 0 &&
      samples.length / forVehicle.length < NO_FIX_WARN_FRACTION
    ) {
      log.warn(
        '[cartrack-client] majority of events for vehicle had no GPS fix',
        {
          vehicleId,
          total: forVehicle.length,
          withFix: samples.length,
          windowStart: from,
          windowEnd: to,
          pagesFetched: pages,
        }
      );
    }

    const nearest = pickNearestSample(samples, at, toleranceMs);
    if (!nearest) return { status: 'no_data' };
    return { status: 'ok', sample: nearest };
  }

  async listVehicles(): Promise<CartrackVehicleSummary[]> {
    const buildUrl = (page: number) =>
      `${trimSlash(this.opts.baseUrl)}/vehicles` +
      `?limit=${MAX_VEHICLES_PER_PAGE}` +
      `&page=${page}`;
    const { data: rows } = await this.fetchAllPages<
      NonNullable<VehiclesResponse['data']>[number]
    >(buildUrl, 'Cartrack vehicles');

    // TODO(multi-tenant): vehicle_name is the real plate in the SA tenant
    // but may be a nickname/VIN in other regions where `registration`
    // holds the actual plate. Revisit when expanding beyond ZA.
    return rows
      .map((v) => ({
        cartrackId: String(v.vehicle_id ?? ''),
        registration: v.vehicle_name ?? v.client_vehicle_description ?? null,
        description:
          [v.manufacturer, v.model].filter(Boolean).join(' ').trim() || null,
      }))
      .filter((v) => v.cartrackId.length > 0);
  }

  /**
   * Follows Cartrack pagination. Sequential (not concurrent) so we don't
   * hammer the tenant. Aggregates `data[]` across all pages. Hard-caps
   * at `MAX_PAGES` and throws if that's exceeded — an unbounded loop on
   * a nightly cron is worse than failing loud.
   *
   * Shape invariants enforced on every page:
   *   - HTTP 2xx
   *   - body.data is Array<T> (symmetric null/undefined throw)
   *   - body.meta.last_page is a positive int when present (defaults to 1)
   *
   * Returns the flat list plus the count of pages actually fetched so
   * callers can telemeter deep pagination.
   */
  private async fetchAllPages<T>(
    buildUrl: (page: number) => string,
    errorPrefix: string
  ): Promise<{ data: T[]; pages: number }> {
    const all: T[] = [];
    let page = 1;
    while (true) {
      let res: Response;
      try {
        res = await this.doFetch(buildUrl(page));
      } catch (err) {
        throw new CartrackError(
          'network',
          err instanceof Error ? err.message : String(err)
        );
      }
      if (!res.ok) {
        throw new CartrackError(
          'http',
          `${errorPrefix}: HTTP ${res.status} (page ${page})`
        );
      }
      let body: {
        data?: T[] | null;
        meta?: { current_page?: number; last_page?: number };
      };
      try {
        body = await res.json();
      } catch (parseErr) {
        throw new CartrackError(
          'http',
          `${errorPrefix}: malformed JSON body on page ${page} (${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          })`
        );
      }
      if (!Array.isArray(body.data)) {
        throw new CartrackError(
          'http',
          `${errorPrefix}: expected data[] array on page ${page}, got ${
            body.data === undefined
              ? 'undefined'
              : body.data === null
                ? 'null'
                : typeof body.data
          }`
        );
      }
      all.push(...body.data);
      const lastPage = body.meta?.last_page ?? 1;
      if (page >= lastPage) return { data: all, pages: page };
      page += 1;
      if (page > MAX_PAGES) {
        throw new CartrackError(
          'http',
          `${errorPrefix}: pagination exceeded MAX_PAGES=${MAX_PAGES} ` +
            `(fetched through page ${page - 1} of ${lastPage}; ` +
            `shrink the window or raise the cap)`
        );
      }
    }
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

/**
 * Cartrack expects timestamps in `YYYY-MM-DD hh:mm:ss` (no TZ suffix,
 * interpreted as UTC per the docs' examples). Not ISO-8601.
 */
function cartrackTsFormat(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Detects an explicit timezone suffix on a possibly-ISO string.
 * Matches: `Z` or `z` at end; `+02:00`, `-0530`, `+02` — anything Date
 * would treat as TZ-anchored.
 */
const TZ_SUFFIX_RE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

function toSample(
  vehicleId: string,
  raw: {
    event_ts?: string;
    latitude?: number | null;
    longitude?: number | null;
  }
): CartrackPositionSample | null {
  if (!raw.event_ts || raw.latitude == null || raw.longitude == null) return null;
  // Cartrack event_ts is documented as `YYYY-MM-DD hh:mm:ss` in UTC.
  // Always check for a TZ suffix (covers: space-separated no-TZ,
  // ISO-8601 with Z, ISO-8601 with offset, AND the failure mode where
  // Cartrack ever returns `YYYY-MM-DDTHH:MM:SS` without a Z — which
  // `new Date()` would otherwise parse as LOCAL time).
  const hasTz = TZ_SUFFIX_RE.test(raw.event_ts);
  const normalised = raw.event_ts.replace(' ', 'T') + (hasTz ? '' : 'Z');
  const ts = new Date(normalised);
  if (Number.isNaN(ts.getTime())) return null;
  return { vehicleId, lat: raw.latitude, lon: raw.longitude, ts };
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
