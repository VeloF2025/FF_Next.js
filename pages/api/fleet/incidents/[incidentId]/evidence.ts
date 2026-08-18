import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import {
  IncidentEvidenceAccessDeniedError,
  IncidentEvidenceConflictError,
  IncidentEvidenceOrphanError,
  IncidentEvidenceValidationError,
  IncidentNotFoundError,
  addIncidentEvidence,
  type AddIncidentEvidenceRequest,
} from '@/modules/fleet/incidents/evidenceService';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

const EVIDENCE_TYPES = ['photo', 'document'] as const;

type ParsedEvidenceBody = Omit<AddIncidentEvidenceRequest, 'incidentId' | 'actorUserId'>;

function parseBody(body: unknown): ParsedEvidenceBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncidentEvidenceValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const evidenceType = value.evidenceType;
  if (typeof evidenceType !== 'string' || !EVIDENCE_TYPES.includes(evidenceType as (typeof EVIDENCE_TYPES)[number])) {
    throw new IncidentEvidenceValidationError('evidenceType must be photo or document');
  }
  const mimeType = value.mimeType;
  if (typeof mimeType !== 'string' || !mimeType.trim()) throw new IncidentEvidenceValidationError('mimeType is required');
  const base64 = value.base64;
  if (typeof base64 !== 'string' || !base64.trim()) throw new IncidentEvidenceValidationError('base64 file content is required');

  const filename = typeof value.filename === 'string' && value.filename.trim() ? value.filename.trim() : null;
  const description = typeof value.description === 'string' && value.description.trim() ? value.description.trim() : null;
  const requestCorrelationId = typeof value.requestCorrelationId === 'string' ? value.requestCorrelationId : null;

  return {
    evidenceType: evidenceType as ParsedEvidenceBody['evidenceType'],
    mimeType: mimeType.trim(),
    base64,
    filename,
    description,
    requestCorrelationId,
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    const parsed = parseBody(req.body);
    const staffId = await resolveStaffIdForUser(user.id);
    // The actor is always the authenticated session user — never a value from the request body.
    const result = await addIncidentEvidence(
      { incidentId, actorUserId: user.id, ...parsed },
      { userId: user.id, staffId, role: user.role },
    );
    return apiResponse.created(res, result);
  } catch (error) {
    if (error instanceof IncidentEvidenceValidationError || error instanceof VfStorageValidationError) {
      return apiResponse.badRequest(res, error.message);
    }
    if (error instanceof IncidentEvidenceAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof IncidentEvidenceConflictError) return apiResponse.conflict(res, error.message);
    if (error instanceof VfStorageOriginError || error instanceof IncidentEvidenceOrphanError) {
      log.error('Fleet incident evidence upload failed after a storage write', { error, incidentId }, 'fleet');
      return apiResponse.internalError(res, error);
    }
    log.error('Failed to add Fleet incident evidence', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return withPermission('fleet.incidents', 'edit')(handler)(req, res);
}
export default withAuth(route);
