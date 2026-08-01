import { queryOne, transaction, type SqlRow } from '@/lib/db-pool';
import type { CandidateDecision, ExportState, PreparedCandidate } from './types';
import type { VelocityReviewRun } from './runRepository';

export interface VelocityReviewExport {
  id: string;
  firstRunId: string;
  firstTargetDate: string;
  drNumber: string;
  phoneE164: string;
  phoneFingerprint: string;
  phoneSource: PreparedCandidate['phoneSource'];
  sourceFlags: PreparedCandidate['sources'];
  exportKey: string;
  ghlContactId: string | null;
  state: ExportState;
  attemptCount: number;
  nextAttemptAt: Date | null;
  errorCode: string | null;
  upsertedAt: Date | null;
  triggerRequestedAt: Date | null;
  workflowAcknowledgedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ExportRow extends SqlRow {
  id: string;
  first_run_id: string;
  first_target_date: Date | string;
  dr_number: string;
  phone_e164: string;
  phone_fingerprint: string;
  phone_source: PreparedCandidate['phoneSource'];
  source_flags: PreparedCandidate['sources'];
  export_key: string;
  ghl_contact_id: string | null;
  state: ExportState;
  attempt_count: number;
  next_attempt_at: Date | null;
  error_code: string | null;
  upserted_at: Date | null;
  trigger_requested_at: Date | null;
  workflow_acknowledged_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExportTransitionUpdates {
  ghlContactId?: string | null;
  nextAttemptAt?: Date | null;
  errorCode?: string | null;
  upsertedAt?: Date | null;
  triggerRequestedAt?: Date | null;
  workflowAcknowledgedAt?: Date | null;
  completedAt?: Date | null;
}

export class VelocityReviewRepositoryError extends Error {
  readonly code = 'velocity_review_export_persistence_failed';

  constructor() {
    super('Velocity review export persistence failed');
    this.name = 'VelocityReviewRepositoryError';
  }
}

const EXPORT_COLUMNS = `id, first_run_id, first_target_date, dr_number, phone_e164,
  phone_fingerprint, phone_source, source_flags, export_key, ghl_contact_id, state,
  attempt_count, next_attempt_at, error_code, upserted_at, trigger_requested_at,
  workflow_acknowledged_at, completed_at, created_at, updated_at`;

function mapExport(row: ExportRow): VelocityReviewExport {
  return {
    id: row.id,
    firstRunId: row.first_run_id,
    firstTargetDate: row.first_target_date instanceof Date
      ? row.first_target_date.toISOString().slice(0, 10)
      : row.first_target_date.slice(0, 10),
    drNumber: row.dr_number,
    phoneE164: row.phone_e164,
    phoneFingerprint: row.phone_fingerprint,
    phoneSource: row.phone_source,
    sourceFlags: row.source_flags,
    exportKey: row.export_key,
    ghlContactId: row.ghl_contact_id,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    errorCode: row.error_code,
    upsertedAt: row.upserted_at,
    triggerRequestedAt: row.trigger_requested_at,
    workflowAcknowledgedAt: row.workflow_acknowledged_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveCandidateDecision(
  run: VelocityReviewRun,
  decision: CandidateDecision,
): Promise<void> {
  const ready = decision.status === 'ready' ? decision.candidate : null;
  const drNumber = decision.status === 'ready' ? decision.candidate.drNumber : decision.drNumber;
  const row = await queryOne<{ id: string } & SqlRow>(`
    INSERT INTO velocity_review_candidates
      (run_id, target_date, dr_number, source_flags, decision, quarantine_reason, phone_fingerprint)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (target_date, dr_number) DO UPDATE SET
      run_id = EXCLUDED.run_id,
      source_flags = EXCLUDED.source_flags,
      decision = EXCLUDED.decision,
      quarantine_reason = EXCLUDED.quarantine_reason,
      phone_fingerprint = EXCLUDED.phone_fingerprint,
      updated_at = NOW()
    RETURNING id
  `, [
    run.id,
    run.targetDate,
    drNumber,
    ready?.sources ?? [],
    decision.status,
    decision.status === 'quarantined' ? decision.reason : null,
    ready?.phoneFingerprint ?? null,
  ]);
  if (!row) throw new Error('Velocity review candidate decision could not be persisted');
}

export async function createExport(
  run: VelocityReviewRun,
  candidate: PreparedCandidate,
): Promise<{ created: boolean; export: VelocityReviewExport }> {
  try {
    return await transaction(async (txn) => {
      const inserted = await txn.queryOne<ExportRow>(`
        INSERT INTO velocity_review_exports
          (first_run_id, first_target_date, dr_number, phone_e164, phone_fingerprint,
           phone_source, source_flags, state)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')
        ON CONFLICT (dr_number, phone_fingerprint) DO NOTHING
        RETURNING ${EXPORT_COLUMNS}
      `, [run.id, run.targetDate, candidate.drNumber, candidate.phoneE164,
        candidate.phoneFingerprint, candidate.phoneSource, candidate.sources]);

      const canonical = inserted ?? await txn.queryOne<ExportRow>(`
        SELECT ${EXPORT_COLUMNS} FROM velocity_review_exports
        WHERE dr_number = $1 AND phone_fingerprint = $2
      `, [candidate.drNumber, candidate.phoneFingerprint]);
      if (!canonical) throw new Error('Velocity review export could not be persisted');

      const linked = await txn.query<{ export_id: string } & SqlRow>(`
        UPDATE velocity_review_candidates SET export_id = $3, updated_at = NOW()
        WHERE target_date = $1 AND dr_number = $2
        RETURNING export_id
      `, [run.targetDate, candidate.drNumber, canonical.id]);
      if (!linked[0]) throw new Error('Velocity review candidate export could not be linked');
      return { created: inserted !== null, export: mapExport(canonical) };
    });
  } catch {
    throw new VelocityReviewRepositoryError();
  }
}

export async function claimNextExport(now: Date): Promise<VelocityReviewExport | null> {
  return transaction(async (txn) => {
    const candidate = await txn.queryOne<ExportRow>(`
      SELECT ${EXPORT_COLUMNS} FROM velocity_review_exports e
      WHERE e.state IN ('ready', 'retryable_failure')
        AND (e.state = 'ready' OR e.next_attempt_at <= $1)
        AND NOT EXISTS (
          SELECT 1 FROM velocity_review_exports older
          WHERE older.phone_fingerprint = e.phone_fingerprint
            AND older.state NOT IN ('completed', 'permanent_failure')
            AND (older.created_at, older.id) < (e.created_at, e.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM velocity_review_exports held
          WHERE held.phone_fingerprint = e.phone_fingerprint AND held.id <> e.id
            AND held.state IN ('upserting', 'contact_upserted', 'trigger_requested',
              'retryable_failure', 'ambiguous', 'ack_cleanup_pending')
        )
      ORDER BY e.created_at, e.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `, [now]);
    if (!candidate) return null;

    const claimed = await txn.queryOne<ExportRow>(`
      UPDATE velocity_review_exports
      SET state = 'upserting', attempt_count = attempt_count + 1,
          next_attempt_at = NULL, updated_at = NOW()
      WHERE id = $1 AND state = $2
      RETURNING ${EXPORT_COLUMNS}
    `, [candidate.id, candidate.state]);
    return claimed ? mapExport(claimed) : null;
  });
}

export async function transitionExportState(
  id: string,
  expectedState: ExportState,
  nextState: ExportState,
  updates: ExportTransitionUpdates = {},
): Promise<VelocityReviewExport | null> {
  const optionalFields: Array<[string, unknown]> = [
    ['ghl_contact_id', updates.ghlContactId],
    ['next_attempt_at', updates.nextAttemptAt],
    ['error_code', updates.errorCode],
    ['upserted_at', updates.upsertedAt],
    ['trigger_requested_at', updates.triggerRequestedAt],
    ['workflow_acknowledged_at', updates.workflowAcknowledgedAt],
    ['completed_at', updates.completedAt],
  ];
  const fields = optionalFields.filter((entry) => entry[1] !== undefined);
  const params: unknown[] = [id, expectedState, nextState];
  const assignments = fields.map(([column, value]) => {
    params.push(value);
    return `${column} = $${params.length}`;
  });
  const row = await queryOne<ExportRow>(`
    UPDATE velocity_review_exports
    SET state = $3, ${assignments.length > 0 ? `${assignments.join(', ')},` : ''} updated_at = NOW()
    WHERE id = $1 AND state = $2
    RETURNING ${EXPORT_COLUMNS}
  `, params);
  return row ? mapExport(row) : null;
}
