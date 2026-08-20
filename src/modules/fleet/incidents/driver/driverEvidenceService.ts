/**
 * Driver-scoped VF Storage evidence upload (PR7 Task 5, design §9).
 *
 * Mirrors `../evidenceService.ts`'s shape — authorize before ever reaching
 * VF Storage, upload strictly outside any open transaction, then a single
 * all-or-nothing write — for the same reason that module gives: the upload
 * crosses an external system between authorization and the database write,
 * so holding a row lock across that call would block other operations for
 * the entire upload duration. This module therefore uses two short-lived
 * transactions rather than one: `verifyEligibility` locks/rechecks and
 * commits immediately (releasing the lock before any network call), then a
 * second transaction performs the append-only insert after upload succeeds.
 *
 * Storage-vs-database failure ordering (this task's explicit ruling):
 *   - authorize/eligibility fails -> nothing uploaded, nothing written;
 *   - upload fails (validation, origin, network) -> nothing written, the
 *     already-open incident/settings state is untouched;
 *   - upload succeeds but the insert transaction fails -> the file is now
 *     an orphan in VF Storage with no DB row pointing at it. This is
 *     recorded via a structured log (storage key/url only, never base64)
 *     and surfaced as `DriverEvidenceOrphanError` so it can be reconciled
 *     later, exactly like `../evidenceService.ts`'s `IncidentEvidenceOrphanError`.
 * There is no path that reports success without a committed database row.
 *
 * Reuses `computeResponseEligibility` from `./driverIncidentService.ts` —
 * the same rule `./submissionService.ts` uses — so evidence and text
 * responses can never disagree about whether the incident currently
 * accepts driver input. `sessionStaffId` is always a required, separate
 * argument derived from the `/my` session; the command carries no staff
 * identity field to override it (design §10).
 *
 * The evidence/action rows are written with raw parameterized SQL here
 * rather than through `../incidentRepository.ts`'s `insertIncidentEvidence`/
 * `insertIncidentAction` — those functions have no `visibility`/
 * `uploaded_by_staff_id`/`actor_staff_id` columns in their INSERT lists
 * (added by migration 506 for PR6's `internal`-by-default columns), so
 * reusing them would silently persist `visibility = 'internal'` for a
 * driver upload. `./submissionService.ts` made the same call for its own
 * `driver_response_received` action row.
 */
import { randomUUID } from 'node:crypto';
import { transaction, type TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { safeFilename, uploadCategorizedFile, VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';
import { isValidUUID } from '../../services/mileageUtils';
import { IncidentNotFoundError } from '../incidentRepository';
import { computeResponseEligibility, type ResponseIneligibleReason } from './driverIncidentService';
import { findCurrentInputRequest, lockIncidentForDriver } from './driverInputRepository';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type { DriverEvidenceResult, DriverInputSettings } from './types';

export { IncidentNotFoundError, VfStorageOriginError, VfStorageValidationError };

const MODULE = 'FleetDriverEvidence';
const FLEET_EVIDENCE_CATEGORY = 'fleet/incidents';

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
};

export class DriverEvidenceValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverEvidenceValidationError'; }
}

/** Well-formed and owned by the caller, but the response window/terminal policy does not currently accept an upload — mirrors `./submissionService.ts`'s `DriverSubmissionNotEligibleError`. */
export class DriverEvidenceNotEligibleError extends Error {
  readonly reason: ResponseIneligibleReason;
  constructor(reason: ResponseIneligibleReason) {
    super(`Driver evidence is not currently accepted on this incident (${reason})`);
    this.name = 'DriverEvidenceNotEligibleError';
    this.reason = reason;
  }
}

/** The file is already sitting in VF Storage but the incident record could not be updated — carries the reference needed to reconcile it later. */
export class DriverEvidenceOrphanError extends Error {
  constructor(message: string, public readonly storageKey: string, public readonly storageUrl: string) {
    super(message);
    this.name = 'DriverEvidenceOrphanError';
  }
}

/** User-entered content only. `sessionStaffId` is always a separate, server-derived argument to `uploadDriverIncidentEvidence` — never a field here. */
export interface UploadDriverEvidenceCommand {
  incidentId: string;
  mimeType: string;
  base64: string;
  filename: string | null;
  description: string | null;
}

interface ParsedCommand { incidentId: string; mimeType: string; base64: string; filename: string | null; description: string | null }

function validateCommand(command: UploadDriverEvidenceCommand): ParsedCommand {
  if (!isValidUUID(command.incidentId)) throw new DriverEvidenceValidationError('incidentId must be a valid UUID');
  if (typeof command.mimeType !== 'string' || !command.mimeType.trim()) throw new DriverEvidenceValidationError('mimeType is required');
  if (typeof command.base64 !== 'string' || !command.base64.trim()) throw new DriverEvidenceValidationError('base64 file content is required');
  const filename = typeof command.filename === 'string' && command.filename.trim() ? command.filename.trim() : null;
  const description = typeof command.description === 'string' && command.description.trim() ? command.description.trim() : null;
  return { incidentId: command.incidentId, mimeType: command.mimeType.trim(), base64: command.base64, filename, description };
}

/** Fleet keys carry no component of the caller's filename or path — only the incident ID and a random UUID, matching `../evidenceService.ts`'s constraint. */
function buildStorageFilename(incidentId: string, mimeType: string): string {
  const extension = MIME_EXTENSIONS[mimeType] ?? 'bin';
  return `${incidentId}-${randomUUID()}.${extension}`;
}

