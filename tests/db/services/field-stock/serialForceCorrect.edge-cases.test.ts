/**
 * serialForceCorrect — Edge-case tests (specs 4–6)
 *
 * Covers: not-found serial, multi-field + null clear, audit row payload shape.
 * Shared fixtures + helpers live in serialForceCorrect.setup.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';
import {
  SN_A,
  TEST_USER_ID,
  PERFORMED_BY_NAME,
  setupFixtures,
  resetFixtures,
  teardownFixtures,
  getSerial,
  getAuditRows,
  baseParams,
} from './serialForceCorrect.setup';

describe('forceCorrectSerials — edge cases', () => {
  beforeAll(setupFixtures);
  beforeEach(resetFixtures);
  afterAll(teardownFixtures);

  // ─── 4. Not-found ───────────────────────────────────────────────────────────
  it('marks not-found serial as found=false, applied=false — not a failure', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: ['PR9B-FC-NONEXISTENT'],
      target: { status: 'available' },
    }));

    expect(result.totalRequested).toBe(1);
    expect(result.totalApplied).toBe(0);
    expect(result.totalFailed).toBe(0);   // NOT a failure; it's simply not found
    expect(result.totalNoOp).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(false);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toHaveLength(0);
    expect(row.error).toBeUndefined();
  });

  // ─── 5. Multi-field + null clear ────────────────────────────────────────────
  it('applies status + installedAtDropNumber=null atomically; DB reflects both', async () => {
    // SN_A starts: status='installed', installed_at_drop_number='PR9B-DR-001'.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available', installedAtDropNumber: null },
    }));

    expect(result.totalApplied).toBe(1);

    const row = result.rows[0];
    expect(row.applied).toBe(true);
    expect(row.changedFields).toContain('status');
    expect(row.changedFields).toContain('installedAtDropNumber');
    expect(row.changedFields).toHaveLength(2);

    expect(row.before).toMatchObject({
      status: 'installed',
      installedAtDropNumber: 'PR9B-DR-001',
    });
    expect(row.after).toMatchObject({
      status: 'available',
      installedAtDropNumber: null,
    });

    // DB updated atomically.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('available');
    expect(db?.installed_at_drop_number).toBeNull();
  });

  // ─── 6. Audit row payload shape ──────────────────────────────────────────────
  it('writes a correctly shaped audit row to stock_serial_events', async () => {
    await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
      reason: 'audit-shape test',
      performedBy: TEST_USER_ID,
      performedByName: PERFORMED_BY_NAME,
    }));

    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(1);

    const evt = events[0];
    expect(evt.event_type).toBe('force_corrected');
    expect(evt.from_state).toBe('installed');   // status changed
    expect(evt.to_state).toBe('available');
    expect(evt.actor_user_id).toBe(TEST_USER_ID);

    expect(evt.payload).toMatchObject({
      isForceCorrect: true,
      reason: 'audit-shape test',
      performedByName: PERFORMED_BY_NAME,
      before: { status: 'installed' },
      after: { status: 'available' },
      changedFields: ['status'],
    });
  });
});
