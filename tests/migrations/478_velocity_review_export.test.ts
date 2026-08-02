import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const SCHEMA = 'mig478_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/478_velocity_review_export.sql'),
  'utf8'
);
const ROLLBACK = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/rollback_478_velocity_review_export.sql'),
  'utf8'
);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: false,
  max: 2,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    return await client.query<T>(text, values);
  } finally {
    client.release();
  }
}

const prerequisites = `
  CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE wa_subscriber_consent (
    id BIGSERIAL PRIMARY KEY,
    msisdn TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn')),
    source TEXT NOT NULL,
    granted_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wa_subscriber_consent_source_chk
      CHECK (source IN ('fno_payload', 'ops_manual', 'subscriber_block', 'inbound_stop', 'import'))
  );
`;

const runId = '11111111-1111-4111-8111-111111111111';
const secondRunId = '22222222-2222-4222-8222-222222222222';

async function insertExport(input: {
  id: string;
  runId?: string;
  targetDate?: string;
  dr: string;
  phone: string;
  fingerprint: string;
  state: string;
}): Promise<void> {
  await scoped(
    `INSERT INTO velocity_review_exports
       (id, first_run_id, first_target_date, dr_number, phone_e164,
        phone_fingerprint, phone_source, source_flags, state)
     VALUES ($1, $2, $3, $4, $5, $6, 'onemap', ARRAY['dr_submitted'], $7)`,
    [
      input.id,
      input.runId ?? runId,
      input.targetDate ?? '2026-07-31',
      input.dr,
      input.phone,
      input.fingerprint,
      input.state,
    ]
  );
}

