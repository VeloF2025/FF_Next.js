import { query } from '@/lib/db-pool';
import { DWELL_GAP_CAP_SECONDS, type ProjectDwellShare, type VehicleDwellSample } from './types';

/**
 * Per-vehicle dwell inside each project AOI, over a window.
 *
 * `project_aois` and NOT `fno_atlas_project_aois`: the atlas table has no
 * project link and carries overlapping live duplicates for the same place
 * (`LAW` and `Lawley` are both live rows on production), which would split one
 * vehicle's dwell across two rows and manufacture roaming out of nothing.
 * `project_aois` has a real FK to `projects` and exactly one AOI per project.
 *
 * `aoi` is `geography`, so the `::geometry` cast is load-bearing - without it
 * ST_Contains does not resolve (`function st_contains(geography, geometry)
 * does not exist`).
 *
 * Two AOIs genuinely overlap on production (Thembisa POP 1 and POP 3 share 14%
 * of POP 1's area), so a position inside N AOIs contributes 1/N to each rather
 * than a whole ping to both. Shares then still sum to 1.
 *
 * $1 window start, $2 window end (exclusive), $3 dwell gap cap in seconds.
 */
export const VEHICLE_DWELL_SQL = `
  WITH domain AS (
    SELECT v.id AS vehicle_id, v.registration
    FROM fleet_vehicles v
    WHERE EXISTS (
            SELECT 1 FROM vehicle_assignments va
            WHERE va.fleet_vehicle_id = v.id AND va.is_active
          )
       OR EXISTS (
            SELECT 1 FROM fleet_vehicle_positions p
            WHERE p.vehicle_id = v.id AND p.recorded_at >= $1 AND p.recorded_at < $2
          )
  ),
  paired AS (
    SELECT p.id, p.vehicle_id, p.recorded_at, p.lat, p.lon,
           lead(p.recorded_at) OVER (
             PARTITION BY p.vehicle_id ORDER BY p.recorded_at, p.id
           ) AS next_recorded_at
    FROM fleet_vehicle_positions p
    JOIN domain d ON d.vehicle_id = p.vehicle_id
    WHERE p.recorded_at >= $1 AND p.recorded_at < $2
  ),
  pos AS (
    -- The CASE is not decoration. LEAST() ignores NULL arguments, so
    -- LEAST(NULL, 900) is 900, not NULL - written the obvious way, every
    -- vehicle's final ping in the window silently banks a full 15-minute cap
    -- of dwell it never spent. The last ping gets 0 instead, which under-counts
    -- by at most one gap per vehicle per window.
    SELECT id, vehicle_id, recorded_at, lat, lon,
           CASE
             WHEN next_recorded_at IS NULL THEN 0
             ELSE LEAST(EXTRACT(epoch FROM next_recorded_at - recorded_at), $3::numeric)
           END AS gap_seconds
    FROM paired
  ),
  totals AS (
    SELECT vehicle_id, count(*)::int AS total_positions FROM pos GROUP BY vehicle_id
  ),
  hit AS (
    SELECT pos.vehicle_id, pos.recorded_at, pos.gap_seconds,
           a.project_id,
           count(*) OVER (PARTITION BY pos.id) AS aoi_count
    FROM pos
    JOIN project_aois a
      ON ST_Contains(a.aoi::geometry, ST_SetSRID(ST_MakePoint(pos.lon, pos.lat), 4326))
  ),
  agg AS (
    SELECT h.vehicle_id, h.project_id,
           sum(1.0 / h.aoi_count) AS pings,
           sum(h.gap_seconds / h.aoi_count) AS dwell_seconds,
           count(DISTINCT (h.recorded_at AT TIME ZONE 'Africa/Johannesburg')::date) AS distinct_days
    FROM hit h
    GROUP BY h.vehicle_id, h.project_id
  )
  SELECT d.vehicle_id, d.registration,
         COALESCE(t.total_positions, 0) AS total_positions,
         agg.project_id, pr.project_name, agg.pings, agg.dwell_seconds, agg.distinct_days
  FROM domain d
  LEFT JOIN totals t ON t.vehicle_id = d.vehicle_id
  LEFT JOIN agg ON agg.vehicle_id = d.vehicle_id
  LEFT JOIN projects pr ON pr.id = agg.project_id
  ORDER BY d.registration, agg.dwell_seconds DESC NULLS LAST`;

interface DwellRow extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  total_positions: number;
  project_id: string | null;
  project_name: string | null;
  pings: string | number | null;
  dwell_seconds: string | number | null;
  distinct_days: string | number | null;
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Groups the flat dwell rows into one sample per vehicle. */
export function groupDwellRows(rows: DwellRow[]): VehicleDwellSample[] {
  const byVehicle = new Map<string, VehicleDwellSample>();
  for (const row of rows) {
    let sample = byVehicle.get(row.vehicle_id);
    if (!sample) {
      sample = {
        vehicleId: row.vehicle_id,
        registration: row.registration,
        totalPositions: toNumber(row.total_positions),
        shares: [],
      };
      byVehicle.set(row.vehicle_id, sample);
    }
    // A vehicle in the domain with no AOI hit still gets its LEFT JOIN row, and
    // must produce a sample with no shares rather than vanish from the output.
    if (row.project_id === null) continue;
    const share: ProjectDwellShare = {
      projectId: row.project_id,
      projectName: row.project_name ?? row.project_id,
      pings: toNumber(row.pings),
      dwellSeconds: toNumber(row.dwell_seconds),
      distinctDays: toNumber(row.distinct_days),
    };
    sample.shares.push(share);
  }
  return [...byVehicle.values()];
}

export async function loadVehicleDwellSamples(
  windowStart: Date,
  windowEnd: Date,
  gapCapSeconds: number = DWELL_GAP_CAP_SECONDS,
): Promise<VehicleDwellSample[]> {
  const rows = await query<DwellRow>(VEHICLE_DWELL_SQL, [
    windowStart.toISOString(),
    windowEnd.toISOString(),
    gapCapSeconds,
  ]);
  return groupDwellRows(rows);
}
