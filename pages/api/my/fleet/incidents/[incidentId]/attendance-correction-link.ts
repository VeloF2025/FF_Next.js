/**
 * GET/POST /api/my/fleet/incidents/{incidentId}/attendance-correction-link
 * — canonical Attendance correction linking for a driver's own incident
 * (PR7 Task 6, design §8/§14). `session.staffId` is always the acting
 * identity, derived from the `/my` portal cookie — the request body
 * carries no staff/driver id field that could override it (design §10).
 *
 * GET answers whether the incident's work date currently has an open
 * Attendance "missing clock-out" exception the driver may correct. POST
 * records a durable reference to an Attendance correction the driver
 * already submitted through Attendance's own workflow — it never creates
 * or mutates an `attendance_adjustments` row itself.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  AttendanceCorrectionLinkValidationError, AttendanceCorrectionNotFoundError,
  getAttendanceCorrectionEligibility, linkAttendanceCorrection,
} from '@/modules/fleet/incidents/driver/attendanceCorrectionLinkService';
import type { LinkAttendanceCorrectionCommand } from '@/modules/fleet/incidents/driver/attendanceCorrectionLinkService';

// Both UUIDs plus JSON overhead comfortably fit well under 4kb.
export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

type ParsedBody = Omit<LinkAttendanceCorrectionCommand, 'incidentId'>;

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AttendanceCorrectionLinkValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const attendanceCorrectionId = value.attendanceCorrectionId;
  if (typeof attendanceCorrectionId !== 'string' || !attendanceCorrectionId.trim()) {
    throw new AttendanceCorrectionLinkValidationError('attendanceCorrectionId is required');
  }
  const driverSubmissionId = value.driverSubmissionId;
  if (driverSubmissionId !== undefined && driverSubmissionId !== null && typeof driverSubmissionId !== 'string') {
    throw new AttendanceCorrectionLinkValidationError('driverSubmissionId must be a string');
  }

  return {
    attendanceCorrectionId,
    driverSubmissionId: (driverSubmissionId as string | undefined) ?? null,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string') return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    if (req.method === 'GET') {
      const eligibility = await getAttendanceCorrectionEligibility(incidentId, session.staffId);
      return apiResponse.success(res, eligibility);
    }
    if (req.method === 'POST') {
      const parsed = parseBody(req.body);
      const result = await linkAttendanceCorrection({ incidentId, ...parsed }, session.staffId);
      return apiResponse.success(res, result);
    }
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    if (error instanceof AttendanceCorrectionLinkValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof AttendanceCorrectionNotFoundError) {
      return apiResponse.notFound(res, 'Attendance correction', error.attendanceCorrectionId);
    }
    log.error('[my-fleet-incidents] failed to process attendance correction link', {
      staffId: session.staffId, incidentId, method: req.method, error: error instanceof Error ? error.message : String(error),
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(handler);
