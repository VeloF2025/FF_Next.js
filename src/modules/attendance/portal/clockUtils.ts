/**
 * Database operations for clock-in / clock-out and attendance history.
 *
 * Design notes:
 *   - `work_date` is always computed server-side in Africa/Johannesburg,
 *     never trusted from the client. This matters for offline clock-outs
 *     that arrive after midnight — they're payroll-assigned to the day
 *     the clock-in opened.
 *   - The `(staff_id) WHERE status='open'` partial unique index on
 *     attendance_entries is what actually enforces "one open entry per
 *     staff." This module relies on that constraint rather than
 *     application-level locking.
 *   - Every DB write returns the written row so the caller can log /
 *     emit events without a follow-up SELECT.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export interface AttendanceEntryRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: string | null;
  clock_in_lon: string | null;
  clock_in_accuracy_m: string | null;
  clock_out_lat: string | null;
  clock_out_lon: string | null;
  clock_out_accuracy_m: string | null;
  selfie_in_url: string | null;
  selfie_out_url: string | null;
  vehicle_assignment_id: string | null;
  site_geofence_id: string | null;
  status: 'open' | 'closed' | 'auto_closed' | 'manual' | 'disputed';
  notes: string | null;
}

export interface ActiveVehicleAssignment {
  id: string;
  vehicle_registration: string | null;
}

/**
 * Look up the currently-open entry for a staff member, if any.
 * Used by clock-in to detect "forgot to clock out yesterday" and by the
 * `/api/my/attendance/current` endpoint to render the portal's home state.
 */
