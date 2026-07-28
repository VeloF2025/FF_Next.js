/**
 * H&S daily check-in — database access.
 *
 * The clearance rule itself lives in checkinClearance.ts as a pure function;
 * this module only supplies it with facts and persists the outcome.
 */

import { neon } from '@neondatabase/serverless';
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import type { CheckinMedicalStatus } from './checkinClearance';
import {
  MEDICAL_REQUIRED_ACTIVITIES,
  type CheckinActivity,
  type ContractorCheckinSummary,
} from '../types/checkin.types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Today's date on the SAST calendar.
 *
 * Deliberately delegates to the attendance module's sastWorkDate rather than
 * re-deriving it: a check-in and the clock-in it accompanies must agree on
 * which day they belong to, and a second copy of this logic is exactly how the
 * two would drift. A plain UTC `CURRENT_DATE` would bucket early-morning
 * activity to the wrong day.
 */
export function sastToday(): string {
  return sastWorkDate(new Date());
}

/**
 * The worker's medical position, read from their LATEST Certificate of Fitness.
 *
 * Scoped the same way the gate rollup is (latest per worker), and returns
 * `unverifiable` when there is no structured identity to look one up by — an
 * unregistered crew member recorded by name only.
 */
export async function lookupMedicalStatus(
  worker: { staffId?: string | null; teamMemberId?: string | null },
  /**
   * The SAST calendar day to judge validity against. NOT Postgres CURRENT_DATE:
   * the dev/prod session timezone is UTC, so between 00:00 and 02:00 SAST the
   * two disagree by a day and a certificate that expired yesterday would still
   * read as valid — for exactly the height/plant work this gate exists to stop.
   */
  asOfDate: string = sastToday()
): Promise<CheckinMedicalStatus> {
  const staffId = worker.staffId ?? null;
  const teamMemberId = worker.teamMemberId ?? null;
  if (!staffId && !teamMemberId) return 'unverifiable';

  const [row] = await sql`
    SELECT
      m.expiry_date,
      m.outcome,
      (m.expiry_date IS NULL OR m.expiry_date >= ${asOfDate}::date) AS still_valid
    FROM hs_worker_medicals m
    WHERE (${staffId}::uuid IS NOT NULL AND m.staff_id = ${staffId}::uuid)
       OR (${teamMemberId}::uuid IS NOT NULL AND m.team_member_id = ${teamMemberId}::uuid)
    ORDER BY m.exam_date DESC, m.created_at DESC
    LIMIT 1
  `;

  if (!row) return 'missing';
  // An 'unfit' verdict is handled by the worker's own declaration and by the
  // contractor gate; here we only answer "is there a current certificate".
  return row.still_valid ? 'current' : 'expired';
}

/**
 * Permit-backed activities the worker declared that have no open permit on this
 * project today. Non-blocking, but a real finding: doing permit work without a
 * permit is exactly what the permit system exists to prevent.
 */
export async function findActivitiesWithoutPermit(
  projectId: string,
  activities: CheckinActivity[],
  /** SAST calendar day — see lookupMedicalStatus for why not CURRENT_DATE. */
  asOfDate: string = sastToday()
): Promise<CheckinActivity[]> {
  if (activities.length === 0) return [];

  const rows = await sql`
    SELECT DISTINCT pt.code
    FROM hs_permits p
    JOIN hs_permit_types pt ON pt.id = p.permit_type_id
    WHERE p.project_id = ${projectId}
      AND p.status IN ('approved', 'active')
      AND (p.valid_from IS NULL OR p.valid_from <= ${asOfDate}::date)
      AND (p.valid_to IS NULL OR p.valid_to >= ${asOfDate}::date)
  `;
  const open = new Set(rows.map((r) => String(r.code)));
  return activities.filter((a) => !open.has(a));
}

/**
 * Roll a contractor's check-ins up for one day, for the compliance gate.
 *
 * Scoped to that contractor's rows: contractor_id on a check-in is the
 * assertion "this is evidence for that contractor", so another contractor's
 * submission must neither credit nor block this one.
 */
