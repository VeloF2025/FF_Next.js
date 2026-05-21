/**
 * Cross-script idempotency gate: A → B → C → D+E twice = true no-op.
 *
 * Runs all four Wave-1 backfill scripts in sequence twice and asserts
 * the second execution inserts/updates zero rows across every script.
 *
 * This verifies the whole pipeline is safe to re-run in production.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillAssetsToSerials } from '../../../scripts/backfill-stock-serials-from-assets';
import { backfillInstallsFromQA } from '../../../scripts/backfill-stock-serials-installed-from-qa';
import { backfillActivationsFromOES } from '../../../scripts/backfill-stock-serials-activated-from-oes';
import { backfillSerialEvents } from '../../../scripts/backfill-stock-serial-events';

const URL = process.env.DATABASE_URL_TEST!;

/**
 * Full reset for cross-script test: undo everything all four scripts may
 * have mutated so the test is order-independent.
 */
async function fullReset(pool: Pool): Promise<void> {
  // Remove event rows for the seed serial.
  await pool.query(`
    DELETE FROM stock_serial_events
    WHERE serial_id = '88888888-8888-8888-8888-888888888888'`);

  // Restore seed serial to its original state.
  await pool.query(`
    UPDATE stock_serials
       SET status = 'issued',
           installed_at_drop_id = NULL,
           activated_at_olt_id  = NULL,
           allocated_to_project_id = NULL,
           updated_at = NOW()
     WHERE serial_number = 'ALCL12345002'`);

  // Remove the stock_serials row that Backfill A inserts for ALCL12345003.
  await pool.query(`
    DELETE FROM stock_serials
    WHERE serial_number = 'ALCL12345003'`);

  // Clean up OES data inserted by test.
  await pool.query(`
    DELETE FROM oes_pp_data WHERE serial_number = 'ALCL12345002'`);

  // Clean up test-inserted return lines + returns (seed has none).
  await pool.query(`
    DELETE FROM stock_return_lines
    WHERE stock_serial_id = '88888888-8888-8888-8888-888888888888'`);
  await pool.query(`
    DELETE FROM stock_returns
    WHERE staff_id = '33333333-3333-3333-3333-333333333333'`);
}

describe('Cross-script idempotency: A → B → C → D+E twice = no-op', () => {
  it('second full pipeline run produces zero inserts/updates', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await fullReset(pool);

      // ── First run ──────────────────────────────────────────────────────────
      // A: assets → stock_serials. fullReset() deleted ALCL12345003's
      // stock_serial row, so first run MUST re-insert it from assets.
      const a1 = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont', 'gizzu'], commit: true });
      expect(a1.inserted).toBeGreaterThanOrEqual(1);

      // B: qa_photo_reviews → installed_at_drop_id.
      // ALCL12345002 is 'issued' — B should mark it installed.
      const b1 = await backfillInstallsFromQA({ pool, commit: true });
      expect(b1.updated).toBeGreaterThanOrEqual(1);

      // Plant OES data so Backfill C has work to do.
      // NOTE: With PR-6 triggers, this INSERT immediately fires the
      // emit_serial_event_on_oes_activate trigger which sets status='activated'.
      // We then reset status back to 'installed' so Backfill C has work to do
      // (testing the backfill script's own logic in isolation from the trigger).
      await pool.query(`
        INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-TEST-01')`);
      await pool.query(`
        UPDATE stock_serials
           SET status='installed', activated_at_olt_id=NULL
         WHERE serial_number='ALCL12345002'`);

      // C: oes_pp_data → activated.
      // Serial is now 'installed' (reset above); C marks it activated.
      const c1 = await backfillActivationsFromOES({ pool, commit: true });
      expect(c1.updated).toBeGreaterThanOrEqual(1);

      // D+E: historical events.
      const de1 = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect((de1.inserted ?? 0)).toBeGreaterThanOrEqual(1);

      // ── Second run — must be a true no-op ──────────────────────────────────
      const a2 = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont', 'gizzu'], commit: true });
      expect(a2.inserted).toBe(0);

      const b2 = await backfillInstallsFromQA({ pool, commit: true });
      expect(b2.updated).toBe(0);

      const c2 = await backfillActivationsFromOES({ pool, commit: true });
      expect(c2.updated).toBe(0);

      const de2 = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect(de2.inserted).toBe(0);
    } finally {
      await fullReset(pool);
      await pool.end();
    }
  });
});
