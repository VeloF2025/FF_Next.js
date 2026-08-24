/**
 * GET /api/fleet/trips?from=YYYY-MM-DD&to=YYYY-MM-DD[&vehicleId=uuid]
 *
 * Trips for a date range, newest first, with a summary that is HONEST about what it covers.
 *
 * Two things this route deliberately does rather than quietly smoothing over:
 *
 * 1. Totals are computed from metric-eligible trips only — those that closed on a genuine
 *    ignition-off. A trip closed by tracker silence has a real start and an unknown end, so
 *    averaging it into distance or duration produces a confident number that is wrong. The
 *    excluded ones are COUNTED and returned, so the caller can see what was left out instead of
 *    wondering why the totals look low.
 *
 * 2. Unattributed time is reported. An interval longer than the segmenter's ceiling is counted in
 *    a trip's duration but attributed to neither moving nor idle, because attributing it by the
 *    speed of the fix that closed it would book half an hour of driving as idling. That remainder
 *    is returned rather than left implicit — a summary showing 1,183 km against 0.0 hours of
 *    moving time is not wrong, but it is unreadable without it.
 *
 * 3. Coverage is reported. Only 18 of 23 active vehicles carry a tracker, so a fleet-wide total is
 *    a total for the tracked subset. Returning that ratio stops a partial answer reading as a
 *    complete one.
 *
 * Gated on `fleet.locations`, matching its closest sibling `locations.ts`. Bare `withAuth` would
 * let any authenticated user of any role pull every vehicle's movement history for any date range.
 * That is a heavier disclosure than the live-position endpoint which IS gated: one position is a
 * point in time, a trip history is a movement pattern per vehicle over weeks.
 *
 * `fleet.locations` is reused rather than a new `fleet.trips` because it is registered and
 * actually granted (7 roles today), and it covers the same data class. A dedicated `fleet.trips`
 * would be more precise, but registering it needs a migration AND role grants -- and several
 * fleet permissions in this repo are gated on keys nobody holds, which makes those routes
 * reachable only by super_admin. Shipping that shape here would be a dead endpoint, not tighter
 * security.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db-pool';

const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A single string from a query param that may legitimately arrive as an array. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface TripRow extends Record<string, unknown> {
  id: string;
  registration: string | null;
  ignition_on_at: string | Date;
  ignition_off_at: string | Date | null;
  close_reason: string;
  counts_toward_metrics: boolean;
  on_lat: string | null; on_lon: string | null;
  off_lat: string | null; off_lon: string | null;
  on_location_text: string | null; off_location_text: string | null;
  on_nearest_place_label: string | null; off_nearest_place_label: string | null;
  duration_seconds: string | null; moving_seconds: string | null; idle_seconds: string | null;
  unattributed_seconds: string | null;
  distance_km: string | null; max_speed_kph: string | null;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const from = one(req.query.from as string | string[] | undefined);
  const to = one(req.query.to as string | string[] | undefined);
  const vehicleId = one(req.query.vehicleId as string | string[] | undefined);

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return apiResponse.badRequest(res, 'from and to are required as YYYY-MM-DD');
  }
  if (from > to) {
    return apiResponse.badRequest(res, 'from must not be after to');
  }
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays > MAX_RANGE_DAYS) {
    return apiResponse.badRequest(res, `range must be ${MAX_RANGE_DAYS} days or fewer`);
  }
  if (vehicleId !== undefined && !UUID_RE.test(vehicleId)) {
    return apiResponse.badRequest(res, 'vehicleId must be a UUID');
  }

  // The range is inclusive of `to`, read as SAST calendar days: the business works in SAST and a
  // UTC boundary would drop the first two hours of the closing day.
  const startAt = `${from}T00:00:00+02:00`;
  const endAt = `${to}T23:59:59.999+02:00`;

  // Explicit query branches rather than a conditional SQL fragment: interpolated tagged-template
  // conditionals are broken in this repo.
  const rows = vehicleId === undefined
    ? await query<TripRow>(
        `/* fleet-trips:list */
         SELECT t.id, v.registration, t.ignition_on_at, t.ignition_off_at, t.close_reason,
                t.counts_toward_metrics, t.on_lat, t.on_lon, t.off_lat, t.off_lon,
                t.on_location_text, t.off_location_text,
                t.on_nearest_place_label, t.off_nearest_place_label,
                t.duration_seconds, t.moving_seconds, t.idle_seconds, t.unattributed_seconds,
                t.distance_km, t.max_speed_kph
         FROM fleet_vehicle_trips t
         LEFT JOIN fleet_vehicles v ON v.id = t.vehicle_id
         WHERE t.ignition_on_at >= $1::timestamptz AND t.ignition_on_at <= $2::timestamptz
         ORDER BY t.ignition_on_at DESC
         LIMIT $3`,
        [startAt, endAt, MAX_ROWS],
      )
    : await query<TripRow>(
        `/* fleet-trips:list-vehicle */
         SELECT t.id, v.registration, t.ignition_on_at, t.ignition_off_at, t.close_reason,
                t.counts_toward_metrics, t.on_lat, t.on_lon, t.off_lat, t.off_lon,
                t.on_location_text, t.off_location_text,
                t.on_nearest_place_label, t.off_nearest_place_label,
                t.duration_seconds, t.moving_seconds, t.idle_seconds, t.unattributed_seconds,
                t.distance_km, t.max_speed_kph
         FROM fleet_vehicle_trips t
         LEFT JOIN fleet_vehicles v ON v.id = t.vehicle_id
         WHERE t.vehicle_id = $1
           AND t.ignition_on_at >= $2::timestamptz AND t.ignition_on_at <= $3::timestamptz
         ORDER BY t.ignition_on_at DESC
         LIMIT $4`,
        [vehicleId, startAt, endAt, MAX_ROWS],
      );

  // Totals over metric-eligible trips only, computed in SQL so they cover the whole range rather
  // than only the page of rows returned above.
  const summary = vehicleId === undefined
    ? await queryOne<Record<string, string | null>>(
        `/* fleet-trips:summary */
         SELECT count(*) AS total,
                count(*) FILTER (WHERE counts_toward_metrics) AS eligible,
                count(*) FILTER (WHERE close_reason = 'timeout') AS timed_out,
                count(*) FILTER (WHERE close_reason = 'open') AS still_open,
                COALESCE(sum(distance_km) FILTER (WHERE counts_toward_metrics), 0) AS distance_km,
                COALESCE(sum(moving_seconds) FILTER (WHERE counts_toward_metrics), 0) AS moving_seconds,
                COALESCE(sum(idle_seconds) FILTER (WHERE counts_toward_metrics), 0) AS idle_seconds,
                COALESCE(sum(unattributed_seconds) FILTER (WHERE counts_toward_metrics), 0) AS unattributed_seconds
         FROM fleet_vehicle_trips
         WHERE ignition_on_at >= $1::timestamptz AND ignition_on_at <= $2::timestamptz`,
        [startAt, endAt],
      )
    : await queryOne<Record<string, string | null>>(
        `/* fleet-trips:summary-vehicle */
         SELECT count(*) AS total,
                count(*) FILTER (WHERE counts_toward_metrics) AS eligible,
                count(*) FILTER (WHERE close_reason = 'timeout') AS timed_out,
                count(*) FILTER (WHERE close_reason = 'open') AS still_open,
                COALESCE(sum(distance_km) FILTER (WHERE counts_toward_metrics), 0) AS distance_km,
                COALESCE(sum(moving_seconds) FILTER (WHERE counts_toward_metrics), 0) AS moving_seconds,
                COALESCE(sum(idle_seconds) FILTER (WHERE counts_toward_metrics), 0) AS idle_seconds,
                COALESCE(sum(unattributed_seconds) FILTER (WHERE counts_toward_metrics), 0) AS unattributed_seconds
         FROM fleet_vehicle_trips
         WHERE vehicle_id = $1
           AND ignition_on_at >= $2::timestamptz AND ignition_on_at <= $3::timestamptz`,
        [vehicleId, startAt, endAt],
      );

  const coverage = await queryOne<Record<string, string>>(
    `/* fleet-trips:coverage */
     SELECT count(*) FILTER (WHERE v.status = 'active') AS active_vehicles,
            count(*) FILTER (WHERE v.status = 'active' AND tr.id IS NOT NULL) AS tracked_vehicles
     FROM fleet_vehicles v
     LEFT JOIN fleet_vehicle_trackers tr ON tr.vehicle_id = v.id`,
    [],
  );

  return apiResponse.success(res, {
    filters: { from, to, vehicleId: vehicleId ?? null },
    trips: rows.map((r) => ({
      id: r.id,
      registration: r.registration,
      ignitionOnAt: iso(r.ignition_on_at),
      ignitionOffAt: iso(r.ignition_off_at),
      closeReason: r.close_reason,
      countsTowardMetrics: r.counts_toward_metrics,
      start: {
        lat: num(r.on_lat), lon: num(r.on_lon),
        place: r.on_nearest_place_label, locality: r.on_location_text,
      },
      end: {
        lat: num(r.off_lat), lon: num(r.off_lon),
        place: r.off_nearest_place_label, locality: r.off_location_text,
      },
      durationSeconds: num(r.duration_seconds),
      movingSeconds: num(r.moving_seconds),
      idleSeconds: num(r.idle_seconds),
      // Time inside the trip that could not honestly be called moving or idling, because the gap
      // between fixes was too long to attribute. Returned so a consumer can see it rather than
      // reading near-zero moving time as "this vehicle barely moves".
      unattributedSeconds: num(r.unattributed_seconds),
      distanceKm: num(r.distance_km),
      maxSpeedKph: num(r.max_speed_kph),
    })),
    // Every total below covers ONLY metric-eligible trips. `excluded` says what that cost.
    summary: {
      tripsTotal: Number(summary?.total ?? 0),
      tripsCounted: Number(summary?.eligible ?? 0),
      excluded: {
        timedOut: Number(summary?.timed_out ?? 0),
        stillOpen: Number(summary?.still_open ?? 0),
      },
      distanceKm: Number(summary?.distance_km ?? 0),
      movingSeconds: Number(summary?.moving_seconds ?? 0),
      idleSeconds: Number(summary?.idle_seconds ?? 0),
      // The remainder, surfaced deliberately. Sampling density varies enormously by provider —
      // cartrack's median inter-fix gap is 8 seconds, ituran's is 2,020 — so for sparse providers
      // almost NO time can be attributed while distance accrues in full. Without this figure a
      // caller sees full distance against near-zero moving time and reads it as a slow fleet
      // rather than as a measurement limit.
      unattributedSeconds: Number(summary?.unattributed_seconds ?? 0),
    },
    coverage: {
      activeVehicles: Number(coverage?.active_vehicles ?? 0),
      trackedVehicles: Number(coverage?.tracked_vehicles ?? 0),
    },
    truncated: rows.length === MAX_ROWS,
  });
}

async function permissionRouted(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // Read-only endpoint: 'view' is the only action it can take.
  return withPermission('fleet.locations', 'view')(handler)(req, res);
}

export default withAuth(permissionRouted);
