/**
 * GET  /api/my/hs/checkin — today's H&S check-in status for the signed-in user
 * POST /api/my/hs/checkin — submit today's self declaration
 *
 * This endpoint is deliberately SEPARATE from clock-in rather than folded into
 * its payload. The check-in must never be able to fail a clock-in: attendance
 * is payroll-critical, and clock-in.ts already documents that missing a
 * clock-in is the worse failure. Keeping them as two calls makes fail-open a
 * structural property rather than a promise in a comment — the clock-in has
 * already committed by the time this runs.
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
  findSelfCheckin,
  lookupMedicalStatus,
  findActivitiesWithoutPermit,
} from '@/modules/health-safety/services/checkinService';
import {
  createCheckin,
  raiseHazardToRiskRegister,
} from '@/modules/health-safety/services/checkinWrite';
import { CHECKIN_ACTIVITIES, type CheckinWorkLocation } from '@/modules/health-safety/types/checkin.types';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accept a client-supplied attendance_entry_id only when it is the caller's own
 * open/closed entry. A uuid alone proves nothing about ownership, and linking a
 * check-in to someone else's attendance row would quietly corrupt the audit
 * trail this record exists to be.
 */
async function resolveOwnAttendanceEntry(
  staffId: string,
  raw: unknown
): Promise<string | null> {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) return null;
  const rows = await sql<{ id: string }>`
    SELECT id FROM attendance_entries
    WHERE id = ${raw}::uuid AND staff_id = ${staffId}::uuid
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export default withMySession(async (req, res, session) => {
  const today = sastWorkDate(new Date());

  try {
    if (req.method === 'GET') {
      const existing = await findSelfCheckin(session.staffId, today);
      // Projects the user can pick. Sticky default = yesterday's choice, which
      // makes this one tap after the first day.
      const projects = await sql<{ id: string; project_name: string }>`
        SELECT p.id, p.project_name
        FROM projects p
        WHERE p.status IN ('active', 'in_progress')
        ORDER BY p.project_name
      `;
      // work_location travels WITH project_id: an office day carries no project,
      // so returning the project alone would let one office day silently wipe a
      // site worker's sticky default (and offer a site worker no default at all
      // on the day after they sat in the office).
      const lastPick = await sql<{ project_id: string | null; work_location: string | null }>`
        SELECT project_id, work_location FROM hs_daily_checkins
        WHERE staff_id = ${session.staffId} AND capture_mode = 'self'
        ORDER BY checkin_date DESC LIMIT 1
      `;
      const lastLocation = lastPick[0]?.work_location;
      const defaultWorkLocation: CheckinWorkLocation | null =
        lastLocation === 'site' || lastLocation === 'office' ? lastLocation : null;
      const medicalStatus = await lookupMedicalStatus({ staffId: session.staffId }, today);

      return apiResponse.success(res, {
        checkin_date: today,
        completed: existing != null,
        checkin: existing,
        projects,
        default_project_id: lastPick[0]?.project_id ?? null,
        // Additive: the standalone page ignores an office default and keeps
        // using default_project_id, which is unchanged.
        default_work_location: defaultWorkLocation,
        activities: Object.values(CHECKIN_ACTIVITIES),
        // Surfaced so the worker learns about an expiring certificate at the
        // moment it matters, rather than discovering it when blocked.
        medical_status: medicalStatus,
      });
    }

    if (req.method !== 'POST') {
      return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
    }

    const body = req.body ?? {};

    const rawLocation = body.work_location ?? 'site';
    if (rawLocation !== 'site' && rawLocation !== 'office') {
      return apiResponse.badRequest(res, "work_location must be 'site' or 'office'");
    }
    const workLocation: CheckinWorkLocation = rawLocation;
    const isOffice = workLocation === 'office';

    // A site declaration is unattributable without a project; an office one has
    // no project to give.
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (!isOffice && !UUID_RE.test(projectId)) {
      return apiResponse.badRequest(res, 'project_id must be a uuid');
    }
    if (typeof body.fit_for_duty !== 'boolean') {
      return apiResponse.badRequest(res, 'fit_for_duty is a required boolean');
    }
    // PPE and activities are site-only questions. Coercing them here rather
    // than demanding them keeps the office body to the one question it asks.
    const ppeComplete = isOffice ? true : body.ppe_complete;
    if (typeof ppeComplete !== 'boolean') {
      return apiResponse.badRequest(res, 'ppe_complete is a required boolean');
    }
    const activities = isOffice ? [] : parseActivities(body.declared_activities);
    if (activities === null) {
      return apiResponse.badRequest(
        res,
        `declared_activities must be an array of: ${Object.keys(CHECKIN_ACTIVITIES).join(', ')}`
      );
    }
    const hazard =
      typeof body.hazard_reported === 'string' && body.hazard_reported.trim() !== ''
        ? body.hazard_reported.trim()
        : null;

    const existing = await findSelfCheckin(session.staffId, today);
    if (existing) {
      // Idempotent by day: re-submitting returns the existing row rather than
      // erroring, so a retry after a flaky connection is harmless.
      return apiResponse.success(res, { checkin: existing, already_completed: true });
    }

    const medicalStatus = !isOffice && requiresMedical(activities)
      ? await lookupMedicalStatus({ staffId: session.staffId }, today)
      : 'current';
    const withoutPermit = isOffice
      ? []
      : await findActivitiesWithoutPermit(projectId, activities, today);

    const decision = deriveClearance({
      work_location: workLocation,
      fit_for_duty: body.fit_for_duty,
      ppe_complete: ppeComplete,
      declared_activities: activities,
      medical_status: medicalStatus,
      hazard_reported: hazard,
      activities_without_permit: withoutPermit,
    });

    const workerName = session.staffName?.trim() || 'Unknown worker';
    // An office declaration has no project, so a reported hazard cannot open a
    // project risk. It is still recorded on the check-in row itself (below) —
    // nothing is lost, it just does not reach the risk register.
    const riskRegisterId =
      hazard && !isOffice
        ? await raiseHazardToRiskRegister({
            projectId,
            hazard,
            reportedBy: workerName,
            createdBy: null,
          })
        : null;

    let checkin;
    try {
      checkin = await createCheckin({
        checkinDate: today,
        projectId: isOffice ? null : projectId,
        workLocation,
        contractorId: null, // Velocity-internal; crew submissions carry theirs
        staffId: session.staffId,
        teamMemberId: null,
        workerName,
        captureMode: 'self',
        submissionId: crypto.randomUUID(),
        submittedByStaffId: session.staffId,
        signatureName: workerName,
        fitForDuty: body.fit_for_duty,
        ppeComplete,
        declaredActivities: activities,
        hazardReported: hazard,
        clearance: decision.clearance,
        blockedReasons: decision.blocked_reasons,
        activitiesWithoutPermit: withoutPermit,
        gpsLat: typeof body.lat === 'number' ? body.lat : null,
        gpsLon: typeof body.lon === 'number' ? body.lon : null,
        // Only accepted when it is the caller's OWN entry — a client-supplied id
        // for someone else's attendance row would corrupt the audit trail.
        attendanceEntryId: await resolveOwnAttendanceEntry(
          session.staffId,
          body.attendance_entry_id
        ),
        riskRegisterId,
        createdBy: null,
      });
    } catch (err) {
      // Two submissions racing past the findSelfCheckin check both reach the
      // INSERT; the partial unique index rejects the loser. That is the
      // intended outcome, not an error — return the row that won.
      const raced = await findSelfCheckin(session.staffId, today);
      if (raced) {
        // Recovered, but log it: a rising rate here means the client is
        // double-submitting, which is worth knowing rather than silently
        // absorbing.
        log.warn('[my/hs-checkin] concurrent submit resolved to the existing row', {
          staffId: session.staffId,
          err: err instanceof Error ? err.message : String(err),
        });
        return apiResponse.success(res, { checkin: raced, already_completed: true });
      }
      throw err;
    }

    log.info('[my/hs-checkin] recorded', {
      staffId: session.staffId,
      clearance: decision.clearance,
      warnings: decision.warnings,
    });

    return apiResponse.created(res, {
      checkin,
      clearance: decision.clearance,
      blocked_reasons: decision.blocked_reasons,
      warnings: decision.warnings,
    });
  } catch (error) {
    log.error('[my/hs-checkin] failed', { error, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to record H&S check-in');
  }
});
