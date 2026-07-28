/**
 * H&S daily check-in — writes.
 *
 * Every write to hs_daily_checkins goes through here, so the table has one
 * writer even though the /my portal (pg.Pool) and the H&S module (neon shim)
 * use different query layers.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type {
  CheckinActivity,
  CheckinBlockReason,
  CheckinCaptureMode,
  CheckinClearance,
} from '../types/checkin.types';

const sql = neon(process.env.DATABASE_URL!);

export interface CreateCheckinInput {
  checkinDate: string;
  projectId: string;
  contractorId: string | null;
  staffId: string | null;
  teamMemberId: string | null;
  workerName: string;
  captureMode: CheckinCaptureMode;
  submissionId: string;
  submittedByStaffId: string | null;
  signatureName: string | null;
  fitForDuty: boolean;
  ppeComplete: boolean;
  declaredActivities: CheckinActivity[];
  hazardReported: string | null;
  clearance: Extract<CheckinClearance, 'cleared' | 'blocked'>;
  blockedReasons: CheckinBlockReason[];
  gpsLat: number | null;
  gpsLon: number | null;
  attendanceEntryId: string | null;
  riskRegisterId: string | null;
  createdBy: string | null;
}

export async function createCheckin(input: CreateCheckinInput) {
  const rows = await sql`
    INSERT INTO hs_daily_checkins (
      checkin_date, project_id, contractor_id,
      staff_id, team_member_id, worker_name,
      capture_mode, submission_id, submitted_by_staff_id,
      signature_name, signed_at,
      fit_for_duty, ppe_complete, declared_activities, hazard_reported,
      clearance, blocked_reasons,
      gps_lat, gps_lon, attendance_entry_id, risk_register_id, created_by
    ) VALUES (
      ${input.checkinDate}::date,
      ${input.projectId}::uuid,
      ${input.contractorId}::uuid,
      ${input.staffId}::uuid,
      ${input.teamMemberId}::uuid,
      ${input.workerName.trim()},
      ${input.captureMode},
      ${input.submissionId}::uuid,
      ${input.submittedByStaffId}::uuid,
      ${input.signatureName},
      ${input.signatureName ? new Date().toISOString() : null}::timestamptz,
      ${input.fitForDuty},
      ${input.ppeComplete},
      ${input.declaredActivities}::text[],
      ${input.hazardReported},
      ${input.clearance},
      ${input.blockedReasons}::text[],
      ${input.gpsLat},
      ${input.gpsLon},
      ${input.attendanceEntryId}::uuid,
      ${input.riskRegisterId}::uuid,
      ${input.createdBy}::uuid
    )
    RETURNING *, checkin_date::text AS checkin_date
  `;
  return rows[0]!;
}

/**
 * Raise a reported hazard into the risk register so it becomes a tracked
 * finding rather than free text nobody reads.
 *
 * Best-effort: the check-in is the record that must survive, so a rejected
 * risk row is logged and the check-in still saves with risk_register_id NULL.
 * Likelihood/severity default to 3/3 — the reporter is declaring that a hazard
 * exists, not scoring it; an H&S officer re-scores on review.
 */
export async function raiseHazardToRiskRegister(input: {
  projectId: string;
  hazard: string;
  reportedBy: string;
  createdBy: string | null;
}): Promise<string | null> {
  try {
    const [row] = await sql`
      INSERT INTO hs_risk_register (
        project_id, hazard_description, risk_category,
        likelihood, severity, activity_description, status, created_by
      ) VALUES (
        ${input.projectId}::uuid,
        ${input.hazard.trim()},
        'physical',
        3, 3,
        ${`Reported at daily H&S check-in by ${input.reportedBy}`},
        'active',
        ${input.createdBy}::uuid
      )
      RETURNING id
    `;
    return row ? String(row.id) : null;
  } catch (error) {
    log.error('[H&S] raising check-in hazard to the risk register failed', {
      error,
      projectId: input.projectId,
    });
    return null;
  }
}

/**
 * H&S officer clears a blocked worker.
 *
 * Guarded on the row still being `blocked`, so two officers clearing the same
 * person concurrently cannot both succeed and the second gets a clean 409
 * rather than silently overwriting the first one's note.
 */
export async function clearBlockedCheckin(
  checkinId: string,
  input: { clearedBy: string; note: string | null }
) {
  const rows = await sql`
    UPDATE hs_daily_checkins
    SET clearance = 'cleared_by_override',
        cleared_by = ${input.clearedBy}::uuid,
        cleared_at = NOW(),
        clearance_note = ${input.note},
        updated_at = NOW()
    WHERE id = ${checkinId}::uuid
      AND clearance = 'blocked'
    RETURNING *, checkin_date::text AS checkin_date
  `;
  return rows[0] ?? null;
}
