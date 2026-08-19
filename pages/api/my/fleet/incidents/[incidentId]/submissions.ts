/**
 * POST /api/my/fleet/incidents/{incidentId}/submissions — a driver's
 * explanation, follow-up, or structured concern report (PR7 Task 4).
 * `session.staffId` is always the submitting identity, derived from the
 * `/my` portal cookie — the request body carries no staff/driver id field
 * that could override it (design §10).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  DriverSubmissionNotEligibleError, DriverSubmissionValidationError, submitDriverResponse,
} from '@/modules/fleet/incidents/driver/submissionService';
import type { SubmitDriverResponseCommand } from '@/modules/fleet/incidents/driver/types';

type ParsedBody = Omit<SubmitDriverResponseCommand, 'incidentId'>;

/**
 * Type-shape validation only. Semantic validation (explanation length,
 * enabled-category check, response-window/terminal-policy eligibility)
 * lives in `submitDriverResponse` itself, matching PR6's
 * `request-driver-input.ts` split so both this API and any future
 * non-HTTP caller share one rule set.
 */
function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DriverSubmissionValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const submissionKind = value.submissionKind;
  if (submissionKind !== 'response' && submissionKind !== 'follow_up') {
    throw new DriverSubmissionValidationError('submissionKind must be "response" or "follow_up"');
  }
  const explanation = value.explanation;
  if (typeof explanation !== 'string') throw new DriverSubmissionValidationError('explanation must be a string');

  const concernCategory = value.concernCategory;
  if (concernCategory !== undefined && concernCategory !== null && typeof concernCategory !== 'string') {
    throw new DriverSubmissionValidationError('concernCategory must be a string');
  }
  const idempotencyKey = value.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new DriverSubmissionValidationError('idempotencyKey is required');

  return {
    submissionKind, explanation,
    concernCategory: (concernCategory as SubmitDriverResponseCommand['concernCategory']) ?? null,
    idempotencyKey,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string') return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    const parsed = parseBody(req.body);
    const result = await submitDriverResponse({ incidentId, ...parsed }, session.staffId);
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof DriverSubmissionValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof DriverSubmissionNotEligibleError) return apiResponse.conflict(res, error.message, { reason: error.reason });
    log.error('[my-fleet-incidents] failed to submit a driver response', {
      staffId: session.staffId, incidentId, error: error instanceof Error ? error.message : String(error),
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(handler);
