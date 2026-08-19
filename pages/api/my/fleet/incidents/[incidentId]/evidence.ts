/**
 * POST /api/my/fleet/incidents/{incidentId}/evidence — a driver's own
 * evidence attachment for an incident they own (PR7 Task 5, design §9/§14).
 * `session.staffId` is always the uploading identity, derived from the
 * `/my` portal cookie — the request body carries no staff/driver id field
 * that could override it (design §10). No DELETE/PUT route exists —
 * evidence is append-only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  DriverEvidenceNotEligibleError, DriverEvidenceOrphanError, DriverEvidenceValidationError,
  uploadDriverIncidentEvidence,
} from '@/modules/fleet/incidents/driver/driverEvidenceService';
import { VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';
import type { UploadDriverEvidenceCommand } from '@/modules/fleet/incidents/driver/driverEvidenceService';

// The effective evidence_max_bytes setting defaults to 15MB; base64 adds
// ~33% overhead (~20MB) plus JSON/field overhead. 20mb (matching the `/my`
// convention of sizing the limit to the largest legitimate payload, e.g.
// `clock-in.ts`'s 12mb selfie) comfortably covers the default with
// headroom; the effective allowlist/byte cap itself is still enforced
// server-side by `uploadDriverIncidentEvidence` against the configured
// settings, not this transport-level ceiling.
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

type ParsedBody = Omit<UploadDriverEvidenceCommand, 'incidentId'>;

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DriverEvidenceValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const mimeType = value.mimeType;
  if (typeof mimeType !== 'string' || !mimeType.trim()) throw new DriverEvidenceValidationError('mimeType is required');
  const base64 = value.base64;
  if (typeof base64 !== 'string' || !base64.trim()) throw new DriverEvidenceValidationError('base64 file content is required');

  const filename = typeof value.filename === 'string' && value.filename.trim() ? value.filename.trim() : null;
  const description = typeof value.description === 'string' && value.description.trim() ? value.description.trim() : null;

  return { mimeType: mimeType.trim(), base64, filename, description };
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string') return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    const parsed = parseBody(req.body);
    const result = await uploadDriverIncidentEvidence({ incidentId, ...parsed }, session.staffId);
    return apiResponse.created(res, result);
  } catch (error) {
    if (error instanceof DriverEvidenceValidationError || error instanceof VfStorageValidationError) {
      return apiResponse.badRequest(res, error.message);
    }
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof DriverEvidenceNotEligibleError) return apiResponse.conflict(res, error.message, { reason: error.reason });
    if (error instanceof VfStorageOriginError || error instanceof DriverEvidenceOrphanError) {
      log.error('[my-fleet-incidents] driver evidence upload failed after a storage write', {
        staffId: session.staffId, incidentId, error: error instanceof Error ? error.message : String(error),
      }, 'fleet');
      return apiResponse.internalError(res, error);
    }
    log.error('[my-fleet-incidents] failed to upload driver evidence', {
      staffId: session.staffId, incidentId, error: error instanceof Error ? error.message : String(error),
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(handler);
