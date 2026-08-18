import { transaction, type TxnClient } from '@/lib/db-pool';
import { acquireAttendanceStaffGateLock } from '@/modules/attendance/corrections/lockQueries';
import {
  findRequiredAttendanceActionTxn,
  type RequiredAttendanceAction,
} from '@/modules/attendance/workflow/requiredActionQueries';

import type { AttendanceEntryRow } from './clockUtils';

export interface ClockInFinalizationArgs {
  staffId: string;
  clockInAt: Date;
  clientOccurredAt: Date;
  workDate: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  selfieInUrl: string;
  vehicleAssignmentId: string | null;
  siteGeofenceId: string | null;
  deviceFingerprint: string | null;
  deviceUserAgent: string | null;
}

export type ClockInFinalizationResult =
  | { ok: true; entry: AttendanceEntryRow }
  | { ok: false; reason: 'open_entry'; entry: AttendanceEntryRow }
  | { ok: false; reason: 'prior_correction_required'; action: RequiredAttendanceAction };

export async function finalizeClockIn(
  args: ClockInFinalizationArgs,
): Promise<ClockInFinalizationResult> {
  return transaction((tx) => finalizeClockInTxn(tx, args));
}

export async function finalizeClockInTxn(
  tx: TxnClient,
  args: ClockInFinalizationArgs,
): Promise<ClockInFinalizationResult> {
  await acquireAttendanceStaffGateLock(tx, args.staffId);

  const openEntry = await tx.queryOne<AttendanceEntryRow>(`
    SELECT id, staff_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date,
           clock_in_at::text, clock_out_at::text, status
    FROM attendance_entries
    WHERE staff_id = $1::uuid AND status = 'open'
    LIMIT 1
    FOR UPDATE`, [args.staffId]);
  if (openEntry) return { ok: false, reason: 'open_entry', entry: openEntry };

  const action = await findRequiredAttendanceActionTxn(tx, args.staffId, args.workDate);
  if (action) return { ok: false, reason: 'prior_correction_required', action };

  // The nearest project AOI is resolved and stored HERE, at write time, rather
  // than recomputed when a report is opened: the pole register moves, and the
  // question this answers is "where was the worker relative to the sites as
  // they stood at clock-in".
  //
  // It reads `project_aois` (refreshed by cron) instead of building the hulls
  // inline. Measured on this database, the inline hull costs 105 ms against
  // 4.2 ms from the indexed table — and this statement runs inside a
  // transaction holding the staff gate lock while a phone waits.
  //
  // The LEFT JOIN LATERAL yields no row when the fix is absent or no AOI
  // exists, so both columns land NULL rather than attributing a project the
  // worker was never near. Recording only — nothing here blocks the clock-in.
  const entry = await tx.queryOne<AttendanceEntryRow>(`
    INSERT INTO attendance_entries (
      staff_id, work_date, clock_in_at, client_occurred_at_in, received_at_in,
      clock_in_lat, clock_in_lon, clock_in_accuracy_m, selfie_in_url,
      vehicle_assignment_id, site_geofence_id, device_fingerprint, device_user_agent, status,
      clock_in_aoi_project_id, clock_in_aoi_distance_m
    )
    SELECT
      $1::uuid, $2::date, $3::timestamptz, $4::timestamptz, NOW(),
      $5::numeric, $6::numeric, $7::numeric, $8,
      $9::uuid, $10::uuid, $11, $12, 'open',
      nearest.project_id, nearest.distance_m
    FROM (SELECT 1) AS _one
    LEFT JOIN LATERAL (
      SELECT
        a.project_id,
        ROUND(
          ST_Distance(
            ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography,
            a.aoi
          )::numeric, 2
        ) AS distance_m
      FROM project_aois a
      WHERE $5::numeric IS NOT NULL AND $6::numeric IS NOT NULL
      ORDER BY 2 ASC
      LIMIT 1
    ) AS nearest ON TRUE
    RETURNING id, staff_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date,
              clock_in_at::text, clock_out_at::text, clock_in_lat, clock_in_lon,
              clock_in_accuracy_m, clock_out_lat, clock_out_lon, clock_out_accuracy_m,
              selfie_in_url, selfie_out_url, vehicle_assignment_id,
              site_geofence_id, status, notes,
              clock_in_aoi_project_id, clock_in_aoi_distance_m`, [
    args.staffId, args.workDate, args.clockInAt.toISOString(),
    args.clientOccurredAt.toISOString(), args.lat, args.lon, args.accuracyM,
    args.selfieInUrl, args.vehicleAssignmentId, args.siteGeofenceId,
    args.deviceFingerprint, args.deviceUserAgent,
  ]);
  if (!entry) throw new Error('Clock-in finalization returned no entry');
  return { ok: true, entry };
}