/** Driver-uploaded images are `photo`; anything else (PDFs, and any future configured type) is `document` — the only two `IncidentEvidenceType` values PR6's own upload flow accepts. */
function evidenceTypeFor(mimeType: string): 'photo' | 'document' {
  return mimeType.startsWith('image/') ? 'photo' : 'document';
}

/**
 * Locks the incident scoped to `sessionStaffId` and rechecks response
 * eligibility, then commits immediately — this transaction never spans the
 * VF Storage upload (constraint: authorize before uploading, and never
 * hold a lock across a network call).
 */
async function verifyEligibility(
  sessionStaffId: string, incidentId: string, settings: DriverInputSettings, now: string,
): Promise<{ lifecycleStatus: string }> {
  return transaction(async (txn: TxnClient) => {
    const locked = await lockIncidentForDriver(sessionStaffId, incidentId, txn);
    if (!locked) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);

    const currentRequest = await findCurrentInputRequest(incidentId, txn);
    const eligibility = computeResponseEligibility({
      now, currentRequest: currentRequest ? { respondBy: currentRequest.respondBy } : null,
      incidentTerminalAt: locked.terminalAt,
      postClosureResponseEnabled: settings.postClosureResponseEnabled,
      postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
    });
    if (!eligibility.eligible) throw new DriverEvidenceNotEligibleError(eligibility.reason);

    return { lifecycleStatus: locked.lifecycleStatus };
  });
}

interface EvidenceInsertRow extends Record<string, unknown> { id: string; storage_url: string }

/** Append-only evidence + `evidence_added` action, both `driver_submitted` — a submission never sets lifecycle/outcome/acknowledgement/visibility of the incident itself, so before/after lifecycle status are recorded unchanged and there is no escalation-level change. */
async function insertDriverEvidence(
  parsed: ParsedCommand, sessionStaffId: string, lifecycleStatus: string, uploaded: { url: string; key: string },
  sanitizedFilename: string | null,
): Promise<DriverEvidenceResult> {
  const evidenceType = evidenceTypeFor(parsed.mimeType);
  return transaction(async (txn: TxnClient) => {
    const evidenceRow = await txn.queryOne<EvidenceInsertRow>(
      `INSERT INTO fleet_operational_incident_evidence
        (incident_id, evidence_type, storage_url, storage_key, mime_type, original_filename, uploaded_by_staff_id, description, visibility)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, 'driver_submitted')
       RETURNING id, storage_url`,
      [parsed.incidentId, evidenceType, uploaded.url, uploaded.key, parsed.mimeType, sanitizedFilename, sessionStaffId, parsed.description],
    );
    if (!evidenceRow) throw new Error('Driver evidence insert returned no row');

    await txn.query(
      `INSERT INTO fleet_operational_incident_actions
        (incident_id, action_type, actor_staff_id, is_system_actor, note, visibility,
         before_lifecycle_status, after_lifecycle_status, metadata)
       VALUES ($1::uuid, 'evidence_added', $2::uuid, false, NULL, 'driver_submitted', $3, $3, $4::jsonb)`,
      [parsed.incidentId, sessionStaffId, lifecycleStatus, JSON.stringify({ evidenceId: evidenceRow.id, evidenceType })],
    );

    return { evidenceId: evidenceRow.id, incidentId: parsed.incidentId, storageUrl: evidenceRow.storage_url };
  });
}

/**
 * Accepts one driver-uploaded evidence file for an incident the caller
 * owns. `sessionStaffId` is a required, separate argument derived from the
 * `/my` session — the command carries no staff identity field to override
 * it. Never called before authorization/eligibility pass; never reports
 * success without a committed database row (see this module's docstring
 * for the full storage-vs-database failure ruling).
 */
export async function uploadDriverIncidentEvidence(
  command: UploadDriverEvidenceCommand, sessionStaffId: string,
): Promise<DriverEvidenceResult> {
  const parsed = validateCommand(command);
  const now = new Date().toISOString();
  const settings = await getEffectiveDriverInputSettings(now);

  const { lifecycleStatus } = await verifyEligibility(sessionStaffId, parsed.incidentId, settings, now);

  // Upload only after authorization/scope/eligibility checks pass — never
  // before. uploadCategorizedFile itself validates MIME/size/base64 (from
  // the effective settings allowlist, not a hardcoded one) and verifies
  // the returned origin before any row is written.
  const uploaded = await uploadCategorizedFile({
    category: FLEET_EVIDENCE_CATEGORY,
    storageFilename: buildStorageFilename(parsed.incidentId, parsed.mimeType),
    base64: parsed.base64,
    mimeType: parsed.mimeType,
    allowedMimeTypes: settings.evidenceAllowedMimeTypes,
    maxBytes: settings.evidenceMaxBytes,
  });

  // Display filename is sanitized independently of the storage key above —
  // a hostile filename can only ever influence this column, never the key.
  const sanitizedFilename = parsed.filename ? safeFilename(parsed.filename) : null;

  try {
    return await insertDriverEvidence(parsed, sessionStaffId, lifecycleStatus, uploaded, sanitizedFilename);
  } catch (error) {
    // The file is now sitting in VF Storage with nothing pointing at it
    // from the incident. Never silently lose that — log a structured,
    // traceable reference (storage key/url only; no file content) so it
    // can be reconciled later.
    log.error(
      'Driver Fleet incident evidence orphaned in VF Storage after a database failure',
      {
        incidentId: parsed.incidentId, storageKey: uploaded.key, storageUrl: uploaded.url, mimeType: parsed.mimeType,
        error: error instanceof Error ? error.message : String(error),
      },
      MODULE,
    );
    throw new DriverEvidenceOrphanError(
      'Evidence was uploaded to storage but could not be recorded against the incident',
      uploaded.key, uploaded.url,
    );
  }
}
