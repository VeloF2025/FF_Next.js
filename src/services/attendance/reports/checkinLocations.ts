/**
 * checkin-locations report.
 *
 * One row per clock **event** — a clock-in and a clock-out are two separate
 * rows — because location is a property of the event, not of the day. Each
 * row carries where it happened, how far that was from the nearest project
 * AOI, how trustworthy the fix was, and a link to the selfie captured with it.
 *
 * The selfie column is a link to `/api/staff/attendance-selfie`, never the
 * raw `/storage/...` URL. The storage proxy serves those bytes to anyone
 * holding the link with no cookie, so putting them in a report — which
 * exports to XLSX and travels — would hand out unauthenticated access to
 * staff biometrics. The API route enforces RBAC, narrows to the viewer's
 * supervisor scope, and writes the POPIA access-log row. `evidenceQuality`
 * and `dayExceptionQueries` report selfie presence for the same reason.
 *
 * The distance is measured against a convex hull of the project's poles
 * (see `projectAoiSql.ts`), not against `fleet_authorized_locations`: that
 * table is empty, which is why the existing `geo-mismatch` report returns
 * nothing useful.
 *
 * This report only observes. Nothing here gates a clock-in.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import { AOI_STALE_AFTER_HOURS, PROJECT_AOI_CTE } from './projectAoiSql';
import { REPORT_ROW_CAP, ReportTooLargeError } from './runner';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

/** Distance under which an event counts as "near" rather than "far", metres. */
export const NEAR_THRESHOLD_M = 500;

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'work_date', label: 'Date' },
  { key: 'time_sast', label: 'Time (SAST)' },
  { key: 'event', label: 'Event' },
  { key: 'staff', label: 'Staff' },
  { key: 'employee_id', label: 'Emp #' },
  { key: 'department', label: 'Dept' },
  { key: 'verdict', label: 'Verdict' },
  { key: 'nearest_project', label: 'Nearest project' },
  { key: 'distance_m', label: 'Distance (m)', align: 'right', format: 'integer' },
  { key: 'accuracy_m', label: 'GPS ± (m)', align: 'right', format: 'number' },
  // Numbers, not strings: every SA latitude is negative, and the CSV
  // formula-injection guard prefixes a leading '-' with an apostrophe, so a
  // string coordinate lands in Excel as text ('-33.8794508) that no mapping
  // tool will parse. Deliberately no 'number' format — that rounds to 2dp
  // and would throw away ~1 km of precision.
  { key: 'lat', label: 'Lat', align: 'right' },
  { key: 'lon', label: 'Lon', align: 'right' },
  { key: 'selfie', label: 'Selfie', format: 'selfie_link' },
  { key: 'device_fingerprint', label: 'Device' },
  { key: 'entry_id', label: 'Entry ID' },
];

/**
 * `inside`          — the fix falls within the project hull.
 * `within_accuracy` — outside, but by less than the reported GPS error, so
 *                     the device cannot distinguish it from inside.
 * `near`            — outside by less than NEAR_THRESHOLD_M.
 * `far`             — outside by more.
 * `no_gps`          — the event carries no coordinates at all.
 * `no_aoi`          — coordinates exist but no project has a derivable AOI.
 */
export type CheckinVerdict =
  | 'inside' | 'within_accuracy' | 'near' | 'far' | 'no_gps' | 'no_aoi';

interface Row extends Record<string, unknown> {
  entry_id: string;
  work_date: string;
  time_sast: string;
  event: 'in' | 'out';
  full_name: string;
  employee_id: string | null;
  department: string | null;
  verdict: CheckinVerdict;
  nearest_project: string | null;
  distance_m: string | null;
  accuracy_m: string | null;
  lat: string | null;
  lon: string | null;
  selfie_available: boolean;
  device_fingerprint: string | null;
  aoi_computed_at_ms: string | null;
}

/**
 * Audited selfie path. Resolving it requires `people.staff.attendance.manage`
 * plus supervisor scope, and records who looked. Never emit the underlying
 * `/storage/...` URL — see the module comment.
 */
