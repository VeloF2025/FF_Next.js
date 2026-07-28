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
      // Explicit arbiter rather than a bare ON CONFLICT DO NOTHING: the bare
      // form absorbs a violation of ANY unique constraint on the table,
      // including hs_daily_checkins_crew_name_unique (a name repeated inside
      // one submission), which is a caller bug that should surface loudly
      // rather than become a quiet undercount.
      const conflictTarget = m.teamMemberId
        ? `ON CONFLICT (team_member_id, checkin_date)
             WHERE capture_mode = 'crew_lead' AND team_member_id IS NOT NULL
           DO NOTHING`
        : `ON CONFLICT (contractor_id, checkin_date, lower(btrim(worker_name)))
             WHERE capture_mode = 'crew_lead' AND team_member_id IS NULL
           DO NOTHING`;
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
         ${conflictTarget}
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
 * Classify supplied team_member_ids against the claimed contractor.
 *
 * A strict `contractor_id = $1` check is wrong TODAY: `team_members.contractor_id`
 * is NULL for all 65 live rows (and `teams.contractor_id` for all 22), so a
 * strict check rejects every real worker. That does not merely break the crew
 * path — it pushes leads to submit everyone name-only, and a worker with no id
 * cannot have their medical looked up, which silently downgrades the medical
 * gate from enforcing to advisory for the entire subcontractor population. The
 * workaround would defeat the control this feature exists to provide.
 *
 * So the binding is conditional:
 *   - the row names a DIFFERENT contractor  -> foreign, refused
 *   - the row names THIS contractor         -> owned, verified
 *   - the row names no contractor (NULL)    -> unlinked: accepted, because the
 *     linkage is absent from the data rather than contradicted by it, but
 *     recorded as unverified so it is visible instead of silently assumed
 *
 * This tightens automatically the moment `team_members.contractor_id` is
 * populated, with no code change.
 */
export async function classifyTeamMembers(
  contractorId: string,
  teamMemberIds: string[]
): Promise<{ owned: Set<string>; unlinked: Set<string>; foreign: Set<string> }> {
  const owned = new Set<string>();
  const unlinked = new Set<string>();
  const foreign = new Set<string>();
  if (teamMemberIds.length === 0) return { owned, unlinked, foreign };

  return transaction(async (txn) => {
    const rows = await txn.query<{ id: string; contractor_id: string | null }>(
      `SELECT id, contractor_id FROM team_members WHERE id = ANY($1::uuid[])`,
      [teamMemberIds]
    );
    const seen = new Set(rows.map((r) => String(r.id)));
    for (const r of rows) {
      const id = String(r.id);
      if (r.contractor_id == null) unlinked.add(id);
      else if (String(r.contractor_id) === contractorId) owned.add(id);
      else foreign.add(id);
    }
    // An id that matches no team_members row at all is foreign by definition.
    for (const id of teamMemberIds) if (!seen.has(id)) foreign.add(id);
    return { owned, unlinked, foreign };
  });
}

/**
 * Name-only crew members already recorded today for this contractor.
 *
 * Registered members are deduplicated by id; these are deduplicated on the
 * normalised name, matching hs_daily_checkins_one_crew_name_per_day. Without
 * this pre-check the unique index still holds, but ON CONFLICT DO NOTHING drops
 * the row silently — which is exactly the "quiet wrong answer" migration 466
 * says it is avoiding.
 */
export async function findCrewNamesAlreadyCheckedIn(
  contractorId: string,
  checkinDate: string,
  names: string[]
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  return transaction(async (txn) => {
    const rows = await txn.query<{ name: string }>(
      `SELECT lower(btrim(worker_name)) AS name
       FROM hs_daily_checkins
       WHERE contractor_id = $1::uuid
         AND checkin_date = $2::date
         AND capture_mode = 'crew_lead'
         AND team_member_id IS NULL
         AND lower(btrim(worker_name)) = ANY($3::text[])`,
      [contractorId, checkinDate, names.map((n) => n.trim().toLowerCase())]
    );
    return new Set(rows.map((r) => String(r.name)));
  });
}
