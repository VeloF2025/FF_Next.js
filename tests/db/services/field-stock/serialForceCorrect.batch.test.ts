/**
 * serialForceCorrect — Batch + transaction isolation tests (specs 7–8)
 *
 * Covers: batch best-effort (applied / no-op / not-found in one call),
 *         per-serial transaction isolation (audit events per serial).
 * Shared fixtures + helpers live in serialForceCorrect.setup.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';
import type { ForceCorrectRowResult } from '@/types/field-stock';
import {
  SN_A,
  SN_B,
  setupFixtures,
  resetFixtures,
  teardownFixtures,
  getAuditRows,
  baseParams,
} from './serialForceCorrect.setup';

describe('forceCorrectSerials — batch + txn isolation', () => {
  beforeAll(setupFixtures);
  beforeEach(resetFixtures);
  afterAll(teardownFixtures);

  // ─── 7. Batch best-effort ───────────────────────────────────────────────────
  it('processes batch of 3 serials: one applied, one no-op, one not-found, zero failed', async () => {
    // SN_A: installed → available (change → applied).
    // SN_B: already available → target available (no-op).
    // NONEXISTENT: not found.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A, SN_B, 'PR9B-FC-NONEXISTENT'],
      target: { status: 'available' },
    }));

    expect(result.totalRequested).toBe(3);
    expect(result.totalApplied).toBe(1);
    expect(result.totalNoOp).toBe(1);
    expect(result.totalFailed).toBe(0);

    const rowA = result.rows.find((r: ForceCorrectRowResult) => r.serialNumber === SN_A)!;
    expect(rowA.applied).toBe(true);
    expect(rowA.changedFields).toEqual(['status']);

    const rowB = result.rows.find((r: ForceCorrectRowResult) => r.serialNumber === SN_B)!;
    expect(rowB.applied).toBe(false);
    expect(rowB.found).toBe(true);
    expect(rowB.changedFields).toHaveLength(0);

    const rowNone = result.rows.find((r: ForceCorrectRowResult) => r.serialNumber === 'PR9B-FC-NONEXISTENT')!;
    expect(rowNone.found).toBe(false);
    expect(rowNone.applied).toBe(false);
  });

  // ─── 8. Per-serial transaction isolation ────────────────────────────────────
  it('writes exactly one audit event for SN_A (changed) and zero for SN_B (no-op)', async () => {
    // SN_A: installed → available. SN_B: already available (no-op).
    await forceCorrectSerials(baseParams({
      serials: [SN_A, SN_B],
      target: { status: 'available' },
    }));

    const eventsA = await getAuditRows(SN_A);
    const eventsB = await getAuditRows(SN_B);

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0].event_type).toBe('force_corrected');

    expect(eventsB).toHaveLength(0);
  });

  // ─── 8b. Mid-batch throw isolation — loop must keep running past errors ─────
  it('continues processing subsequent serials after one throws on UPDATE', async () => {
    // Both serials exist and would normally update fine. We force a DB error by
    // pointing currentLocationId at a UUID that doesn't satisfy the FK to
    // stock_locations. The diff loop will include the field for BOTH serials
    // (both currently NULL), the UPDATE will throw on BOTH, and each serial's
    // own catch block must return an error row independently — proving the
    // outer loop is NOT a single transaction that aborts on first failure.
    const BAD_UUID = '99999999-9999-9999-9999-999999999999';
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A, SN_B],
      target: { currentLocationId: BAD_UUID },
    }));

    // Both serials were attempted and both produced an error row.
    expect(result.totalRequested).toBe(2);
    expect(result.totalApplied).toBe(0);
    expect(result.totalFailed).toBe(2);
    expect(result.rows).toHaveLength(2);

    const rowA = result.rows.find((r: ForceCorrectRowResult) => r.serialNumber === SN_A);
    const rowB = result.rows.find((r: ForceCorrectRowResult) => r.serialNumber === SN_B);
    expect(rowA?.error).toBeDefined();
    expect(rowB?.error).toBeDefined();
    // Error message is sanitised — never leaks raw pg constraint names.
    expect(rowA?.error).not.toMatch(/fkey|constraint|stock_locations/i);
    expect(rowB?.error).not.toMatch(/fkey|constraint|stock_locations/i);

    // Neither serial wrote an audit row (each transaction rolled back).
    expect(await getAuditRows(SN_A)).toHaveLength(0);
    expect(await getAuditRows(SN_B)).toHaveLength(0);
  });
});
