/**
 * Crew check-in batch write — one transaction, all-or-nothing.
 *
 * Uses pg.Pool (`@/lib/db-pool`) rather than the Neon shim because this needs a
 * real multi-statement transaction, which the shim's HTTP driver cannot give.
 * That also matches CLAUDE.md's guidance that new code should use pg.Pool.
 *
 * Why it must be atomic: the loop writes one row per crew member. A failure at
 * member 45 of 60 previously left 44 rows committed, and because crew rows are
 * not deduplicated per day, a retry produced duplicates for everyone who had
 * already succeeded — inflating the contractor gate's counts, and leaving a
 * stale `blocked` row that only an H&S officer could clear.
 */

import { transaction } from '@/lib/db-pool';
import type {
  CheckinActivity,
  CheckinBlockReason,
} from '../types/checkin.types';

export interface CrewMemberRow {
  workerName: string;
  teamMemberId: string | null;
  fitForDuty: boolean;
  clearance: 'cleared' | 'blocked';
  blockedReasons: CheckinBlockReason[];
}

export interface CrewBatchInput {
  checkinDate: string;
  projectId: string;
  contractorId: string;
  submissionId: string;
  submittedByStaffId: string;
  signatureName: string;
  ppeComplete: boolean;
  declaredActivities: CheckinActivity[];
  hazardReported: string | null;
  activitiesWithoutPermit: CheckinActivity[];
  gpsLat: number | null;
  gpsLon: number | null;
  riskRegisterId: string | null;
  members: CrewMemberRow[];
}

/**
 * Insert a whole crew submission atomically.
 *
 * `ON CONFLICT DO NOTHING` on the per-day crew index makes a double-tap or a
 * client retry idempotent rather than duplicating the crew: the second attempt
 * inserts nothing and reports how many rows it actually wrote.
 */
export async function createCrewCheckins(input: CrewBatchInput) {
  return transaction(async (txn) => {
    const inserted = [];
    for (const m of input.members) {
      const rows = await txn.query(
        `INSERT INTO hs_daily_checkins (
           checkin_date, project_id, contractor_id,
           team_member_id, worker_name,
           capture_mode, submission_id, submitted_by_staff_id,
           signature_name, signed_at,
           fit_for_duty, ppe_complete, declared_activities, hazard_reported,
           clearance, blocked_reasons, activities_without_permit,
           gps_lat, gps_lon, risk_register_id
         ) VALUES (
           $1::date, $2::uuid, $3::uuid,
           $4::uuid, $5,
           'crew_lead', $6::uuid, $7::uuid,
           $8, NOW(),
           $9, $10, $11::text[], $12,
           $13, $14::text[], $15::text[],
           $16, $17, $18::uuid
         )
         ON CONFLICT DO NOTHING
         RETURNING *, checkin_date::text AS checkin_date`,
        [
          input.checkinDate,
          input.projectId,
          input.contractorId,
          m.teamMemberId,
          m.workerName.trim(),
          input.submissionId,
          input.submittedByStaffId,
          input.signatureName,
          m.fitForDuty,
          input.ppeComplete,
          input.declaredActivities,
          input.hazardReported,
          m.clearance,
          m.blockedReasons,
          input.activitiesWithoutPermit,
          input.gpsLat,
          input.gpsLon,
          input.riskRegisterId,
        ]
      );
      if (rows[0]) inserted.push(rows[0]);
    }
    return inserted;
  });
}

/**
 * Crew members already recorded today for this contractor, by team_member_id.
 *
 * Registered workers CAN be deduplicated across submissions; only name-only
 * workers cannot, because they have no stable identity. Returning them lets the
 * endpoint refuse a duplicate submission with a clear message instead of
 * silently inflating the contractor's compliance counts.
 */
export async function findCrewAlreadyCheckedIn(
  contractorId: string,
  checkinDate: string,
  teamMemberIds: string[]
): Promise<Set<string>> {
  if (teamMemberIds.length === 0) return new Set();
  return transaction(async (txn) => {
    const rows = await txn.query<{ team_member_id: string }>(
      `SELECT DISTINCT team_member_id
       FROM hs_daily_checkins
       WHERE contractor_id = $1::uuid
         AND checkin_date = $2::date
         AND team_member_id = ANY($3::uuid[])`,
      [contractorId, checkinDate, teamMemberIds]
    );
    return new Set(rows.map((r) => String(r.team_member_id)));
  });
}

/**
 * Which of the supplied team_member_ids actually belong to this contractor.
 *
 * Without this, any supervisor could attest fit-for-duty for another
 * contractor's registered worker simply by knowing their uuid, and that
 * attestation would feed the wrong contractor's compliance gate.
 */
export async function filterTeamMembersOfContractor(
  contractorId: string,
  teamMemberIds: string[]
): Promise<Set<string>> {
  if (teamMemberIds.length === 0) return new Set();
  return transaction(async (txn) => {
    const rows = await txn.query<{ id: string }>(
      `SELECT id FROM team_members
       WHERE id = ANY($1::uuid[]) AND contractor_id = $2::uuid`,
      [teamMemberIds, contractorId]
    );
    return new Set(rows.map((r) => String(r.id)));
  });
}
