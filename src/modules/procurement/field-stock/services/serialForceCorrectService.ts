/**
 * Force-correct serial state — bypasses the state machine.
 *
 * Each serial is wrapped in its own pg transaction (best-effort: one failure
 * does NOT roll back the others). Writes one stock_serial_events row per
 * CHANGED serial. No-op serials and not-found serials do NOT write events.
 *
 * Column mapping (live as of 2026-05-22):
 *   ForceCorrectTarget field         stock_serials column
 *   ────────────────────────────────────────────────────
 *   status                           status
 *   currentLocationId                current_location_id
 *   allocatedToProjectId             allocated_to_project_id
 *   installedAtDropNumber            installed_at_drop_number
 *   activatedAtOltId                 activated_at_olt_id
 *
 * AUDIT TABLE — why stock_serial_events (not audit_logs / field_stock_movements):
 *   - `stock_serial_events` is the canonical per-serial event log. Populated by
 *     DB triggers (migration 364) on picking/drops/OES/QA writes, plus direct
 *     writes from `src/lib/serial-events.ts`. The timeline UI reads ONLY this
 *     table (serialTimelineService.ts L103) — so any event written here shows
 *     up in the operator's lifecycle view.
 *   - `audit_logs` (src/services/procurement/auditService.ts) is for business
 *     processes (RFQ approvals, supplier changes, BOQ status changes). Not
 *     per-serial.
 *   - `field_stock_movements` (consumptionService.ts) is a quantity-level
 *     ledger of physical stock moves, not per-serial state.
 *
 * Sprint E Track 2.6 — audit event path:
 *   The status UPDATE is now routed through promoteSerial(bypass:true). The
 *   mig 387 trg_stock_serial_status_emit_t trigger fires on the UPDATE and
 *   writes the `force_corrected` event row, with rich payload supplied via
 *   the ff.event_payload GUC. The former direct emitSerialEvent() call has
 *   been removed — the trigger is now the sole emitter (no double-emit).
 *
 *   Non-status fields (currentLocationId etc.) are written via a separate
 *   UPDATE after promoteSerial(), inside the same transaction.
 *
 *   source_table: '' and sourceId: '' collapse to NULL inside the trigger
 *   (via NULLIF('', '')) — preserving the pre-existing "never dedup" behaviour
 *   for force-correct events (every correction writes a row regardless of
 *   whether the same serial was corrected before).
 *
 * CONNECTION POOL — uses pg.Pool via @/lib/db-pool (NOT the @neondatabase/serverless
 * shim used by sibling serialService.ts). pg.Pool is the canonical pool for new
 * code per project CLAUDE.md "Tech debt — Neon serverless shim" section.
 * Migrating serialService.ts off the shim is out of scope here.
 */
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { promoteSerial, type SerialStatus } from './serialLifecycle';
import type {
  ForceCorrectTarget,
  ForceCorrectSnapshot,
  ForceCorrectRowResult,
  ForceCorrectResult,
} from '@/types/field-stock';

// ============================================================================
// Public API
// ============================================================================

export interface ForceCorrectParams {
  serials: string[];
  target: ForceCorrectTarget;
  reason: string;
  performedBy: string;      // uuid of the user triggering the correction
  performedByName: string;
  dryRun: boolean;
}

// ============================================================================
// Column mapping
// ============================================================================

const TARGET_COLUMN_MAP: Record<keyof ForceCorrectTarget, string> = {
  status: 'status',
  currentLocationId: 'current_location_id',
  allocatedToProjectId: 'allocated_to_project_id',
  installedAtDropNumber: 'installed_at_drop_number',
  activatedAtOltId: 'activated_at_olt_id',
};

const TARGET_FIELDS = Object.keys(TARGET_COLUMN_MAP) as (keyof ForceCorrectTarget)[];

// ============================================================================
// Typed snapshot helpers
// ============================================================================

/**
 * Type-safe indexed write into a ForceCorrectSnapshot.
 * TypeScript cannot narrow the field→value contract through a generic
 * `keyof` loop, but the caller guarantees `value` came from the same key on
 * the same type — so the assertion is correct and replaces the broader
 * `Record<string, unknown>` escape hatch.
 */
function setSnapshotField<K extends keyof ForceCorrectSnapshot>(
  snapshot: ForceCorrectSnapshot,
  field: K,
  value: ForceCorrectSnapshot[K],
): void {
  snapshot[field] = value;
}

// ============================================================================
// Main export
// ============================================================================

export async function forceCorrectSerials(p: ForceCorrectParams): Promise<ForceCorrectResult> {
  const rows: ForceCorrectRowResult[] = [];
  for (const sn of p.serials) {
    rows.push(await processOne(sn, p));
  }
  return {
    dryRun: p.dryRun,
    totalRequested: p.serials.length,
    totalApplied: rows.filter(r => r.applied).length,
    totalFailed: rows.filter(r => Boolean(r.error)).length,
    totalNoOp: rows.filter(r => r.found && !r.error && r.changedFields.length === 0).length,
    rows,
  };
}

// ============================================================================
// Per-serial processing (own transaction)
// ============================================================================

