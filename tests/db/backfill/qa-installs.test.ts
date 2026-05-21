import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillInstallsFromQA } from '../../../scripts/backfill-stock-serials-installed-from-qa';

const URL = process.env.DATABASE_URL_TEST!;

/**
 * Reset ALCL12345002 to seed state: status='issued', installed_at_drop_id=NULL.
 * Called at the START of each test's try block AND in each finally — so tests
 * are order-independent and crash-safe.
 */
async function resetSeedSerial(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE stock_serials
        SET status='issued', installed_at_drop_id = NULL, updated_at = NOW()
      WHERE serial_number = 'ALCL12345002'`);
}

describe('Backfill B: qa_photo_reviews → installed_at_drop_id', () => {
  it('marks an issued serial as installed when QA exists', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // seed.sql provides ALCL12345002 (issued) with qa_photo_reviews row for DR0000001.
      const r = await backfillInstallsFromQA({ pool, commit: true });
      expect(r.updated).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('installed');
      expect(s.rows[0].installed_at_drop_id).toBe(
        '44444444-4444-4444-4444-444444444444');
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('does not overwrite an existing installed_at_drop_id', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // Pre-set installed_at_drop_id manually to drop A.
      await pool.query(
        `UPDATE stock_serials SET installed_at_drop_id =
            '44444444-4444-4444-4444-444444444444', status='installed'
         WHERE serial_number = 'ALCL12345002'`);
      // Add a competing QA row pointing at drop B.
      await pool.query(`INSERT INTO drops (id, drop_number)
        VALUES ('55555555-aaaa-aaaa-aaaa-555555555555', 'DR0000099')
        ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO qa_photo_reviews
        (drop_id, drop_number, ont_serial)
        VALUES ('55555555-aaaa-aaaa-aaaa-555555555555', 'DR0000099', 'ALCL12345002')`);
      await backfillInstallsFromQA({ pool, commit: true });
      const s = await pool.query(
        `SELECT installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].installed_at_drop_id).toBe(
        '44444444-4444-4444-4444-444444444444');
    } finally {
      // Cleanup: remove the competing QA row + drop B for downstream tests,
      // and restore the serial to seed state.
      await pool.query(`DELETE FROM qa_photo_reviews WHERE drop_number = 'DR0000099'`);
      await pool.query(`DELETE FROM drops WHERE drop_number = 'DR0000099'`);
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('idempotent — second run zero updates', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await backfillInstallsFromQA({ pool, commit: true });
      const second = await backfillInstallsFromQA({ pool, commit: true });
      expect(second.updated).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('does not downgrade status from activated/faulty', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // Start from seed state, then mark activated.
      await pool.query(
        `UPDATE stock_serials
            SET status='activated', installed_at_drop_id = NULL
          WHERE serial_number = 'ALCL12345002'`);
      await backfillInstallsFromQA({ pool, commit: true });
      const s = await pool.query(
        `SELECT status, installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('activated');                     // not downgraded
      expect(s.rows[0].installed_at_drop_id).toBeNull();              // not set

      // Same for 'faulty'.
      await pool.query(
        `UPDATE stock_serials
            SET status='faulty', installed_at_drop_id = NULL
          WHERE serial_number = 'ALCL12345002'`);
      await backfillInstallsFromQA({ pool, commit: true });
      const s2 = await pool.query(
        `SELECT status, installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s2.rows[0].status).toBe('faulty');
      expect(s2.rows[0].installed_at_drop_id).toBeNull();
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('--dry-run reports wouldUpdate without mutating', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      const r = await backfillInstallsFromQA({ pool, commit: false });
      expect(r.wouldUpdate).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].installed_at_drop_id).toBeNull();
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});
