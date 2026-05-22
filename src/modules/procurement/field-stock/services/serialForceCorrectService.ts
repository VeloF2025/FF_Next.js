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
 * Audit row layout (stock_serial_events):
 *   actor_user_id  ← performedBy (uuid)
 *   from_state     ← old status (only when status changed; else NULL)
 *   to_state       ← new status (only when status changed; else NULL)
 *   payload        ← { isForceCorrect, performedByName, reason, before, after, changedFields }
 *   occurred_at    ← NOW()
 *   source_table / source_id intentionally NULL (bypasses dedupe unique index).
 */
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
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

    // Lock the row so concurrent force-corrects on the same serial serialize.
    const { rows: current } = await client.query<{
      id: string;
      status: string;
      currentLocationId: string | null;
      allocatedToProjectId: string | null;
      installedAtDropNumber: string | null;
      activatedAtOltId: string | null;
    }>(
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

    if (current.length === 0) {
      await client.query('ROLLBACK');
      return { serialNumber, found: false, applied: false, changedFields: [] };
    }

    // Diff: only include fields that are present in target AND differ from current.
    const before: ForceCorrectSnapshot = {};
    const after: ForceCorrectSnapshot = {};
    const changed: (keyof ForceCorrectTarget)[] = [];

    for (const field of TARGET_FIELDS) {
      if (!(field in p.target)) continue;
      const newVal = (p.target[field] as string | null | undefined) ?? null;
      const oldVal = (current[0][field] as string | null | undefined) ?? null;
      if (oldVal !== newVal) {
        (before as Record<string, unknown>)[field] = oldVal;
        (after as Record<string, unknown>)[field] = newVal;
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

    // Apply UPDATE.
    const setParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const field of changed) {
      setParts.push(`${TARGET_COLUMN_MAP[field]} = $${i++}`);
      params.push((p.target[field] as string | null | undefined) ?? null);
    }
    params.push(current[0].id);
    await client.query(
      `UPDATE stock_serials
          SET ${setParts.join(', ')}, updated_at = NOW()
        WHERE id = $${i}`,
      params,
    );

    // Write audit event (source_table + source_id left NULL to bypass dedupe index).
    const statusChanged = changed.includes('status');
    await client.query(
      `INSERT INTO stock_serial_events
         (serial_id, event_type, from_state, to_state,
          actor_user_id, payload, occurred_at)
       VALUES ($1, 'force_corrected', $2, $3, $4::uuid, $5::jsonb, NOW())`,
      [
        current[0].id,
        statusChanged ? (before.status ?? null) : null,
        statusChanged ? (after.status ?? null) : null,
        p.performedBy,
        JSON.stringify({
          isForceCorrect: true,
          performedByName: p.performedByName,
          reason: p.reason,
          before,
          after,
          changedFields: changed,
        }),
      ],
    );

    await client.query('COMMIT');
    return { serialNumber, found: true, applied: true, before, after, changedFields: changed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    log.error('forceCorrectSerials row failed', { serialNumber, err: msg }, 'serialForceCorrect');
    return { serialNumber, found: false, applied: false, changedFields: [], error: msg };
  } finally {
    client.release();
  }
}
