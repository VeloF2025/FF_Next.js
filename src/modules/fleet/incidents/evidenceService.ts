/**
 * Validated VF Storage evidence upload for the manager incident-review
 * surface (design §15, this task's brief). Mirrors reviewService/
 * reviewTransitions' shape — resolve scope, load+scope-check the incident,
 * then a single all-or-nothing write — but is kept separate because this
 * flow crosses an external system (VF Storage) between authorization and
 * the database transaction: the upload must happen strictly after
 * authorization/validation, and a database failure *after* a successful
 * upload must be recorded as a traceable orphan, never silently lost
 * (design §15: "log an orphan-storage cleanup task/reference").
 *
 * Never touches incident lifecycle columns or incidentNotifications — a
 * photo/upload failure therefore cannot block acknowledgement (which runs
 * through reviewTransitions.runAcknowledged) or emergency notification
 * delivery (which runs through incidentNotifications from the producer/
 * action-runner paths); this module never calls either.
 *
 * No delete path exists here or anywhere in this module — evidence is
 * append-only (incidentRepository grants no UPDATE/DELETE at the database
 * either; design §15: "File deletion is not exposed in PR 6").
 */
import { randomUUID } from 'node:crypto';
import { transaction, type TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { safeFilename, uploadCategorizedFile, VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';
import { insertIncidentAction, insertIncidentEvidence, IncidentNotFoundError } from './incidentRepository';
import { getIncidentCore } from './reviewQueries';
import { isProjectOwnedByScope, resolveIncidentScope } from './reviewScope';
import { SELF_REVIEW_REFUSAL_MESSAGE, isIncidentSubject } from './selfReviewGuard';
import type { IncidentEvidence, IncidentLifecycleStatus } from './types';

export { IncidentNotFoundError, VfStorageOriginError, VfStorageValidationError };

const MODULE = 'FleetIncidentEvidence';
const FLEET_EVIDENCE_CATEGORY = 'fleet/incidents';
const TERMINAL_STATUSES: readonly IncidentLifecycleStatus[] = ['resolved', 'dismissed'];

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
export const ALLOWED_EVIDENCE_MIME_TYPES: readonly string[] = Object.keys(MIME_EXTENSIONS);
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

const UPLOADABLE_EVIDENCE_TYPES = ['photo', 'document'] as const;
export type UploadableEvidenceType = (typeof UPLOADABLE_EVIDENCE_TYPES)[number];

export class IncidentEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentEvidenceValidationError';
  }
}

export class IncidentEvidenceAccessDeniedError extends Error {
  constructor(message = 'You cannot act on this Fleet incident') {
    super(message);
    this.name = 'IncidentEvidenceAccessDeniedError';
  }
}

export class IncidentEvidenceConflictError extends Error {
  constructor(message: string, public readonly lifecycleStatus: IncidentLifecycleStatus) {
    super(message);
    this.name = 'IncidentEvidenceConflictError';
  }
}

/** Thrown when the file is already sitting in VF Storage but the incident record could not be updated — carries the reference needed to reconcile it later. */
export class IncidentEvidenceOrphanError extends Error {
  constructor(message: string, public readonly storageKey: string, public readonly storageUrl: string) {
    super(message);
    this.name = 'IncidentEvidenceOrphanError';
  }
}

export interface AddIncidentEvidenceRequest {
  incidentId: string;
  actorUserId: string;
  evidenceType: UploadableEvidenceType;
  mimeType: string;
  base64: string;
  filename: string | null;
  description: string | null;
  requestCorrelationId: string | null;
}

export interface IncidentEvidenceViewer {
  userId: string;
  staffId: string | null;
  role: string;
}

export interface AddIncidentEvidenceResult {
  evidence: IncidentEvidence;
  actionId: string;
}

/** Fleet keys carry no component of the caller's filename or path — only the incident ID and a random UUID (this task's hard constraint). */
function buildStorageFilename(incidentId: string, mimeType: string): string {
  const extension = MIME_EXTENSIONS[mimeType] ?? 'bin';
  return `${incidentId}-${randomUUID()}.${extension}`;
}

interface LockedEvidenceRow extends Record<string, unknown> { lifecycle_status: IncidentLifecycleStatus }

/** Row-locked re-read of the one column that can change under an in-flight upload. */
async function lockIncidentForEvidence(incidentId: string, txn: TxnClient): Promise<IncidentLifecycleStatus> {
  const row = await txn.queryOne<LockedEvidenceRow>(
    `SELECT lifecycle_status FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`, [incidentId],
  );
  if (!row) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  if (TERMINAL_STATUSES.includes(row.lifecycle_status)) {
    throw new IncidentEvidenceConflictError('Evidence cannot be added to a closed incident', row.lifecycle_status);
  }
  return row.lifecycle_status;
}