export async function findOpenEntry(staffId: string): Promise<AttendanceEntryRow | null> {
  const rows = await sql<AttendanceEntryRow>`
    SELECT id, staff_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, clock_in_at, clock_out_at,
           clock_in_lat, clock_in_lon, clock_in_accuracy_m,
           clock_out_lat, clock_out_lon, clock_out_accuracy_m,
           selfie_in_url, selfie_out_url,
           vehicle_assignment_id, site_geofence_id, status, notes
    FROM attendance_entries
    WHERE staff_id = ${staffId} AND status = 'open'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findActiveVehicleAssignment(
  staffId: string
): Promise<ActiveVehicleAssignment | null> {
  const rows = await sql<ActiveVehicleAssignment & Record<string, unknown>>`
    SELECT id, vehicle_registration
    FROM vehicle_assignments
    WHERE staff_id = ${staffId} AND is_active = true
    ORDER BY assignment_start DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Insert a new open attendance entry. The caller has already:
 *   - verified the session,
 *   - normalised the client_occurred_at against server time,
 *   - resolved site geofence + vehicle assignment,
 *   - uploaded the selfie.
 */
export async function insertClockIn(args: {
  staffId: string;
  clockInAt: Date;
  clientOccurredAt: Date;
  workDate: string;              // 'YYYY-MM-DD' in SAST
  lat: number;
  lon: number;
  accuracyM: number | null;
  selfieInUrl: string | null;
  vehicleAssignmentId: string | null;
  siteGeofenceId: string | null;
  deviceFingerprint: string | null;
  deviceUserAgent: string | null;
}): Promise<AttendanceEntryRow> {
  const rows = await sql<AttendanceEntryRow>`
    INSERT INTO attendance_entries (
      staff_id, work_date,
      clock_in_at, client_occurred_at_in, received_at_in,
      clock_in_lat, clock_in_lon, clock_in_accuracy_m,
      selfie_in_url,
      vehicle_assignment_id, site_geofence_id,
      device_fingerprint, device_user_agent,
      status
    ) VALUES (
      ${args.staffId}, ${args.workDate},
      ${args.clockInAt.toISOString()}, ${args.clientOccurredAt.toISOString()}, NOW(),
      ${args.lat}, ${args.lon}, ${args.accuracyM},
      ${args.selfieInUrl},
      ${args.vehicleAssignmentId}, ${args.siteGeofenceId},
      ${args.deviceFingerprint}, ${args.deviceUserAgent},
      'open'
    )
    RETURNING id, staff_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, clock_in_at, clock_out_at,
              clock_in_lat, clock_in_lon, clock_in_accuracy_m,
              clock_out_lat, clock_out_lon, clock_out_accuracy_m,
              selfie_in_url, selfie_out_url,
              vehicle_assignment_id, site_geofence_id, status, notes
  `;
  const row = rows[0];
  if (!row) throw new Error('INSERT returned no row');
  return row;
}

/**
 * Capture staff.hourly_rate at clock-in time into staff_rate_at_clock_in
 * (migration 325). Best-effort — a failure here does NOT roll back the
 * clock-in because the reconcile cron can still fall back to reading
 * the current staff.hourly_rate at compute time (the original PR #1406
 * behaviour). Log on failure so ops see the drift.
 *
 * NULL-rate staff (salaried / unrated) skip the INSERT entirely — the
 * snapshot table enforces NOT NULL so we can't write a sentinel row.
 * Reconcile handles the missing-snapshot case natively by falling back.
 *
 * This is a single INSERT … SELECT so the rate-read and snapshot-write
 * happen in one round-trip; no TOCTOU between reading staff.hourly_rate
 * and inserting it.
 */
export async function captureRateAtClockIn(
  entryId: string,
  staffId: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO staff_rate_at_clock_in (entry_id, hourly_rate_cents)
      SELECT ${entryId}::uuid, ROUND(hourly_rate * 100)::bigint
      FROM staff
      WHERE id = ${staffId}::uuid
        AND hourly_rate IS NOT NULL
      ON CONFLICT (entry_id) DO NOTHING
    `;
  } catch (err) {
    log.error(
      '[attendance-clock-in] rate snapshot write failed — reconcile will fall back to live staff.hourly_rate',
      {
        entryId,
        staffId,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

/**
 * Close the given open entry with clock-out data.
 * Returns null when the entry isn't actually open (already closed, wrong
 * staff, doesn't exist) so the caller can return a clean 409 rather
 * than reporting a successful close.
 */
export async function closeOpenEntry(args: {
  entryId: string;
  staffId: string;
  clockOutAt: Date;
  clientOccurredAt: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  selfieOutUrl: string | null;
}): Promise<AttendanceEntryRow | null> {
  const rows = await sql<AttendanceEntryRow>`
    UPDATE attendance_entries
    SET
      clock_out_at           = ${args.clockOutAt.toISOString()},
      client_occurred_at_out = ${args.clientOccurredAt.toISOString()},
      received_at_out        = NOW(),
      clock_out_lat          = ${args.lat},
      clock_out_lon          = ${args.lon},
      clock_out_accuracy_m   = ${args.accuracyM},
      selfie_out_url         = ${args.selfieOutUrl},
      status                 = 'closed',
      updated_at             = NOW()
    WHERE id = ${args.entryId}
      AND staff_id = ${args.staffId}
      AND status = 'open'
    RETURNING id, staff_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, clock_in_at, clock_out_at,
              clock_in_lat, clock_in_lon, clock_in_accuracy_m,
              clock_out_lat, clock_out_lon, clock_out_accuracy_m,
              selfie_in_url, selfie_out_url,
              vehicle_assignment_id, site_geofence_id, status, notes
  `;
  return rows[0] ?? null;
}

/**
 * Insert a typed exception against an entry. Used for geofence mismatches,
 * clock skew, missing clock-out, etc.
 *
 * NEVER throws — exception logging must not unwind an already-committed
 * primary clock action. But the error IS logged with full context so a
 * Sentry alert on this log call surfaces schema/driver/constraint breakage
 * immediately. A silent swallow here would hide the state "we stopped
 * logging exceptions in April and nobody noticed until a compliance audit."
 */
export async function insertException(args: {
  entryId: string;
  kind:
    | 'missing_clock_out'
    | 'geofence_mismatch'
    | 'clock_skew'
    | 'out_of_hours'
    | 'manual_override'
    | 'duplicate_entry'
    | 'vehicle_gps_mismatch'
    | 'forgotten_clock_out_retro';
  severity?: 'info' | 'warning' | 'critical';
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (${args.entryId}, ${args.kind}, ${args.severity ?? 'warning'}, ${
      args.details ? JSON.stringify(args.details) : null
    }::jsonb)
    `;
  } catch (err) {
    log.error(
      '[attendance-exception] failed to record exception — primary clock action already committed, this audit row is lost',
      {
        entryId: args.entryId,
        kind: args.kind,
        severity: args.severity ?? 'warning',
        details: args.details,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

const HISTORY_HARD_CAP = 60;

export async function listRecentEntries(args: {
  staffId: string;
  limit: number;
}): Promise<AttendanceEntryRow[]> {
  // Defense in depth: clamp at the helper layer too, not just in the
  // handler. Any future caller that forgets the handler's clamp still
  // can't accidentally issue an unbounded scan.
  const safeLimit = Math.min(Math.max(Math.trunc(args.limit), 1), HISTORY_HARD_CAP);
  return sql<AttendanceEntryRow>`
    SELECT id, staff_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, clock_in_at, clock_out_at,
           clock_in_lat, clock_in_lon, clock_in_accuracy_m,
           clock_out_lat, clock_out_lon, clock_out_accuracy_m,
           selfie_in_url, selfie_out_url,
           vehicle_assignment_id, site_geofence_id, status, notes
    FROM attendance_entries
    WHERE staff_id = ${args.staffId}
    ORDER BY clock_in_at DESC
    LIMIT ${safeLimit}
  `;
}

/**
 * Server-authoritative `work_date` for a given moment in SAST.
 * Uses Intl.DateTimeFormat so DST quirks (there are none in SAST, but the
 * approach is portable) are handled correctly without hand-rolling
 * timezone math.
 *
 * Throws on an invalid Date rather than silently formatting as
 * 'Invalid Date' — that string would then fail the DATE-typed INSERT
 * with a Postgres-level error that's harder to diagnose than a clear
 * throw at the boundary.
 */
export function sastWorkDate(moment: Date): string {
  if (!(moment instanceof Date) || Number.isNaN(moment.getTime())) {
    throw new Error(`sastWorkDate received invalid Date: ${String(moment)}`);
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(moment); // en-CA gives 'YYYY-MM-DD'
}

export type SelfieConsentState = 'granted' | 'revoked' | 'missing';

/**
 * Check the POPIA biometric-consent state on the staff's credentials row.
 *   - 'granted' — `selfie_consent_at` is set
 *   - 'revoked' — credentials row exists but `selfie_consent_at` is null
 *   - 'missing' — no credentials row for this staff (never onboarded to /my)
 *
 * Callers differentiate the messages shown to the user, and 'missing'
 * specifically is surfaced as a log.error so onboarding-flow regressions
 * are visible immediately instead of looking like "user revoked consent".
 */
export async function getSelfieConsentState(staffId: string): Promise<SelfieConsentState> {
  const rows = await sql<{ selfie_consent_at: string | null }>`
    SELECT selfie_consent_at
    FROM attendance_credentials
    WHERE staff_id = ${staffId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    log.error('[attendance-consent] staff hitting /my without attendance_credentials row', { staffId });
    return 'missing';
  }
  return rows[0]?.selfie_consent_at != null ? 'granted' : 'revoked';
}

/**
 * Backwards-compatible boolean view of consent state. Prefer
 * `getSelfieConsentState` when you need to tell the three states apart.
 */
export async function hasSelfieConsent(staffId: string): Promise<boolean> {
  return (await getSelfieConsentState(staffId)) === 'granted';
}
