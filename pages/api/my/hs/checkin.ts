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
import { CHECKIN_ACTIVITIES } from '@/modules/health-safety/types/checkin.types';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const lastPick = await sql<{ project_id: string }>`
        SELECT project_id FROM hs_daily_checkins
        WHERE staff_id = ${session.staffId} AND capture_mode = 'self'
        ORDER BY checkin_date DESC LIMIT 1
      `;
      const medicalStatus = await lookupMedicalStatus({ staffId: session.staffId });

      return apiResponse.success(res, {
        checkin_date: today,
        completed: existing != null,
        checkin: existing,
        projects,
        default_project_id: lastPick[0]?.project_id ?? null,
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
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (!UUID_RE.test(projectId)) {
      return apiResponse.badRequest(res, 'project_id must be a uuid');
    }
    if (typeof body.fit_for_duty !== 'boolean' || typeof body.ppe_complete !== 'boolean') {
      return apiResponse.badRequest(res, 'fit_for_duty and ppe_complete are required booleans');
    }
    const activities = parseActivities(body.declared_activities);
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

    const medicalStatus = requiresMedical(activities)
      ? await lookupMedicalStatus({ staffId: session.staffId })
      : 'current';
    const withoutPermit = await findActivitiesWithoutPermit(projectId, activities);

    const decision = deriveClearance({
      fit_for_duty: body.fit_for_duty,
      ppe_complete: body.ppe_complete,
      declared_activities: activities,
      medical_status: medicalStatus,
      hazard_reported: hazard,
      activities_without_permit: withoutPermit,
    });

    const workerName = session.staffName?.trim() || 'Unknown worker';
    const riskRegisterId = hazard
      ? await raiseHazardToRiskRegister({
          projectId,
          hazard,
          reportedBy: workerName,
          createdBy: null,
        })
      : null;

    const checkin = await createCheckin({
      checkinDate: today,
      projectId,
      contractorId: null, // Velocity-internal; crew submissions carry theirs
      staffId: session.staffId,
      teamMemberId: null,
      workerName,
      captureMode: 'self',
      submissionId: crypto.randomUUID(),
      submittedByStaffId: session.staffId,
      signatureName: workerName,
      fitForDuty: body.fit_for_duty,
      ppeComplete: body.ppe_complete,
      declaredActivities: activities,
      hazardReported: hazard,
      clearance: decision.clearance,
      blockedReasons: decision.blocked_reasons,
      gpsLat: typeof body.lat === 'number' ? body.lat : null,
      gpsLon: typeof body.lon === 'number' ? body.lon : null,
      attendanceEntryId:
        typeof body.attendance_entry_id === 'string' && UUID_RE.test(body.attendance_entry_id)
          ? body.attendance_entry_id
          : null,
      riskRegisterId,
      createdBy: null,
    });

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