export async function addIncidentEvidence(
  request: AddIncidentEvidenceRequest,
  viewer: IncidentEvidenceViewer,
): Promise<AddIncidentEvidenceResult> {
  if (!UPLOADABLE_EVIDENCE_TYPES.includes(request.evidenceType)) {
    throw new IncidentEvidenceValidationError(`evidenceType must be one of ${UPLOADABLE_EVIDENCE_TYPES.join(', ')}`);
  }

  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'edit');
  if (!scope) throw new IncidentEvidenceAccessDeniedError('You cannot act on Fleet incidents');

  const core = await getIncidentCore(request.incidentId);
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${request.incidentId}`);
  if (!scope.unrestricted && !(await isProjectOwnedByScope(scope, core.projectId))) {
    throw new IncidentEvidenceAccessDeniedError();
  }
  // Independent of project scope: nobody attaches evidence to an incident about themselves.
  if (isIncidentSubject(scope.pmStaffId, core.staffId)) {
    throw new IncidentEvidenceAccessDeniedError(SELF_REVIEW_REFUSAL_MESSAGE);
  }
  // Fast, unlocked rejection so an obviously closed incident never costs an upload. It is
  // NOT the enforcement point — `lockIncidentForEvidence` below is (see the race note there).
  if (TERMINAL_STATUSES.includes(core.lifecycleStatus)) {
    throw new IncidentEvidenceConflictError('Evidence cannot be added to a closed incident', core.lifecycleStatus);
  }

  // Upload only after authorization, scope, and lifecycle validation pass —
  // never before (this task's hard constraint). uploadCategorizedFile itself
  // validates MIME/size/base64 before making any network call.
  const uploaded = await uploadCategorizedFile({
    category: FLEET_EVIDENCE_CATEGORY,
    storageFilename: buildStorageFilename(request.incidentId, request.mimeType),
    base64: request.base64,
    mimeType: request.mimeType,
    allowedMimeTypes: ALLOWED_EVIDENCE_MIME_TYPES,
    maxBytes: MAX_EVIDENCE_BYTES,
  });

  // Display filename is sanitized independently of the storage key above —
  // a hostile filename can only ever influence this column, never the key.
  const sanitizedFilename = request.filename ? safeFilename(request.filename) : null;

  try {
    return await transaction(async (txn) => {
      // The check above ran before a VF Storage round trip, so another manager can have
      // resolved or dismissed the incident while this upload was in flight. Re-read the
      // status under FOR UPDATE here — the same shape reviewTransitions.lockIncident and
      // driver/driverEvidenceService.verifyEligibility use — or the module's invariant
      // ("Evidence cannot be added to a closed incident") is only advisory.
      const locked = await lockIncidentForEvidence(request.incidentId, txn);
      const evidence = await insertIncidentEvidence(
        {
          incidentId: request.incidentId,
          evidenceType: request.evidenceType,
          storageUrl: uploaded.url,
          storageKey: uploaded.key,
          mimeType: request.mimeType,
          originalFilename: sanitizedFilename,
          uploadedBy: request.actorUserId,
          description: request.description,
        },
        txn,
      );
      const action = await insertIncidentAction(
        {
          incidentId: request.incidentId,
          actionType: 'evidence_added',
          actorUserId: request.actorUserId,
          isSystemActor: false,
          note: null,
          beforeLifecycleStatus: locked,
          afterLifecycleStatus: locked,
          beforeEscalationLevel: null,
          afterEscalationLevel: null,
          metadata: { evidenceId: evidence.id, evidenceType: request.evidenceType },
          requestCorrelationId: request.requestCorrelationId,
        },
        txn,
      );
      return { evidence, actionId: action.id };
    });
  } catch (error) {
    // The file is now sitting in VF Storage with nothing pointing at it from
    // the incident. Never silently lose that — log a structured, traceable
    // reference (storage key/url only; no file content) so it can be
    // reconciled later (design §15).
    log.error(
      'Fleet incident evidence orphaned in VF Storage after a database failure',
      {
        incidentId: request.incidentId,
        storageKey: uploaded.key,
        storageUrl: uploaded.url,
        mimeType: request.mimeType,
        error: error instanceof Error ? error.message : String(error),
      },
      MODULE,
    );
    // A lost race (or a vanished incident) is the incident's real answer, not a database
    // outage: surface it as the 409/404 it is, never as a 500. The upload is orphaned either
    // way, which is why the log above runs before this branch.
    if (error instanceof IncidentEvidenceConflictError || error instanceof IncidentNotFoundError) throw error;
    throw new IncidentEvidenceOrphanError(
      'Evidence was uploaded to storage but could not be recorded against the incident',
      uploaded.key,
      uploaded.url,
    );
  }
}
