import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillActivationsFromOES } from '../../../scripts/backfill-stock-serials-activated-from-oes';

const URL = process.env.DATABASE_URL_TEST!;

async function resetSeedSerial(pool: Pool) {
  // ALCL12345002 lives in the seed as status='issued', no installed/activated/olt.
  await pool.query(
    `UPDATE stock_serials
        SET status='issued',
            installed_at_drop_id = NULL,
            activated_at_olt_id  = NULL,
            updated_at = NOW()
      WHERE serial_number = 'ALCL12345002'`);
  await pool.query(`DELETE FROM oes_pp_data WHERE serial_number = 'ALCL12345002'`);
  // PR-6 triggers emit stock_serial_events on every oes_pp_data INSERT.
  // Wipe those so tests don't see stale events from prior tests
  // (code-quality reviewer Important #2).
  await pool.query(`
    DELETE FROM stock_serial_events
    WHERE serial_id IN (
      SELECT id FROM stock_serials WHERE serial_number = 'ALCL12345002')`);
}

describe('Backfill C: oes_pp_data → status=activated', () => {
  it('marks an installed serial as activated and captures the OLT', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // First put the serial in 'installed' state, then drop in an OES row.
      await pool.query(
        `UPDATE stock_serials
            SET status='installed',
                installed_at_drop_id = '44444444-4444-4444-4444-444444444444'
          WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'activated')`);
      // NOTE: With PR-6 triggers installed, the INSERT above fires
      // emit_serial_event_on_oes_activate which already sets status='activated'.
      // Reset the serial back to 'installed' so the backfill script itself has
      // work to do (tests backfill logic in isolation).
      await pool.query(
        `UPDATE stock_serials
            SET status='installed', activated_at_olt_id=NULL
          WHERE serial_number='ALCL12345002'`);
      const r = await backfillActivationsFromOES({ pool, commit: true });
      expect(r.updated).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('activated');
      expect(s.rows[0].activated_at_olt_id).toBe('OLT-CT-01');
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('does not downgrade a faulty serial', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(
        `UPDATE stock_serials SET status='faulty'
         WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'activated')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('faulty');
      expect(s.rows[0].activated_at_olt_id).toBeNull();
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('does not downgrade a scrapped serial', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(
        `UPDATE stock_serials SET status='scrapped'
         WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'activated')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('scrapped');
      expect(s.rows[0].activated_at_olt_id).toBeNull();
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('latest OES row wins (DISTINCT ON ordering)', async () => {
    // Prod schema correction (PR-7): oes_pp_data has no `activated_at` column.
    // Ordering uses `created_at`. Insert rows with explicit created_at values
    // so the DISTINCT ON ordering is deterministic.
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(`INSERT INTO oes_pp_data
        (serial_number, olt_name, created_at, resolution_status) VALUES
        ('ALCL12345002', 'OLT-OLD', '2025-01-01T00:00:00Z', 'activated'),
        ('ALCL12345002', 'OLT-NEW', '2026-05-01T00:00:00Z', 'activated')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('activated');
      expect(s.rows[0].activated_at_olt_id).toBe('OLT-NEW');
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('idempotent — second run zero updates', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'activated')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const second = await backfillActivationsFromOES({ pool, commit: true });
      expect(second.updated).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('--dry-run reports wouldUpdate without mutating', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'activated')`);
      // NOTE: PR-6 trigger fires on INSERT and sets status='activated'.
      // Reset back to 'issued' so the backfill dry-run has work to report
      // and the status check below reflects the dry-run invariant (no mutation).
      await pool.query(
        `UPDATE stock_serials
            SET status='issued', activated_at_olt_id=NULL
          WHERE serial_number='ALCL12345002'`);
      const r = await backfillActivationsFromOES({ pool, commit: false });
      expect(r.wouldUpdate).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('issued');                   // unchanged by dry-run
      expect(s.rows[0].activated_at_olt_id).toBeNull();          // unchanged by dry-run
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('HOTFIX: oes_pp_data row with resolution_status!=activated is excluded', async () => {
    // Regression guard for PR-7 blind-review finding: the original selectCandidates
    // CTE had no resolution_status filter, which would falsely promote ~807 stock_serials
    // to 'activated' in prod (not_found / located_* rows matched ALLOWED_FROM states).
    //
    // The Trigger 3 (trg_emit_serial_event_on_oes_activate) fires on every
    // oes_pp_data INSERT regardless of resolution_status — it is the live-ingest
    // trigger, not a validation layer. We reset the serial back to 'issued' after
    // the trigger fires so we can isolate the *backfill script's* resolution_status
    // filtering logic.
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // Serial starts at seed status 'issued' (ALLOWED_FROM state).
      await pool.query(`
        INSERT INTO oes_pp_data (serial_number, olt_name, resolution_status)
        VALUES ('ALCL12345002', 'OLT-CT-01', 'not_found')`);

      // Trigger 3 may have set the serial to 'activated' — reset to 'issued'
      // so the backfill has a candidate to promote *if* it incorrectly includes
      // the not_found row.
      await pool.query(
        `UPDATE stock_serials
            SET status='issued', activated_at_olt_id=NULL
          WHERE serial_number='ALCL12345002'`);

      const r = await backfillActivationsFromOES({ pool, commit: true });
      expect(r.updated).toBe(0);  // backfill must exclude not_found rows

      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('issued');  // backfill left it unchanged
      expect(s.rows[0].activated_at_olt_id).toBeNull();
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  // NOTE: 'faulty', 'in_repair', and 'scrapped' are terminal — the backfill never
  // touches them. 'activated' is included in ALLOWED_FROM but is guarded by the
  // IS DISTINCT FROM check so a second run with the same OLT data is always zero-update.
});
