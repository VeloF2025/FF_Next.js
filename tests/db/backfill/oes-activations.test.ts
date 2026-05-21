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
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
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
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
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
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('scrapped');
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('latest OES row wins (DISTINCT ON ordering)', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await pool.query(`INSERT INTO oes_pp_data
        (serial_number, olt_name, activated_at) VALUES
        ('ALCL12345002', 'OLT-OLD', '2025-01-01T00:00:00Z'),
        ('ALCL12345002', 'OLT-NEW', '2026-05-01T00:00:00Z')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
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
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
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
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_name)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
      const r = await backfillActivationsFromOES({ pool, commit: false });
      expect(r.wouldUpdate).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('issued');                   // unchanged
      expect(s.rows[0].activated_at_olt_id).toBeNull();          // unchanged
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  // NOTE: 'faulty', 'in_repair', and 'scrapped' are terminal — the backfill never
  // touches them. 'activated' is included in ALLOWED_FROM but is guarded by the
  // IS DISTINCT FROM check so a second run with the same OLT data is always zero-update.
});
