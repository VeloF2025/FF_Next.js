/**
 * Append-only driver-input writes (migration 503): requests, submissions,
 * and Attendance correction links. Paired with `./driverInputRepository.ts`
 * (locking/reads) — split out once the combined file passed the 300-line
 * new-file ratchet, mirroring `../incidentRepository.ts`'s own
 * core-CRUD-vs-append-only split. Every mutation takes a caller-supplied
 * `TxnClient` and never opens its own transaction.
 */
import type { TxnClient } from '@/lib/db-pool';
import { iso, mapRequest, REQUEST_COLUMNS, type DriverInputRequestRecord, type RequestRow } from './driverInputRepository';
import type { DriverConcernCategory, DriverSubmissionKind } from './types';

export interface InsertResult<T> { record: T; created: boolean }

export interface InsertInputRequestInput { incidentId: string; requestedBy: string; guidance: string | null; respondBy: string; idempotencyKey: string }

/** Append-only, idempotent on `(incident_id, idempotency_key)`: a retried request returns the original row rather than erroring or duplicating. */
export async function insertInputRequest(input: InsertInputRequestInput, txn: TxnClient): Promise<InsertResult<DriverInputRequestRecord>> {
  const created = await txn.queryOne<RequestRow>(
    `INSERT INTO fleet_incident_driver_input_requests (incident_id, requested_by, guidance, respond_by, idempotency_key)
     VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5)
     ON CONFLICT (incident_id, idempotency_key) DO NOTHING
     RETURNING ${REQUEST_COLUMNS}`,
    [input.incidentId, input.requestedBy, input.guidance, input.respondBy, input.idempotencyKey],
  );
  if (created) return { record: mapRequest(created), created: true };
  const existing = await txn.queryOne<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM fleet_incident_driver_input_requests WHERE incident_id = $1::uuid AND idempotency_key = $2`,
    [input.incidentId, input.idempotencyKey],
  );
  if (!existing) throw new Error('Driver input request insert returned no row and no existing row found');
  return { record: mapRequest(existing), created: false };
}

interface SubmissionRow extends Record<string, unknown> {
  id: string; incident_id: string; input_request_id: string | null; staff_id: string; submission_kind: DriverSubmissionKind;
  explanation: string; concern_category: DriverConcernCategory | null; idempotency_key: string; created_at: string | Date;
}
export interface DriverSubmissionRecord {
  id: string; incidentId: string; inputRequestId: string | null; staffId: string; submissionKind: DriverSubmissionKind;
  explanation: string; concernCategory: DriverConcernCategory | null; idempotencyKey: string; createdAt: string;
}
function mapSubmission(row: SubmissionRow): DriverSubmissionRecord {
  return {
    id: row.id, incidentId: row.incident_id, inputRequestId: row.input_request_id, staffId: row.staff_id,
    submissionKind: row.submission_kind, explanation: row.explanation, concernCategory: row.concern_category,
    idempotencyKey: row.idempotency_key, createdAt: iso(row.created_at),
  };
}

export interface InsertDriverSubmissionInput {
  incidentId: string; inputRequestId: string | null; staffId: string; submissionKind: DriverSubmissionKind; explanation: string;
  concernCategory: DriverConcernCategory | null; idempotencyKey: string; clientMetadata: Record<string, unknown>;
}

/** Append-only, idempotent on `(incident_id, staff_id, idempotency_key)`. */
export async function insertDriverSubmission(input: InsertDriverSubmissionInput, txn: TxnClient): Promise<InsertResult<DriverSubmissionRecord>> {
  const columns = 'id, incident_id, input_request_id, staff_id, submission_kind, explanation, concern_category, idempotency_key, created_at';
  const created = await txn.queryOne<SubmissionRow>(
    `INSERT INTO fleet_incident_driver_submissions
      (incident_id, input_request_id, staff_id, submission_kind, explanation, concern_category, idempotency_key, client_metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (incident_id, staff_id, idempotency_key) DO NOTHING
     RETURNING ${columns}`,
    [input.incidentId, input.inputRequestId, input.staffId, input.submissionKind, input.explanation,
      input.concernCategory, input.idempotencyKey, input.clientMetadata],
  );
  if (created) return { record: mapSubmission(created), created: true };
  const existing = await txn.queryOne<SubmissionRow>(
    `SELECT ${columns} FROM fleet_incident_driver_submissions WHERE incident_id = $1::uuid AND staff_id = $2::uuid AND idempotency_key = $3`,
    [input.incidentId, input.staffId, input.idempotencyKey],
  );
  if (!existing) throw new Error('Driver submission insert returned no row and no existing row found');
  return { record: mapSubmission(existing), created: false };
}

export class DuplicateCorrectionLinkError extends Error {
  constructor(message: string) { super(message); this.name = 'DuplicateCorrectionLinkError'; }
}
const UNIQUE_VIOLATION_CODE = '23505';
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION_CODE;
}

export interface InsertAttendanceCorrectionLinkInput { incidentId: string; driverSubmissionId: string | null; attendanceCorrectionId: string; staffId: string; linkedBy: string }
export interface AttendanceCorrectionLinkRecord { id: string; incidentId: string; attendanceCorrectionId: string; staffId: string; linkedAt: string }

/** One link per `(incident_id, attendance_correction_id)`; the migration's UNIQUE constraint is the backstop, translated here into a domain error rather than a raw driver error code. */
export async function insertAttendanceCorrectionLink(
  input: InsertAttendanceCorrectionLinkInput, txn: TxnClient,
): Promise<AttendanceCorrectionLinkRecord> {
  try {
    const created = await txn.queryOne<{ id: string; incident_id: string; attendance_correction_id: string; staff_id: string; linked_at: string | Date }>(
      `INSERT INTO fleet_incident_attendance_correction_links
        (incident_id, driver_submission_id, attendance_correction_id, staff_id, linked_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
       RETURNING id, incident_id, attendance_correction_id, staff_id, linked_at`,
      [input.incidentId, input.driverSubmissionId, input.attendanceCorrectionId, input.staffId, input.linkedBy],
    );
    if (!created) throw new Error('Attendance correction link insert returned no row');
    return {
      id: created.id, incidentId: created.incident_id, attendanceCorrectionId: created.attendance_correction_id,
      staffId: created.staff_id, linkedAt: iso(created.linked_at),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateCorrectionLinkError(`Incident ${input.incidentId} is already linked to correction ${input.attendanceCorrectionId}`);
    }
    throw error;
  }
}
