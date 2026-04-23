/**
 * SQL helpers for the Cartrack reconcile orchestrator. Extracted from
 * cartrackReconcile.ts to keep each file under the 300-LOC cap and to
 * make the read + write surface independently auditable.
 */

import { sql, transaction } from '@/lib/db-pool';

export interface CartrackCandidateEntry extends Record<string, unknown> {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: string | null;
  clock_in_lon: string | null;
  clock_out_lat: string | null;
  clock_out_lon: string | null;
  cartrack_vehicle_id: string | null;
  has_in_verification: boolean;
  has_out_verification: boolean;
}

export async function loadCandidateEntries(
  fromDate: string,
  toDate: string
): Promise<CartrackCandidateEntry[]> {
  return sql<CartrackCandidateEntry>`
    SELECT
      e.id,
      e.staff_id,
      e.work_date::text AS work_date,
      e.clock_in_at::text,
      e.clock_out_at::text,
      e.clock_in_lat::text,
      e.clock_in_lon::text,
      e.clock_out_lat::text,
      e.clock_out_lon::text,
      fv.cartrack_vehicle_id,
      EXISTS (
        SELECT 1 FROM attendance_gps_verifications v
        WHERE v.entry_id = e.id AND v.check_type = 'in'
      ) AS has_in_verification,
      EXISTS (
        SELECT 1 FROM attendance_gps_verifications v
        WHERE v.entry_id = e.id AND v.check_type = 'out'
      ) AS has_out_verification
    FROM attendance_entries e
    JOIN vehicle_assignments va ON va.id = e.vehicle_assignment_id
    JOIN fleet_vehicles fv ON fv.id = va.vehicle_id
    WHERE e.status IN ('closed', 'auto_closed', 'manual')
      AND e.vehicle_assignment_id IS NOT NULL
      AND e.work_date >= ${fromDate}::date
      AND e.work_date <= ${toDate}::date
    ORDER BY e.clock_in_at ASC
  `;
}

export type Verdict = 'match' | 'mismatch' | 'no_data' | 'vehicle_not_mapped';

/**
 * Idempotent upsert via ON CONFLICT DO NOTHING on (entry_id, check_type).
 * Returns true iff a new row was inserted — false means another run
 * already verified this (entry, side), and the caller must NOT re-raise
 * the mismatch exception.
 */
export async function upsertVerification(args: {
  entryId: string;
  checkType: 'in' | 'out';
  verdict: Verdict;
  vehicleCartrackId: string | null;
  vehicleLat: number | null;
  vehicleLon: number | null;
  vehicleTs: Date | null;
  deviceLat: number | null;
  deviceLon: number | null;
  distanceM: number | null;
  thresholdM: number;
}): Promise<boolean> {
  const result = await sql<{ id: string }>`
    INSERT INTO attendance_gps_verifications (
      entry_id, check_type, verdict,
      vehicle_cartrack_id, vehicle_lat, vehicle_lon, vehicle_ts,
      device_lat, device_lon, distance_m, threshold_m,
      reconciled_at
    ) VALUES (
      ${args.entryId}, ${args.checkType}, ${args.verdict},
      ${args.vehicleCartrackId},
      ${args.vehicleLat}, ${args.vehicleLon},
      ${args.vehicleTs ? args.vehicleTs.toISOString() : null},
      ${args.deviceLat}, ${args.deviceLon},
      ${args.distanceM}, ${args.thresholdM},
      NOW()
    )
    ON CONFLICT (entry_id, check_type) DO NOTHING
    RETURNING id
  `;
  return result.length > 0;
}

/**
 * Atomic variant used by the mismatch path in the reconcile orchestrator.
 * Writes the verification and the `vehicle_gps_mismatch` exception in a
 * single transaction so an interruption between them can't leave a
 * mismatch verdict without its supervisor-visible exception row.
 *
 * The exception kind is 'vehicle_gps_mismatch', severity 'info' per PRD
 * framing: corroboration, not fraud detection.
 *
 * Idempotence: migration 321 adds a partial UNIQUE index on
 * attendance_exceptions(entry_id) WHERE exception_kind='vehicle_gps_mismatch'
 * AND resolved_at IS NULL, so a duplicate raise from any caller is a
 * constraint violation rather than silent data duplication. We ON CONFLICT
 * DO NOTHING in the INSERT to make the whole block safe to retry.
 */
export async function upsertMismatchAtomic(args: {
  entryId: string;
  checkType: 'in' | 'out';
  vehicleCartrackId: string | null;
  vehicleLat: number;
  vehicleLon: number;
  vehicleTs: Date;
  deviceLat: number;
  deviceLon: number;
  distanceM: number;
  thresholdM: number;
}): Promise<{ verificationInserted: boolean; exceptionInserted: boolean }> {
  return transaction(async (txn) => {
    const verification = await txn.query<{ id: string }>(
      `INSERT INTO attendance_gps_verifications (
         entry_id, check_type, verdict,
         vehicle_cartrack_id, vehicle_lat, vehicle_lon, vehicle_ts,
         device_lat, device_lon, distance_m, threshold_m,
         reconciled_at
       ) VALUES (
         $1, $2, 'mismatch',
         $3, $4, $5, $6::timestamptz,
         $7, $8, $9, $10,
         NOW()
       )
       ON CONFLICT (entry_id, check_type) DO NOTHING
       RETURNING id`,
      [
        args.entryId,
        args.checkType,
        args.vehicleCartrackId,
        args.vehicleLat,
        args.vehicleLon,
        args.vehicleTs.toISOString(),
        args.deviceLat,
        args.deviceLon,
        args.distanceM,
        args.thresholdM,
      ]
    );
    if (verification.length === 0) {
      // Already persisted by an earlier run — don't re-raise.
      return { verificationInserted: false, exceptionInserted: false };
    }
    // ON CONFLICT (entry_id) WHERE ... references the partial UNIQUE index
    // added by migration 321. Matches the index predicate byte-for-byte so
    // Postgres can locate the arbiter.
    const exception = await txn.query<{ id: string }>(
      `INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
       VALUES (
         $1,
         'vehicle_gps_mismatch',
         'info',
         jsonb_build_object(
           'distance_m', $2::numeric,
           'threshold_m', $3::numeric,
           'check_type', $4,
           'note', 'Cartrack vehicle position differs from device GPS. Corroboration only — not fraud.'
         )
       )
       ON CONFLICT (entry_id)
         WHERE exception_kind = 'vehicle_gps_mismatch' AND resolved_at IS NULL
         DO NOTHING
       RETURNING id`,
      [args.entryId, args.distanceM, args.thresholdM, args.checkType]
    );
    return {
      verificationInserted: true,
      exceptionInserted: exception.length > 0,
    };
  });
}
