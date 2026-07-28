/**
 * GET /api/health-safety/checkins — the daily check-in board.
 *
 * Filters: date (defaults to today in SAST), project_id, contractor_id, clearance.
 *
 * Also returns `clocked_in_without_checkin`: people who recorded time today but
 * never declared. That gap is the point of the board — a check-in count on its
 * own cannot tell "everyone complied" from "nobody bothered".
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import {
  listCheckins,
  findClockedInWithoutCheckin,
} from '@/modules/health-safety/services/checkinService';
import {
  CHECKIN_ACTIVITIES,
  type CheckinActivity,
  type CheckinWarning,
} from '@/modules/health-safety/types/checkin.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLEARANCES = ['cleared', 'blocked', 'cleared_by_override'];

/**
 * Warnings are derived at read time rather than stored: they are a view over
 * facts already on the row, so persisting them would create a second source of
 * truth that could drift from the data it describes.
 */
function deriveWarnings(row: Record<string, unknown>): CheckinWarning[] {
  const warnings: CheckinWarning[] = [];
  if (row.ppe_complete === false) warnings.push('ppe_incomplete');
  const hazard = row.hazard_reported;
  if (typeof hazard === 'string' && hazard.trim() !== '') warnings.push('hazard_reported');
  const activities = Array.isArray(row.declared_activities)
    ? (row.declared_activities as CheckinActivity[])
    : [];
  const unidentified = row.staff_id == null && row.team_member_id == null;
  if (unidentified && activities.some((a) => CHECKIN_ACTIVITIES[a]?.requires_medical)) {
    warnings.push('medical_unverifiable');
  }
  return warnings;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { date, project_id, contractor_id, clearance } = req.query;

    const checkinDate = typeof date === 'string' && date !== '' ? date : sastWorkDate(new Date());
    if (!DATE_RE.test(checkinDate)) {
      return apiResponse.badRequest(res, 'date must be YYYY-MM-DD');
    }
    for (const [name, value] of Object.entries({ project_id, contractor_id })) {
      if (typeof value === 'string' && value !== '' && !UUID_RE.test(value)) {
        return apiResponse.badRequest(res, `${name} must be a uuid`);
      }
    }
    if (typeof clearance === 'string' && clearance !== '' && !CLEARANCES.includes(clearance)) {
      return apiResponse.badRequest(res, `clearance must be one of: ${CLEARANCES.join(', ')}`);
    }

    const rows = await listCheckins({
      checkinDate,
      projectId: typeof project_id === 'string' && project_id !== '' ? project_id : null,
      contractorId: typeof contractor_id === 'string' && contractor_id !== '' ? contractor_id : null,
      clearance: typeof clearance === 'string' && clearance !== '' ? clearance : null,
    });

    // The shim returns loosely-typed rows; name the shape we rely on so the
    // stats below are type-checked rather than inferred away to `unknown`.
    const checkins: (Record<string, unknown> & { clearance: string; warnings: CheckinWarning[] })[] =
      rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, clearance: String(row.clearance), warnings: deriveWarnings(row) };
      });
    const missing = await findClockedInWithoutCheckin(checkinDate);

    const stats = {
      total: checkins.length,
      cleared: checkins.filter((c) => c.clearance === 'cleared').length,
      blocked: checkins.filter((c) => c.clearance === 'blocked').length,
      overridden: checkins.filter((c) => c.clearance === 'cleared_by_override').length,
      hazards: checkins.filter((c) => c.warnings.includes('hazard_reported')).length,
      ppe_gaps: checkins.filter((c) => c.warnings.includes('ppe_incomplete')).length,
      medical_unverifiable: checkins.filter((c) => c.warnings.includes('medical_unverifiable')).length,
      clocked_in_without_checkin: missing.length,
    };

    return apiResponse.success(res, {
      checkin_date: checkinDate,
      checkins,
      clocked_in_without_checkin: missing,
      stats,
    });
  } catch (error) {
    log.error('[H&S Checkins API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withHsPermission(handler);