dbDescribe('migration 478 applied to a scratch schema', () => {
  beforeAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await scoped(prerequisites);
    await scoped(FORWARD);
    await scoped(FORWARD);
    await scoped(
      `INSERT INTO velocity_review_runs (id, target_date, status)
       VALUES ($1, DATE '2026-07-31', 'pending'),
              ($2, DATE '2026-08-01', 'pending')`,
      [runId, secondRunId]
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const leaked = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pg_namespace WHERE nspname = $1`,
      [SCHEMA]
    );
    expect(leaked.rows[0].n).toBe(0);
    await pool.end();
  }, 60_000);

  it('is idempotent and installs every ledger, check, and durable index', async () => {
    const tables = await scoped<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = $1 AND tablename LIKE 'velocity_review_%'
       ORDER BY tablename`,
      [SCHEMA]
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'velocity_review_candidates',
      'velocity_review_control',
      'velocity_review_exports',
      'velocity_review_runs',
    ]);

    const checks = await scoped<{ table_name: string; definition: string }>(
      `SELECT c.conrelid::regclass::text AS table_name,
              pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       WHERE c.contype = 'c' AND c.conrelid IN (
         'velocity_review_control'::regclass, 'velocity_review_runs'::regclass,
         'velocity_review_candidates'::regclass, 'velocity_review_exports'::regclass
       )`
    );
    expect(checks.rows.filter((row) => row.table_name.endsWith('velocity_review_control'))).toHaveLength(4);
    expect(checks.rows.filter((row) => row.table_name.endsWith('velocity_review_runs'))).toHaveLength(2);
    expect(checks.rows.filter((row) => row.table_name.endsWith('velocity_review_candidates'))).toHaveLength(4);
    expect(checks.rows.filter((row) => row.table_name.endsWith('velocity_review_exports'))).toHaveLength(6);

    const indexes = await scoped<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename LIKE 'velocity_review_%'`,
      [SCHEMA]
    );
    const byName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get('ux_velocity_review_one_phone_inflight')).toMatch(
      /retryable_failure.*ambiguous.*ack_cleanup_pending/
    );
    expect(byName.get('velocity_review_exports_dr_number_phone_e164_key')).toContain(
      '(dr_number, phone_e164)'
    );

    const tracker = await scoped<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM schema_migrations WHERE filename = $1`,
      ['478_velocity_review_export.sql']
    );
    expect(tracker.rows[0].n).toBe(1);
  });

  it('adds both OneMap consent evidence sources', async () => {
    await scoped(
      `INSERT INTO wa_subscriber_consent (msisdn, status, source, granted_at)
       VALUES ('27820000001', 'granted', $1, NOW()),
              ('27820000002', 'granted', $2, NOW())`,
      ['onemap_home_signup', 'onemap_install_signature']
    );
    const sources = await scoped<{ source: string }>(
      `SELECT source FROM wa_subscriber_consent ORDER BY source`
    );
    expect(sources.rows.map((row) => row.source)).toEqual([
      'onemap_home_signup',
      'onemap_install_signature',
    ]);
  });

  it('defaults disabled and rejects unsafe automation or pilot controls', async () => {
    const control = await scoped<{
      automation_enabled: boolean;
      pilot_enabled: boolean;
      pilot_limit: number | null;
    }>(`SELECT automation_enabled, pilot_enabled, pilot_limit FROM velocity_review_control`);
    expect(control.rows[0]).toEqual({
      automation_enabled: false,
      pilot_enabled: false,
      pilot_limit: null,
    });
    await expect(
      scoped(`UPDATE velocity_review_control SET automation_enabled = TRUE`)
    ).rejects.toThrow(/velocity_review_control_check/);
    await expect(
      scoped(`UPDATE velocity_review_control SET pilot_enabled = TRUE`)
    ).rejects.toThrow(/velocity_review_control_check/);
    await expect(
      scoped(`UPDATE velocity_review_control SET pilot_limit = 51`)
    ).rejects.toThrow(/velocity_review_control_pilot_limit_check/);
  });

  it('rejects duplicate candidates and permanent DR/phone exports', async () => {
    const fingerprint = 'a'.repeat(64);
    await scoped(
      `INSERT INTO velocity_review_candidates
         (run_id, target_date, dr_number, source_flags, decision, phone_fingerprint)
       VALUES ($1, DATE '2026-07-31', 'DR-CANDIDATE', ARRAY['dr_submitted'], 'ready', $2)`,
      [runId, fingerprint]
    );
    await expect(
      scoped(
        `INSERT INTO velocity_review_candidates
           (run_id, target_date, dr_number, source_flags, decision)
         VALUES ($1, DATE '2026-07-31', 'DR-CANDIDATE', ARRAY['drops_installed'], 'quarantined')`,
        [runId]
      )
    ).rejects.toThrow(/velocity_review_candidates_target_date_dr_number_key/);

    await insertExport({
      id: '31111111-1111-4111-8111-111111111111',
      dr: 'DR-PERMANENT', phone: '+27610000001', fingerprint, state: 'ready',
    });
    await expect(insertExport({
      id: '32222222-2222-4222-8222-222222222222',
      dr: 'DR-PERMANENT', phone: '+27610000001', fingerprint: 'f'.repeat(64), state: 'ready',
    })).rejects.toThrow(/velocity_review_exports_dr_number_phone_e164_key/);
  });

  it.each(['dr-lowercase', ' DR-PADDED ', ''])(
    'rejects noncanonical candidate DR %j',
    async (dr) => {
      await expect(
        scoped(
          `INSERT INTO velocity_review_candidates
             (run_id, target_date, dr_number, source_flags, decision)
           VALUES ($1, DATE '2026-08-01', $2, ARRAY['dr_submitted'], 'ready')`,
          [secondRunId, dr]
        )
      ).rejects.toThrow(/velocity_review_candidates_dr_number_canonical_chk/);
    }
  );

  it.each([
    ['dr-lowercase', '61111111-1111-4111-8111-111111111111', '+27610000004', 'd'],
    [' DR-PADDED ', '62222222-2222-4222-8222-222222222222', '+27610000005', 'e'],
    ['', '63333333-3333-4333-8333-333333333333', '+27610000006', 'f'],
  ])('rejects noncanonical export DR %j', async (dr, id, phone, fingerprintChar) => {
    await expect(insertExport({
      id,
      runId: secondRunId,
      targetDate: '2026-08-01',
      dr,
      phone,
      fingerprint: fingerprintChar.repeat(64),
      state: 'ready',
    })).rejects.toThrow(/velocity_review_exports_dr_number_canonical_chk/);
  });

  it('locks retryable and ambiguous claimed handshakes per phone', async () => {
    const fingerprint = 'b'.repeat(64);
    await insertExport({
      id: '41111111-1111-4111-8111-111111111111',
      dr: 'DR-RETRY', phone: '+27610000002', fingerprint, state: 'retryable_failure',
    });
    await expect(insertExport({
      id: '42222222-2222-4222-8222-222222222222',
      runId: secondRunId, targetDate: '2026-08-01', dr: 'DR-AMBIGUOUS',
      phone: '+27610000002', fingerprint: 'e'.repeat(64), state: 'ambiguous',
    })).rejects.toThrow(/ux_velocity_review_one_phone_inflight/);
  });

  it('allows another DR on a phone after the first handshake completes', async () => {
    const fingerprint = 'c'.repeat(64);
    await insertExport({
      id: '51111111-1111-4111-8111-111111111111',
      dr: 'DR-COMPLETE', phone: '+27610000003', fingerprint, state: 'completed',
    });
    await expect(insertExport({
      id: '52222222-2222-4222-8222-222222222222',
      runId: secondRunId, targetDate: '2026-08-01', dr: 'DR-NEXT',
      phone: '+27610000003', fingerprint: 'd'.repeat(64), state: 'ambiguous',
    })).resolves.toBeUndefined();
  });

  it('rolls back inside the runner transaction without changing consent history', async () => {
    const timestamps = {
      withdrawnAt: '2026-07-30T08:00:00.000Z',
      createdAt: '2026-07-29T07:00:00.000Z',
      updatedAt: '2026-07-30T08:00:00.000Z',
    };
    await scoped(
      `INSERT INTO wa_subscriber_consent
         (msisdn, status, source, withdrawn_at, created_at, updated_at)
       VALUES ($1, 'withdrawn', 'onemap_home_signup', $2, $3, $4)`,
      ['27820000003', timestamps.withdrawnAt, timestamps.createdAt, timestamps.updatedAt]
    );

    const client = await pool.connect();
    try {
      await client.query(`SET search_path = ${SCHEMA}, public`);
      await client.query('BEGIN');
      await client.query(ROLLBACK);

      const consent = await client.query<{
        status: string;
        source: string;
        withdrawn_at: Date;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT status, source, withdrawn_at, created_at, updated_at
         FROM wa_subscriber_consent WHERE msisdn = $1`,
        ['27820000003']
      );
      // Provenance survives: the rollback must not collapse which consent event
      // was captured. 'onemap_home_signup' and 'onemap_install_signature' are
      // separately captured POPIA evidence, and rewriting them is irreversible.
      expect(consent.rows[0]).toMatchObject({
        status: 'withdrawn',
        source: 'onemap_home_signup',
      });
      expect(consent.rows[0].withdrawn_at.toISOString()).toBe(timestamps.withdrawnAt);
      expect(consent.rows[0].created_at.toISOString()).toBe(timestamps.createdAt);
      expect(consent.rows[0].updated_at.toISOString()).toBe(timestamps.updatedAt);

      const rollbackState = await client.query<{
        control_table: string | null;
        tracker_count: number;
      }>(
        `SELECT to_regclass('velocity_review_control')::text AS control_table,
                (SELECT COUNT(*)::int FROM schema_migrations
                 WHERE filename = '478_velocity_review_export.sql') AS tracker_count`
      );
      expect(rollbackState.rows[0]).toEqual({ control_table: null, tracker_count: 0 });

      await client.query('ROLLBACK');
      const restored = await client.query<{
        control_table: string | null;
        tracker_count: number;
        source: string;
        status: string;
      }>(
        `SELECT to_regclass('velocity_review_control')::text AS control_table,
                (SELECT COUNT(*)::int FROM schema_migrations
                 WHERE filename = '478_velocity_review_export.sql') AS tracker_count,
                source, status
         FROM wa_subscriber_consent WHERE msisdn = $1`,
        ['27820000003']
      );
      expect(restored.rows[0]).toMatchObject({
        tracker_count: 1,
        source: 'onemap_home_signup',
        status: 'withdrawn',
      });
      expect(restored.rows[0].control_table).toContain('velocity_review_control');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('is re-runnable and safe on a schema where the migration never applied', async () => {
    // Every statement must be guarded. A bare UPDATE on the ledger errors the
    // whole file on a database that never applied 478 — an operator running the
    // rollback by mistake gets a hard failure instead of a no-op — and breaks
    // re-running it after a partially completed teardown.
    const client = await pool.connect();
    const bare = `${SCHEMA}_bare`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA ${bare}`);
      await client.query(`SET search_path = ${bare}`);
      await client.query(
        `CREATE TABLE schema_migrations (
           filename TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`
      );
      // Never applied: none of the velocity tables exist here.
      await expect(client.query(ROLLBACK)).resolves.toBeDefined();
      // And again — re-runnable.
      await expect(client.query(ROLLBACK)).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('survives a rollback and re-apply without re-contacting anyone', async () => {
    // The safety property: rolling back and re-applying must not make an
    // already-contacted customer eligible again. That holds only because the
    // rollback keeps velocity_review_exports; a DROP here would silently reopen
    // every past contact for a second message.
    const fingerprint = 'd'.repeat(64);
    await insertExport({
      id: '4d111111-1111-4111-8111-111111111111',
      dr: 'DR-CYCLE',
      phone: '+27670000009',
      fingerprint,
      state: 'completed',
    });
    // An in-flight row too: it holds the partial unique index, and nothing will
    // exist to advance it once the code is gone.
    await insertExport({
      id: '4d222222-2222-4222-8222-222222222222',
      dr: 'DR-CYCLE-INFLIGHT',
      phone: '+27670000010',
      fingerprint,
      state: 'trigger_requested',
    });

    const client = await pool.connect();
    try {
      await client.query(`SET search_path = ${SCHEMA}, public`);
      await client.query('BEGIN');
      await client.query(ROLLBACK);

      const ledger = await client.query<{ dr_number: string; state: string; error_code: string | null }>(
        `SELECT dr_number, state, error_code FROM velocity_review_exports
         WHERE dr_number LIKE 'DR-CYCLE%' ORDER BY dr_number`
      );
      // Ledger survived the rollback.
      expect(ledger.rows.map((r) => r.dr_number)).toEqual(['DR-CYCLE', 'DR-CYCLE-INFLIGHT']);
      // The completed row is untouched; the in-flight row is parked terminally so
      // it cannot hold ux_velocity_review_one_phone_inflight forever.
      expect(ledger.rows[0]).toMatchObject({ state: 'completed', error_code: null });
      expect(ledger.rows[1]).toMatchObject({
        state: 'permanent_failure',
        error_code: 'migration_rolled_back',
      });

      // Re-apply over the surviving schema.
      await client.query(FORWARD);

      // Control comes back disabled — it was dropped, so a re-apply cannot
      // resume whatever an operator had last enabled.
      const control = await client.query<{ automation_enabled: boolean; pilot_enabled: boolean }>(
        `SELECT automation_enabled, pilot_enabled FROM velocity_review_control`
      );
      expect(control.rows[0]).toEqual({ automation_enabled: false, pilot_enabled: false });

      // The permanent guarantee still bites: the same DR/phone pair cannot be
      // re-inserted, so that customer cannot be contacted a second time.
      await expect(
        client.query(
          `INSERT INTO velocity_review_exports
             (id, first_run_id, first_target_date, dr_number, phone_e164,
              phone_fingerprint, phone_source, source_flags, state)
           VALUES ($1, $2, DATE '2026-08-05', 'DR-CYCLE', '+27670000009',
                   $3, 'onemap', ARRAY['dr_submitted'], 'ready')`,
          ['4d333333-3333-4333-8333-333333333333', runId, fingerprint]
        )
      ).rejects.toThrow(/dr_number_phone_e164/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
