/**
 * serialForceCorrect — Happy-path tests (specs 1–3)
 *
 * Covers: single-serial apply, dry-run (no DB/audit side-effects), no-op.
 * Shared fixtures + helpers live in serialForceCorrect.setup.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';
import {
  SN_A,
  setupFixtures,
  resetFixtures,
  teardownFixtures,
  getSerial,
  getAuditRows,
  baseParams,
} from './serialForceCorrect.setup';

describe('forceCorrectSerials — happy path', () => {
  beforeAll(setupFixtures);
  beforeEach(resetFixtures);
  afterAll(teardownFixtures);

  // ─── 1. Happy path single serial ───────────────────────────────────────────
  it('applies status change on a single serial (installed → available)', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
    }));

    expect(result.dryRun).toBe(false);
    expect(result.totalRequested).toBe(1);
    expect(result.totalApplied).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(result.totalNoOp).toBe(0);

    const row = result.rows[0];
    expect(row.serialNumber).toBe(SN_A);
    expect(row.found).toBe(true);
    expect(row.applied).toBe(true);
    expect(row.changedFields).toEqual(['status']);
    expect(row.before).toMatchObject({ status: 'installed' });
    expect(row.after).toMatchObject({ status: 'available' });
    expect(row.error).toBeUndefined();

    // DB row reflects the new state.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('available');
  });

  // ─── 2. Dry-run ─────────────────────────────────────────────────────────────
  it('dry-run reports what would change without touching DB or writing audit', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
      dryRun: true,
    }));

    expect(result.dryRun).toBe(true);
    expect(result.totalApplied).toBe(0);
    expect(result.totalFailed).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(true);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toEqual(['status']);
    expect(row.before).toMatchObject({ status: 'installed' });
    expect(row.after).toMatchObject({ status: 'available' });

    // DB unchanged.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('installed');

    // No audit row.
    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(0);
  });

  // ─── 3. No-op ───────────────────────────────────────────────────────────────
  it('returns found=true, applied=false, empty changedFields when target equals current', async () => {
    // SN_A starts as 'installed' — pass the same state.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'installed' },
    }));

    expect(result.totalApplied).toBe(0);
    expect(result.totalNoOp).toBe(1);
    expect(result.totalFailed).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(true);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toHaveLength(0);

    // No audit row.
    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(0);
  });
});
