/**
 * POST /api/my/hs/checkin-crew — a crew lead records today's declaration for a
 * subcontractor crew in one submission.
 *
 * Flat route (not /checkin/crew) per the project convention on nested dynamic
 * routes.
 *
 * This is the only path that reaches workers who have no phone and exist in
 * neither `staff` nor `team_members`: they are recorded by name, signed for by
 * the lead, exactly as hs_toolbox_attendance already records a signed-for
 * attendee.
 *
 * Honest limitation, surfaced rather than hidden: a lead attests on behalf of
 * the crew, so these rows are weaker evidence than a personal declaration, and
 * a worker we cannot identify cannot have their medical verified. Both are
 * recorded (capture_mode, and the medical_unverifiable warning) so the board
 * and the safety file can show them for what they are.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import {
  deriveClearance,
  parseActivities,
  requiresMedical,
} from '@/modules/health-safety/services/checkinClearance';
import {
  lookupMedicalStatus,
  findActivitiesWithoutPermit,
} from '@/modules/health-safety/services/checkinService';
import { raiseHazardToRiskRegister } from '@/modules/health-safety/services/checkinWrite';
import {
  createCrewCheckins,
  findCrewAlreadyCheckedIn,
  findCrewNamesAlreadyCheckedIn,
  classifyTeamMembers,
} from '@/modules/health-safety/services/checkinCrewWrite';
import { CHECKIN_ACTIVITIES } from '@/modules/health-safety/types/checkin.types';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CREW = 60;

interface CrewMemberInput {
  worker_name: string;
  team_member_id?: string | null;
  fit_for_duty: boolean;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const today = sastWorkDate(new Date());

  try {
    // Only a supervisor or admin may attest for other people. `supervisor` is
    // a valid staff.role in the DB constraint even though nobody holds it yet —
    // assigning it is an admin action, not a schema change.
    const [me] = await sql<{ role: string | null }>`
      SELECT role FROM staff WHERE id = ${session.staffId} LIMIT 1
    `;
    if (!me || !['supervisor', 'admin'].includes(me.role ?? '')) {
      return apiResponse.forbidden(
        res,
        'Only a supervisor or admin can submit a crew check-in'
      );
    }

    const body = req.body ?? {};
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    const contractorId = typeof body.contractor_id === 'string' ? body.contractor_id : '';
    if (!UUID_RE.test(projectId)) {
      return apiResponse.badRequest(res, 'project_id must be a uuid');
    }
    // Required, not optional: without it these rows never reach the contractor
    // gate they exist to feed (the DB enforces this too).
    if (!UUID_RE.test(contractorId)) {
      return apiResponse.badRequest(
        res,
        'contractor_id is required for a crew check-in — without it the crew never reaches the compliance gate'
      );
    }
    if (typeof body.ppe_complete !== 'boolean') {
      return apiResponse.badRequest(res, 'ppe_complete is required');
    }

    const activities = parseActivities(body.declared_activities);
    if (activities === null) {
      return apiResponse.badRequest(
        res,
        `declared_activities must be an array of: ${Object.keys(CHECKIN_ACTIVITIES).join(', ')}`
      );
    }

    const rawCrew = Array.isArray(body.crew) ? body.crew : null;
    if (!rawCrew || rawCrew.length === 0) {
      return apiResponse.badRequest(res, 'crew must be a non-empty array');
    }
    if (rawCrew.length > MAX_CREW) {
      return apiResponse.badRequest(res, `crew cannot exceed ${MAX_CREW} people in one submission`);
    }

    const crew: CrewMemberInput[] = [];
    const seen = new Set<string>();
    for (const raw of rawCrew) {
      const name = typeof raw?.worker_name === 'string' ? raw.worker_name.trim() : '';
      if (!name) return apiResponse.badRequest(res, 'every crew member needs a worker_name');
      const key = name.toLowerCase();
      if (seen.has(key)) {
        return apiResponse.badRequest(res, `"${name}" is listed twice in this submission`);
      }
      seen.add(key);
      const tmId = typeof raw.team_member_id === 'string' ? raw.team_member_id : null;
      if (tmId && !UUID_RE.test(tmId)) {
        return apiResponse.badRequest(res, `team_member_id for "${name}" must be a uuid`);
      }
      // STRICT boolean. `raw.fit_for_duty !== false` would treat the string
      // "false", 0, or null as fit — silently flipping an unfit worker to
      // cleared on malformed input, which the DB CHECK cannot catch because the
      // row it receives already claims fit_for_duty = true.
      if (raw.fit_for_duty !== undefined && typeof raw.fit_for_duty !== 'boolean') {
        return apiResponse.badRequest(res, `fit_for_duty for "${name}" must be true or false`);
      }
      crew.push({
        worker_name: name,
        team_member_id: tmId,
        fit_for_duty: raw.fit_for_duty ?? true, // omitted = fit; the lead unticks
      });
    }

    const hazard =
      typeof body.hazard_reported === 'string' && body.hazard_reported.trim() !== ''
        ? body.hazard_reported.trim()
        : null;

    const leadName = session.staffName?.trim() || 'Crew lead';
    const submissionId = crypto.randomUUID();

    // A supervisor must not be able to attest for a worker who belongs to a
    // DIFFERENT contractor — that attestation would feed the wrong gate.
    // Workers with no contractor recorded at all are accepted but flagged: see
    // classifyTeamMembers for why refusing them would be worse than allowing
    // them (it pushes leads to name-only submissions, which silently downgrades
    // the medical gate to advisory for every subcontractor worker).
    const claimedIds = crew.map((c) => c.team_member_id).filter((v): v is string => !!v);
    const { unlinked, foreign } = await classifyTeamMembers(contractorId, claimedIds);
    const foreignCrew = crew.filter((c) => c.team_member_id && foreign.has(c.team_member_id));
    if (foreignCrew.length > 0) {
      return apiResponse.badRequest(
        res,
        `Registered to a different contractor: ${foreignCrew.map((f) => f.worker_name).join(', ')}`
      );
    }

    // Duplicates are refused by name, not silently dropped by the unique index.
    // Registered workers are matched by id; name-only workers on the normalised
    // name, so both paths get the same loud error.
    const already = await findCrewAlreadyCheckedIn(contractorId, today, claimedIds);
    const nameOnly = crew.filter((c) => !c.team_member_id).map((c) => c.worker_name);
    const namesTaken = await findCrewNamesAlreadyCheckedIn(contractorId, today, nameOnly);
    const dupes = crew.filter(
      (c) =>
        (c.team_member_id && already.has(c.team_member_id)) ||
        (!c.team_member_id && namesTaken.has(c.worker_name.trim().toLowerCase()))
    );
    if (dupes.length > 0) {
      return apiResponse.conflict(
        res,
        `Already checked in today: ${dupes.map((d) => d.worker_name).join(', ')}. Resubmit with only the remaining crew.`
      );
    }

    const withoutPermit = await findActivitiesWithoutPermit(projectId, activities, today);
    const needsMedical = requiresMedical(activities);

    // One hazard per submission, raised once — not once per crew member.
    const riskRegisterId = hazard
      ? await raiseHazardToRiskRegister({
          projectId,
          hazard,
          reportedBy: `${leadName} (crew)`,
          createdBy: null,
        })
      : null;

    const members = [];
    for (const member of crew) {
      const medicalStatus = needsMedical
        ? await lookupMedicalStatus({ teamMemberId: member.team_member_id }, today)
        : 'current';
      const decision = deriveClearance({
        fit_for_duty: member.fit_for_duty,
        ppe_complete: body.ppe_complete,
        declared_activities: activities,
        medical_status: medicalStatus,
        hazard_reported: hazard,
        activities_without_permit: withoutPermit,
      });
      members.push({
        workerName: member.worker_name,
        teamMemberId: member.team_member_id ?? null,
        fitForDuty: member.fit_for_duty,
        clearance: decision.clearance,
        blockedReasons: decision.blocked_reasons,
      });
    }

    // All-or-nothing: a failure partway previously left some of the crew
    // committed and the rest not, with a retry duplicating the successful ones.
    const created = await createCrewCheckins({
      checkinDate: today,
      projectId,
      contractorId,
      submissionId,
      submittedByStaffId: session.staffId,
      signatureName: leadName,
      ppeComplete: body.ppe_complete,
      declaredActivities: activities,
      hazardReported: hazard,
      activitiesWithoutPermit: withoutPermit,
      gpsLat: typeof body.lat === 'number' ? body.lat : null,
      gpsLon: typeof body.lon === 'number' ? body.lon : null,
      riskRegisterId,
      members,
    });

    log.info('[my/hs-checkin-crew] recorded', {
      staffId: session.staffId,
      contractorId,
      crewSize: created.length,
      requested: crew.length,
      blocked: created.filter((c) => c.clearance === 'blocked').length,
    });

    // If the unique index still absorbed a row (a race between the pre-check
    // and the write), say so by name — `recorded` being smaller than the crew
    // submitted must never be the only signal.
    const writtenNames = new Set(
      created.map((c) => String(c.worker_name).trim().toLowerCase())
    );
    const skipped = crew
      .map((c) => c.worker_name)
      .filter((n) => !writtenNames.has(n.trim().toLowerCase()));

    return apiResponse.created(res, {
      submission_id: submissionId,
      recorded: created.length,
      skipped,
      contractor_link_unverified: crew
        .filter((c) => c.team_member_id && unlinked.has(c.team_member_id))
        .map((c) => c.worker_name),
      blocked: created.filter((c) => c.clearance === 'blocked').length,
      checkins: created,
    });
  } catch (error) {
    log.error('[my/hs-checkin-crew] failed', { error, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to record crew H&S check-in');
  }
});