export async function computeContractorCheckinSummary(
  contractorId: string,
  checkinDate: string
): Promise<ContractorCheckinSummary> {
  const [row] = await sql`
    SELECT
      COUNT(*)::int AS workers_checked_in,
      COUNT(*) FILTER (WHERE clearance = 'cleared')::int AS cleared,
      COUNT(*) FILTER (WHERE clearance = 'blocked')::int AS blocked,
      COUNT(*) FILTER (WHERE clearance = 'cleared_by_override')::int AS overridden,
      -- DISTINCT submissions, not rows: one crew hazard is stamped on every
      -- member of that crew, so counting rows would triple-report it.
      COUNT(DISTINCT submission_id) FILTER (
        WHERE hazard_reported IS NOT NULL AND btrim(hazard_reported) <> ''
      )::int AS hazards_reported,
      -- Bound from MEDICAL_REQUIRED_ACTIVITIES rather than hardcoded here: a
      -- literal copy would drift silently from the list that drives the actual
      -- clearance decision, leaving the gate's warning count quietly stale.
      COUNT(*) FILTER (
        WHERE staff_id IS NULL AND team_member_id IS NULL
          AND declared_activities && ${MEDICAL_REQUIRED_ACTIVITIES}::text[]
      )::int AS medical_unverifiable
    FROM hs_daily_checkins
    WHERE contractor_id = ${contractorId}
      AND checkin_date = ${checkinDate}::date
  `;

  return {
    contractor_id: contractorId,
    checkin_date: checkinDate,
    workers_checked_in: Number(row?.workers_checked_in ?? 0),
    cleared: Number(row?.cleared ?? 0),
    blocked: Number(row?.blocked ?? 0),
    overridden: Number(row?.overridden ?? 0),
    hazards_reported: Number(row?.hazards_reported ?? 0),
    medical_unverifiable: Number(row?.medical_unverifiable ?? 0),
  };
}

/** Today's self check-in for a /my user, or null if they have not done one. */
export async function findSelfCheckin(staffId: string, checkinDate: string) {
  const [row] = await sql`
    SELECT c.*, c.checkin_date::text AS checkin_date, p.project_name
    FROM hs_daily_checkins c
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.staff_id = ${staffId}::uuid
      AND c.checkin_date = ${checkinDate}::date
      AND c.capture_mode = 'self'
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * The today board. Filters are folded into the WHERE via NULL-guards so there
 * is one query shape — the Neon shim binds each ${} as a value, never a SQL
 * fragment.
 */
export async function listCheckins(filters: {
  checkinDate: string;
  projectId?: string | null;
  contractorId?: string | null;
  clearance?: string | null;
}) {
  const pid = filters.projectId ?? null;
  const cid = filters.contractorId ?? null;
  const cl = filters.clearance ?? null;

  return await sql`
    SELECT
      c.*,
      c.checkin_date::text AS checkin_date,
      p.project_name,
      ct.company_name AS contractor_name,
      -- Derived, not stored: whether the worker's registered contractor agrees
      -- with the one this check-in was filed under. NULL = no worker record to
      -- check (name-only), false = the worker has no contractor recorded, so
      -- the attribution is unproven. Computed at read time so it reflects the
      -- data as it stands today: once team_members.contractor_id is populated,
      -- historical rows stop showing as unverified without a backfill.
      CASE
        WHEN c.team_member_id IS NULL THEN NULL
        WHEN tm.contractor_id IS NULL THEN false
        ELSE tm.contractor_id = c.contractor_id
      END AS contractor_link_verified
    FROM hs_daily_checkins c
    LEFT JOIN projects p ON p.id = c.project_id
    LEFT JOIN contractors ct ON ct.id = c.contractor_id
    LEFT JOIN team_members tm ON tm.id = c.team_member_id
    WHERE c.checkin_date = ${filters.checkinDate}::date
      AND (${pid}::uuid IS NULL OR c.project_id = ${pid}::uuid)
      AND (${cid}::uuid IS NULL OR c.contractor_id = ${cid}::uuid)
      AND (${cl}::text IS NULL OR c.clearance = ${cl}::text)
    ORDER BY
      CASE c.clearance WHEN 'blocked' THEN 0 WHEN 'cleared_by_override' THEN 1 ELSE 2 END,
      c.worker_name
  `;
}

/**
 * Who is clocked in today but has NOT checked in. This gap is the compliance
 * signal the whole feature exists to expose — a check-in count on its own
 * cannot distinguish "everyone complied" from "nobody bothered".
 */
export async function findClockedInWithoutCheckin(checkinDate: string) {
  return await sql`
    SELECT s.id AS staff_id,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS worker_name,
           a.clock_in_at
    FROM attendance_entries a
    JOIN staff s ON s.id = a.staff_id
    WHERE a.work_date = ${checkinDate}::date
      AND NOT EXISTS (
        SELECT 1 FROM hs_daily_checkins c
        WHERE c.staff_id = a.staff_id
          AND c.checkin_date = ${checkinDate}::date
          AND c.capture_mode = 'self'
      )
    ORDER BY worker_name
  `;
}
