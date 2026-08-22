import { query, transaction } from '@/lib/db-pool';
import type {
  DecisionProvenance,
  InferenceDecision,
  InferenceResult,
} from './types';

/**
 * The two halves of a proposal, written through two deliberately separate
 * functions against two deliberately separate tables (migration 522).
 *
 * `saveEvidence` is the machine's write. Its statement names only evidence
 * columns because the table it targets has no others - a recompute cannot
 * overwrite a human decision because there is no column on that table for the
 * decision to live in. That is the guard; the comment is only the explanation.
 */

export interface InferenceWindow {
  start: Date;
  end: Date;
}

export interface DecisionInput {
  decision: InferenceDecision;
  decidedProjectId: string | null;
  decidedFrom: DecisionProvenance | null;
  evidenceComputedAt: Date | null;
  note: string | null;
  /**
   * The `decisionRevision` the caller read, or null if they read no decision at
   * all. The write is conditional on it, so two people deciding the same
   * vehicle cannot silently overwrite each other - the second one is told.
   */
  expectedRevision: number | null;
}

export class InferenceDecisionError extends Error {
  constructor(
    public readonly code: 'invalid_decision' | 'unknown_vehicle' | 'unknown_project'
      | 'already_applied' | 'stale_decision',
    message: string,
  ) {
    super(message);
    this.name = 'InferenceDecisionError';
  }
}

const EVIDENCE_UPSERT = `
  INSERT INTO fleet_site_inference_evidence (
    vehicle_id, outcome, inferred_project_id, dominant_share, pings, dwell_seconds,
    distinct_days, total_positions, window_start, window_end, breakdown, computed_at
  ) VALUES ($1::uuid, $2, $3::uuid, $4::numeric, $5::numeric, $6::numeric,
            $7::int, $8::int, $9::timestamptz, $10::timestamptz, $11::jsonb, now())
  ON CONFLICT (vehicle_id) DO UPDATE SET
    outcome = EXCLUDED.outcome,
    inferred_project_id = EXCLUDED.inferred_project_id,
    dominant_share = EXCLUDED.dominant_share,
    pings = EXCLUDED.pings,
    dwell_seconds = EXCLUDED.dwell_seconds,
    distinct_days = EXCLUDED.distinct_days,
    total_positions = EXCLUDED.total_positions,
    window_start = EXCLUDED.window_start,
    window_end = EXCLUDED.window_end,
    breakdown = EXCLUDED.breakdown,
    computed_at = EXCLUDED.computed_at`;

/** Machine write. Replaces evidence for every vehicle in one transaction. */
export async function saveEvidence(
  results: InferenceResult[],
  window: InferenceWindow,
): Promise<number> {
  if (results.length === 0) return 0;
  return transaction(async (txn) => {
    for (const result of results) {
      await txn.query(EVIDENCE_UPSERT, [
        result.vehicleId,
        result.outcome,
        result.inferredProjectId,
        result.dominantShare,
        result.pings,
        result.dwellSeconds,
        result.distinctDays,
        result.totalPositions,
        window.start.toISOString(),
        window.end.toISOString(),
        JSON.stringify(result.breakdown),
      ]);
    }
    return results.length;
  });
}

/**
 * Human write. Every call re-stamps decided_by/decided_at, which is also what
 * the migration's BEFORE UPDATE trigger insists on for any change to what was
 * decided.
 */
export async function recordDecision(
  vehicleId: string,
  input: DecisionInput,
  actorUserId: string,
): Promise<void> {
  assertDecisionShape(input);
  const written = await query(`
    INSERT INTO fleet_site_inference_decisions (
      vehicle_id, decision, decided_project_id, decided_from, evidence_computed_at,
      note, decided_by, decided_at, revision
    ) VALUES ($1::uuid, $2, $3::uuid, $4, $5::timestamptz, $6, $7::uuid, now(), 1)
    ON CONFLICT (vehicle_id) DO UPDATE SET
      decision = EXCLUDED.decision,
      decided_project_id = EXCLUDED.decided_project_id,
      decided_from = EXCLUDED.decided_from,
      evidence_computed_at = EXCLUDED.evidence_computed_at,
      note = EXCLUDED.note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      revision = fleet_site_inference_decisions.revision + 1
    -- Two preconditions on one statement, both about not destroying something
    -- silently:
    --   applied_assignment_id IS NULL - changing a decision that already
    --     reached the roster would leave the assignment behind with nothing
    --     pointing at it. The revert path exists; this makes taking it
    --     mandatory rather than optional.
    --   revision = $8 - compare-and-set against the row the caller actually
    --     read. When $8 is NULL this is NULL, which is not true, so a caller
    --     who believed there was no decision is refused rather than allowed to
    --     overwrite one that appeared in between.
    WHERE fleet_site_inference_decisions.applied_assignment_id IS NULL
      AND fleet_site_inference_decisions.revision = $8
    RETURNING vehicle_id`, [
    vehicleId,
    input.decision,
    input.decidedProjectId,
    input.decidedFrom,
    input.evidenceComputedAt?.toISOString() ?? null,
    input.note,
    actorUserId,
    input.expectedRevision,
  ]);
  if (written.length === 0) await explainRefusal(vehicleId);
}

/**
 * Zero rows means one of two preconditions failed. Re-read to say which, so the
 * caller gets an instruction rather than "something went wrong".
 */
async function explainRefusal(vehicleId: string): Promise<never> {
  const rows = await query<{ applied_assignment_id: string | null }>(`
    SELECT applied_assignment_id
    FROM fleet_site_inference_decisions
    WHERE vehicle_id = $1::uuid`, [vehicleId]);
  if (rows[0]?.applied_assignment_id) {
    throw new InferenceDecisionError(
      'already_applied',
      'That proposal has been applied to the roster; revert the application before changing it',
    );
  }
  throw new InferenceDecisionError(
    'stale_decision',
    'Someone else changed this decision while you were looking at it; reload and decide again',
  );
}

function assertDecisionShape(input: DecisionInput): void {
  const assigned = input.decision === 'assigned';
  if (assigned !== (input.decidedProjectId !== null)) {
    throw new InferenceDecisionError(
      'invalid_decision',
      'A project is required for an assigned decision and forbidden otherwise',
    );
  }
  if (assigned !== (input.decidedFrom !== null)) {
    throw new InferenceDecisionError(
      'invalid_decision',
      'decidedFrom is required for an assigned decision and forbidden otherwise',
    );
  }
}

/** Records that an accepted decision reached the roster. Reversible via clearApplied. */
export async function markApplied(
  vehicleId: string,
  assignmentId: string,
  actorUserId: string,
): Promise<void> {
  await query(`
    UPDATE fleet_site_inference_decisions
    SET applied_assignment_id = $2::uuid, applied_at = now(), applied_by = $3::uuid
    WHERE vehicle_id = $1::uuid AND decision = 'assigned'`, [vehicleId, assignmentId, actorUserId]);
}

/** Undoes markApplied. The assignment itself is ended through the roster service. */
export async function clearApplied(vehicleId: string): Promise<void> {
  await query(`
    UPDATE fleet_site_inference_decisions
    SET applied_assignment_id = NULL, applied_at = NULL, applied_by = NULL
    WHERE vehicle_id = $1::uuid`, [vehicleId]);
}