function selfieLink(entryId: string, event: 'in' | 'out'): string {
  return `/api/staff/attendance-selfie?entryId=${entryId}&kind=${event}&context=checkin-locations`;
}

export async function runCheckinLocations(input: ReportInput): Promise<ReportRunResult> {
  // Return the column schema, not an empty shape, when there is nothing to
  // query — the runner re-runs this report to keep the export header stable.
  if (input.scopedStaffIds?.length === 0) {
    return { rows: [], columns: COLUMNS, notes: [] };
  }
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
  }
  const pb = makeParamBuilder();
  const where = buildBaseWhere({
    pb,
    scopedStaffIds: input.scopedStaffIds,
    staffIdRef: 'e.staff_id',
    workDateRef: 'e.work_date',
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    departments: input.departments,
    deptRef: 's.department',
    employmentStaffAlias: 's',
    accountStatusRef: 's.account_status',
  });
  const siteFilter = input.siteIds.length > 0
    ? ` AND e.site_geofence_id = ANY(${pb.next(input.siteIds)}::uuid[])`
    : '';

  const text = `
    WITH ${PROJECT_AOI_CTE},
    base AS (
      SELECT
        e.id, e.work_date, e.device_fingerprint,
        e.clock_in_at,  e.clock_in_lat,  e.clock_in_lon,  e.clock_in_accuracy_m,  e.selfie_in_url,
        e.clock_out_at, e.clock_out_lat, e.clock_out_lon, e.clock_out_accuracy_m, e.selfie_out_url,
        s.employee_id, s.department,
        TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name
      FROM attendance_entries e
      JOIN staff s ON s.id = e.staff_id
      WHERE ${where}${siteFilter}
    ),
    events AS (
      SELECT
        b.id, b.work_date, b.full_name, b.employee_id, b.department, b.device_fingerprint,
        ev.event, ev.occurred_at, ev.lat, ev.lon, ev.accuracy_m,
        NULLIF(BTRIM(ev.selfie_url), '') IS NOT NULL AS selfie_available
      FROM base b
      CROSS JOIN LATERAL (VALUES
        ('in',  b.clock_in_at,  b.clock_in_lat,  b.clock_in_lon,  b.clock_in_accuracy_m,  b.selfie_in_url),
        ('out', b.clock_out_at, b.clock_out_lat, b.clock_out_lon, b.clock_out_accuracy_m, b.selfie_out_url)
      ) AS ev(event, occurred_at, lat, lon, accuracy_m, selfie_url)
      WHERE ev.occurred_at IS NOT NULL
    )
    SELECT
      ev.id::text                                   AS entry_id,
      ev.work_date::text                            AS work_date,
      to_char(ev.occurred_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') AS time_sast,
      ev.event                                      AS event,
      ev.full_name                                  AS full_name,
      ev.employee_id                                AS employee_id,
      ev.department                                 AS department,
      CASE
        WHEN ev.lat IS NULL OR ev.lon IS NULL          THEN 'no_gps'
        WHEN n.dist_m IS NULL                          THEN 'no_aoi'
        WHEN n.dist_m <= 0                             THEN 'inside'
        WHEN n.dist_m <= COALESCE(ev.accuracy_m, 0)    THEN 'within_accuracy'
        WHEN n.dist_m < ${NEAR_THRESHOLD_M}            THEN 'near'
        ELSE 'far'
      END                                           AS verdict,
      n.project_name                                AS nearest_project,
      n.dist_m::text                                AS distance_m,
      ev.accuracy_m::text                           AS accuracy_m,
      ev.lat::text                                  AS lat,
      ev.lon::text                                  AS lon,
      ev.selfie_available                           AS selfie_available,
      ev.device_fingerprint                         AS device_fingerprint,
      -- Carried on every row so a stalled AOI refresh is visible in the
      -- report rather than silently serving geometry from weeks ago. Scalar
      -- subquery over a 9-row table; no extra round trip.
      --
      -- Epoch millis, not ::text. A timestamptz rendered to text carries its
      -- offset under the default DateStyle and parses correctly — but a
      -- timestamp string WITHOUT an offset is read by new Date() as local
      -- time, which here would be 2 hours out and would silently suppress or
      -- fabricate the staleness warning. An integer cannot be misread.
      (SELECT (EXTRACT(EPOCH FROM MAX(a2.computed_at)) * 1000)::bigint
         FROM project_aois a2)::text AS aoi_computed_at_ms
    FROM events ev
    LEFT JOIN LATERAL (
      SELECT
        pr.project_name,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(ev.lon::float8, ev.lat::float8), 4326)::geography,
          a.aoi
        ) AS dist_m
      FROM project_aoi a
      JOIN projects pr ON pr.id = a.project_id
      -- Load-bearing, NOT redundant with the CASE above. The CASE only picks
      -- the verdict string; nearest_project and distance_m are read
      -- straight off n.*. Drop this clause and a no-GPS event yields
      -- ST_MakePoint(NULL,NULL) -> NULL distance for every project, so
      -- ORDER BY ... LIMIT 1 returns an arbitrary one and the row displays a
      -- project it was never near. Verified on the live DB: without it a
      -- NULL-coordinate event reports 'Lawley' with a NULL distance.
      WHERE ev.lat IS NOT NULL AND ev.lon IS NOT NULL
      ORDER BY 2 ASC
      LIMIT 1
    ) n ON TRUE
    ORDER BY ev.occurred_at DESC, ev.full_name ASC
    LIMIT ${pb.next(REPORT_ROW_CAP + 1)}
  `;

  const rows = await sql.query<Row>(text, pb.params);
  // Bail before allocating result objects so an unscoped year-wide run by an
  // admin cannot balloon memory on the way to the 413.
  if (rows.length > REPORT_ROW_CAP) {
    throw new ReportTooLargeError(rows.length);
  }

  const noGps = rows.filter((r) => r.verdict === 'no_gps').length;
  const noAoi = rows.filter((r) => r.verdict === 'no_aoi').length;
  const notes = [
    'Distances are to the convex hull of each project’s surveyed poles, so 0 m means inside the site boundary.',
  ];
  // A stalled refresh cron is invisible otherwise: the report keeps answering,
  // just against sites as they were whenever it last ran. Say so.
  // Every row carries the same scalar; row 0 is representative.
  const computedAtMs = rows[0]?.aoi_computed_at_ms ?? null;
  if (rows.length > 0 && !computedAtMs) {
    notes.push('No project AOIs are loaded — every event will read as unmatched. Run the AOI refresh.');
  } else if (computedAtMs) {
    const ageHours = (Date.now() - Number(computedAtMs)) / 3_600_000;
    if (ageHours > AOI_STALE_AFTER_HOURS) {
      notes.push(
        `Project AOIs were last rebuilt ${Math.floor(ageHours / 24)} day(s) ago — newer sites may be missing.`,
      );
    }
  }
  if (noGps > 0) notes.push(`${noGps} event(s) carry no GPS fix and cannot be located.`);
  if (noAoi > 0) notes.push(`${noAoi} event(s) had coordinates but no project has enough poles to form an AOI.`);

  return {
    rows: rows.map((r) => ({
      work_date: r.work_date,
      time_sast: r.time_sast,
      event: r.event === 'in' ? 'Clock in' : 'Clock out',
      staff: r.full_name,
      employee_id: r.employee_id ?? '',
      department: r.department ?? '',
      verdict: r.verdict,
      nearest_project: r.nearest_project ?? '',
      distance_m: r.distance_m !== null ? Math.round(Number(r.distance_m)) : null,
      accuracy_m: r.accuracy_m !== null ? Number(r.accuracy_m) : null,
      lat: r.lat !== null ? Number(r.lat) : null,
      lon: r.lon !== null ? Number(r.lon) : null,
      selfie: r.selfie_available ? selfieLink(r.entry_id, r.event) : '',
      device_fingerprint: r.device_fingerprint ?? '',
      entry_id: r.entry_id,
    })),
    columns: COLUMNS,
    notes,
  };
}