async function processOne(serialNumber: string, p: ForceCorrectParams): Promise<ForceCorrectRowResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // RowShape mirrors the AS-aliased SELECT columns below.
    // status is narrowed to ForceCorrectStatus because the DB CHECK constraint
    // enforces valid values — the cast is safe and correct at the boundary.
    type RowShape = {
      id: string;
    } & Required<ForceCorrectSnapshot>;

    // Lock the row so concurrent force-corrects on the same serial serialize.
    const { rows: current } = await client.query<RowShape>(
      `SELECT id,
              status,
              current_location_id        AS "currentLocationId",
              allocated_to_project_id    AS "allocatedToProjectId",
              installed_at_drop_number   AS "installedAtDropNumber",
              activated_at_olt_id        AS "activatedAtOltId"
         FROM stock_serials
        WHERE serial_number = $1
          FOR UPDATE`,
      [serialNumber],
    );

    const row = current[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { serialNumber, found: false, applied: false, changedFields: [] };
    }

    // Diff: only include fields that are present in target AND differ from current.
    const before: ForceCorrectSnapshot = {};
    const after: ForceCorrectSnapshot = {};
    const changed: (keyof ForceCorrectTarget)[] = [];

    // `row` is typed as RowShape (Required<ForceCorrectSnapshot> + id).
    // setSnapshotField provides the K-bound write that TS cannot infer
    // through a generic keyof loop — no Record<string, unknown> needed.
    const targetKeys: ReadonlyArray<keyof ForceCorrectTarget> = TARGET_FIELDS;
    for (const field of targetKeys) {
      if (!(field in p.target)) continue;
      const newVal = (p.target[field] ?? null) as ForceCorrectSnapshot[typeof field];
      const oldVal = (row[field] ?? null) as ForceCorrectSnapshot[typeof field];
      if (oldVal !== newVal) {
        setSnapshotField(before, field, oldVal);
        setSnapshotField(after, field, newVal);
        changed.push(field);
      }
    }

    if (changed.length === 0) {
      await client.query('ROLLBACK');
      return { serialNumber, found: true, applied: false, changedFields: [] };
    }

    if (p.dryRun) {
      await client.query('ROLLBACK');
      return { serialNumber, found: true, applied: false, before, after, changedFields: changed };
    }

    // ── Sprint E Track 2.6: two-step write ───────────────────────────────────
    //
    // STEP 1 — Status change via promoteSerial(bypass:true).
    //   Routes through the mig 387 lifecycle infrastructure so the
    //   trg_stock_serial_status_emit_t trigger fires and writes a
    //   `force_corrected` stock_serial_events row with full payload context.
    //
    //   bypass:true skips the status-validate trigger (FF001) — required
    //   because force-correct may target ANY of the 11 legacy-CHECK statuses,
    //   including off-matrix transitions.
    //
    //   sourceTable: '' / sourceId: '' → NULLIF('','') = NULL inside the
    //   trigger — preserves the "never dedup" contract: every force-correct
    //   call writes an event row regardless of prior corrections.
    //
    //   PoolClient path is used (caller owns BEGIN/COMMIT; promoteSerial
    //   detects `release` on the object and skips its own txn wrapper).
    //
    // STEP 2 — Non-status fields via a direct bulk UPDATE.
    //   currentLocationId, allocatedToProjectId, installedAtDropNumber,
    //   activatedAtOltId do not affect the status-validate trigger and
    //   are written separately. No duplicate event is emitted for these
    //   (the trigger only fires on status changes — same-column updates
    //   on non-status fields don't invoke trg_stock_serial_status_emit_t).

    const statusChanged = changed.includes('status');
    const nonStatusChanged = changed.filter(f => f !== 'status');

    if (statusChanged) {
      const toStatus = after.status;
      if (toStatus == null) {
        // Should never happen (status is in changed but after.status is null)
        await client.query('ROLLBACK');
        return { serialNumber, found: true, applied: false, changedFields: changed,
          error: 'Internal: status in changedFields but after.status is null' };
      }
      // ForceCorrectStatus includes legacy values (reserved, in_transit, in_repair)
      // not in SerialStatus (9-value mig 387 vocabulary). bypass:true permits any
      // value the DB CHECK accepts — the DB is the enforcement boundary here.
      // The double cast via `unknown` is intentional: we widen to the unknown
      // base type first so TypeScript's soundness check is satisfied, then narrow
      // to SerialStatus. The DB CHECK constraint is the real runtime guard.
      const toStatusAsSerial = toStatus as unknown as SerialStatus;
      await promoteSerial(client, {
        serialId:    row.id,
        toStatus:    toStatusAsSerial,
        // holder_id is not managed by force-correct (no holder column in ForceCorrectTarget)
        sourceTable: '',
        sourceId:    '',
        actorUserId: p.performedBy,
        bypass:      true,
        payload: {
          isForceCorrect:  true,
          performedByName: p.performedByName,
          reason:          p.reason,
          before,
          after,
          changedFields:   changed,
        },
      });
    }

    if (nonStatusChanged.length > 0) {
      const setParts: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const field of nonStatusChanged) {
        setParts.push(`${TARGET_COLUMN_MAP[field]} = $${i++}`);
        params.push(p.target[field] ?? null);
      }
      params.push(row.id);
      await client.query(
        `UPDATE stock_serials
            SET ${setParts.join(', ')}, updated_at = NOW()
          WHERE id = $${i}`,
        params,
      );
    }

    await client.query('COMMIT');
    return { serialNumber, found: true, applied: true, before, after, changedFields: changed };
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr: unknown) => {
      log.warn('forceCorrectSerials ROLLBACK failed', { serialNumber, rbErr }, 'serialForceCorrect');
    });
    const fullMsg = err instanceof Error ? err.message : String(err);
    log.error('forceCorrectSerials row failed', { serialNumber, err: fullMsg }, 'serialForceCorrect');
    return { serialNumber, found: false, applied: false, changedFields: [], error: sanitiseDbError(fullMsg) };
  } finally {
    client.release();
  }
}

// ============================================================================
// Error sanitisation
// ============================================================================

/**
 * Return a generic message to the API caller instead of raw pg errors,
 * which can leak table/constraint/column names. Full error is logged above.
 */
function sanitiseDbError(_fullMsg: string): string {
  return 'Database error processing serial; check server logs for details.';
}
