/**
 * Integration test for migration 479 — backfill NOC ticket GPS from the OES report.
 *
 * A stub-client test is structurally blind to everything that makes this
 * migration safe to run against a database shared by dev AND production. The
 * properties worth proving are all properties of RUNNING the SQL:
 *
 *   - the OES coordinate outranks the SOW/1Map design position
 *   - a DR with no OES row still resolves via the ONT serial
 *   - out-of-bounds OES rows (Nepal / Indonesia / Iraq — 13 live rows) are
 *     rejected and fall through to the design coordinate rather than teleporting
 *     a ticket to another continent
 *   - the design coordinate only ever FILLS an empty column, never overwrites
 *   - resolved/closed tickets and other ticket sources are untouched
 *   - it is idempotent — a second run changes nothing
 *   - a coordinate pair never mixes axes across sources
 *   - the snapshot restores exactly on rollback, including a prior NULL
 *   - the SQL parses at all
 *
 * Both files run byte-identical, unrewritten. 479 references its tables
 * unqualified, so pointing `search_path` at a scratch schema sandboxes it. The
 * rollback ends with `DELETE FROM schema_migrations` — a stub of that table is
 * created in the scratch schema so the statement is sandboxed too, rather than
 * being excluded from the test the way earlier migration tests had to.
 *
 * Run it with `npm run test:migrations` (vitest.migrations.config.ts starts a
 * throwaway Postgres and exports TEST_DATABASE_URL). Without that variable the
 * suite SKIPS rather than throwing at module load — the 478 pattern — so it
 * needs no entry in vitest.config.ts's exclude list and cannot fail a plain unit
 * run. Every hook lives inside the describe for the same reason: a top-level
 * beforeAll would still try to connect on a skipped run.
 *
 * SAFETY: everything happens in a scratch schema dropped unconditionally in
 * afterAll, on a client whose search_path points only at that schema — it cannot
 * see, let alone write, the real tables.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const SCHEMA = 'mig479_scratch';
const sqlFile = (name: string) =>
  readFileSync(join(process.cwd(), 'scripts/migrations/sql', name), 'utf8');
const FORWARD = sqlFile('479_ticket_gps_oes_backfill.sql');
const ROLLBACK = sqlFile('rollback_479_ticket_gps_oes_backfill.sql');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

let client: PoolClient;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await client.query(sql, params);
  return r.rows as T[];
}

/** Drop-row ids. Written out in full — a clever generator produced invalid uuids. */
const D1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const D2 = 'aaaaaaa2-0000-4000-8000-000000000002';
const D3 = 'aaaaaaa3-0000-4000-8000-000000000003';
const D4 = 'aaaaaaa4-0000-4000-8000-000000000004';
const D5 = 'aaaaaaa5-0000-4000-8000-000000000005';

/** Ticket ids, one per scenario. Insert order below must match this order. */
const TICKETS = {
  oesByDr: 'ccccccc1-0000-4000-8000-000000000001',
  oesBySerial: 'ccccccc2-0000-4000-8000-000000000002',
  oesOutOfBounds: 'ccccccc3-0000-4000-8000-000000000003',
  designOnlyEmpty: 'ccccccc4-0000-4000-8000-000000000004',
  designOnlyAlreadySet: 'ccccccc5-0000-4000-8000-000000000005',
  closed: 'ccccccc6-0000-4000-8000-000000000006',
  otherSource: 'ccccccc7-0000-4000-8000-000000000007',
  nothingAnywhere: 'ccccccc8-0000-4000-8000-000000000008',
} as const;

async function gpsOf(ticketId: string): Promise<string | null> {
  const rows = await q<{ gps_coordinates: string | null }>(
    `SELECT gps_coordinates FROM maintenance_tickets WHERE id = $1::uuid`,
    [ticketId]
  );
  return rows[0]?.gps_coordinates ?? null;
}

dbDescribe('migration 479 — GPS backfill (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);

    // Minimal stand-ins carrying only the columns the migration touches.
    await q(`
      CREATE TABLE maintenance_tickets (
        id uuid PRIMARY KEY,
        source text,
        status varchar(50),
        dr_number text,
        ont_serial varchar(50),
        gps_coordinates text,
        updated_at timestamptz
      )`);
    await q(`
      CREATE TABLE oes_activations (
        drop_number varchar(20),
        serial_number varchar(50),
        latitude numeric(10,7),
        longitude numeric(10,7),
        activation_date date,
        imported_at timestamptz DEFAULT NOW()
      )`);
    await q(`
      CREATE TABLE drops (
        id uuid PRIMARY KEY,
        drop_number varchar(100),
        latitude numeric,
        longitude numeric,
        updated_at timestamp
      )`);
    // Stub so the rollback's tracker DELETE stays inside the sandbox.
    await q(`CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`);
  });

  afterAll(async () => {
    await client?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
    client?.release();
    await pool.end();
  });

  beforeEach(async () => {
    await q(`DROP TABLE IF EXISTS maintenance_tickets_gps_backup_479`);
    await q(`TRUNCATE maintenance_tickets, oes_activations, drops, schema_migrations`);

    await q(
      `INSERT INTO maintenance_tickets (id, source, status, dr_number, ont_serial, gps_coordinates) VALUES
         ($1::uuid,'olt_mismatch','open',     'DR100','SN100', '-26.7295508,27.0179814'),
         ($2::uuid,'olt_mismatch','assigned', 'DR200','SN200', NULL),
         ($3::uuid,'pp_data',     'open',     'DR300','SN300', '-26.7295508,27.0179814'),
         ($4::uuid,'wa_no_oes',   'open',     'DR400','SN400', NULL),
         ($5::uuid,'wa_no_oes',   'open',     'DR500','SN500', '-26.1111111,27.1111111'),
         ($6::uuid,'olt_mismatch','resolved', 'DR600','SN600', NULL),
         ($7::uuid,'snags',       'open',     'DR700','SN700', NULL),
         ($8::uuid,'pp_data',     'open',     'DR800','SN800', NULL)`,
      Object.values(TICKETS)
    );

    await q(
      `INSERT INTO oes_activations (drop_number, serial_number, latitude, longitude, activation_date) VALUES
         ('DR100','SN100', -26.7387387, 27.0148998, '2026-07-01'),
         ('DR-OTHER','SN200', -26.5000000, 27.5000000, '2026-07-01'),
         ('DR300','SN300',  26.6458226, 87.7349221, '2026-07-01'),
         ('DR600','SN600', -26.4000000, 27.4000000, '2026-07-01'),
         ('DR700','SN700', -26.3000000, 27.3000000, '2026-07-01')`
    );

    await q(
      `INSERT INTO drops (id, drop_number, latitude, longitude, updated_at) VALUES
         ($1::uuid,'DR300', -26.7295508, 27.0179814, NOW()),
         ($2::uuid,'DR400', -26.9000000, 27.9000000, NOW()),
         ($3::uuid,'DR500', -26.8000000, 27.8000000, NOW()),
         ($4::uuid,'DR600', -26.4500000, 27.4500000, NOW()),
         ($5::uuid,'DR700', -26.3500000, 27.3500000, NOW())`,
      [D1, D2, D3, D4, D5]
    );
  });

  dbDescribe('migration 479 — ticket GPS backfill from the OES report', () => {
    it('ranks the OES coordinate above the design position it currently shows', async () => {
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.oesByDr)).toBe('-26.7387387,27.0148998');
    });

    it('resolves via the ONT serial when the DR has no OES row', async () => {
      // The whole point for mismatch tickets: the DR link is what is in dispute,
      // the serial is not. DR200 has no OES row; SN200 activated under DR-OTHER.
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.oesBySerial)).toBe('-26.5000000,27.5000000');
    });

    it('rejects an out-of-bounds OES coordinate instead of teleporting the ticket', async () => {
      // DR300's OES row sits in Nepal. Falling back to the design position leaves
      // a ~20 m error; taking the OES row would introduce an 8,700 km one.
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.oesOutOfBounds)).toBe('-26.7295508,27.0179814');
    });

    it('fills an empty column from the design position when no OES row exists', async () => {
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.designOnlyEmpty)).toBe('-26.9000000,27.9000000');
    });

    it('never overwrites an existing coordinate with the design position', async () => {
      // The design coordinate is what the ticket already had — rewriting it churns
      // rows and destroys snapshot fidelity for no gain.
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.designOnlyAlreadySet)).toBe('-26.1111111,27.1111111');
    });

    it('leaves resolved tickets and other sources alone', async () => {
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.closed)).toBeNull();
      expect(await gpsOf(TICKETS.otherSource)).toBeNull();
    });

    it('leaves a ticket with no coordinate in any source untouched', async () => {
      await client.query(FORWARD);
      expect(await gpsOf(TICKETS.nothingAnywhere)).toBeNull();
    });

    it('writes only complete, well-formed, in-country pairs', async () => {
      await client.query(FORWARD);
      const rows = await q<{ n: string }>(`
        SELECT count(*) AS n FROM maintenance_tickets
         WHERE gps_coordinates IS NOT NULL
           AND NOT (gps_coordinates ~ '^-?[0-9]+\\.?[0-9]*,-?[0-9]+\\.?[0-9]*$'
                    AND split_part(gps_coordinates, ',', 1)::numeric BETWEEN -35 AND -22
                    AND split_part(gps_coordinates, ',', 2)::numeric BETWEEN 16 AND 33)`);
      expect(Number(rows[0]?.n)).toBe(0);
    });

    it('is idempotent — a second run changes nothing', async () => {
      await client.query(FORWARD);
      const after1 = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);
      const touched = await q<{ n: string }>(
        `SELECT count(*) AS n FROM maintenance_tickets_gps_backup_479`
      );

      await client.query(FORWARD);
      const after2 = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);
      const touchedAgain = await q<{ n: string }>(
        `SELECT count(*) AS n FROM maintenance_tickets_gps_backup_479`
      );

      expect(after2).toEqual(after1);
      expect(touchedAgain[0]?.n).toBe(touched[0]?.n);
    });

    it('snapshots every value it changes, and nothing it does not', async () => {
      await client.query(FORWARD);
      const snap = await q<{ ticket_id: string; gps_coordinates: string | null }>(
        `SELECT ticket_id::text, gps_coordinates FROM maintenance_tickets_gps_backup_479 ORDER BY ticket_id`
      );
      const ids = snap.map((r) => r.ticket_id).sort();
      expect(ids).toEqual(
        [TICKETS.oesByDr, TICKETS.oesBySerial, TICKETS.designOnlyEmpty].sort()
      );
    });

    // The invariant that makes rollback trustworthy, asserted directly against
    // the pre-migration state rather than against a hand-listed expectation.
    //
    // An earlier draft built the snapshot in a separate INSERT that read a
    // previously-captured `old_gps`, while the UPDATE re-read the live column.
    // Under READ COMMITTED those two statements see different snapshots, so a
    // concurrent edit desynchronised them in both directions — a row
    // snapshotted but not changed (rollback would clobber the edit) and a row
    // changed but not snapshotted (rollback could not restore it). Both were
    // reproduced on PG 15. The snapshot is now the UPDATE's own RETURNING, which
    // makes the two sets identical by construction; this test is the guard.
    it('snapshot set is exactly the changed set, with the true replaced values', async () => {
      const before = await q<{ id: string; gps_coordinates: string | null }>(
        `SELECT id::text AS id, gps_coordinates FROM maintenance_tickets`
      );
      const priorById = new Map(before.map((r) => [r.id, r.gps_coordinates]));

      await client.query(FORWARD);

      const after = await q<{ id: string; gps_coordinates: string | null }>(
        `SELECT id::text AS id, gps_coordinates FROM maintenance_tickets`
      );
      const changedIds = after
        .filter((r) => r.gps_coordinates !== (priorById.get(r.id) ?? null))
        .map((r) => r.id)
        .sort();

      const snap = await q<{ ticket_id: string; gps_coordinates: string | null }>(
        `SELECT ticket_id::text AS ticket_id, gps_coordinates FROM maintenance_tickets_gps_backup_479`
      );

      // Same rows — no row changed without a snapshot, none snapshotted without changing.
      expect(snap.map((r) => r.ticket_id).sort()).toEqual(changedIds);
      // And each snapshot holds the value that was actually replaced.
      for (const row of snap) {
        expect(row.gps_coordinates).toBe(priorById.get(row.ticket_id) ?? null);
      }
      expect(changedIds.length).toBeGreaterThan(0);
    });
  });

  dbDescribe('rollback 479', () => {
    it('restores every prior value exactly, including a prior NULL', async () => {
      const before = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);

      await client.query(FORWARD);
      const after = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);
      expect(after).not.toEqual(before);

      await client.query(ROLLBACK);
      const restored = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);
      expect(restored).toEqual(before);
      // A prior NULL must come back as NULL, not as an empty string.
      expect(await gpsOf(TICKETS.oesBySerial)).toBeNull();
    });

    it('drops the snapshot table and clears its own tracker row', async () => {
      await client.query(FORWARD);
      await q(`INSERT INTO schema_migrations (filename) VALUES ('479_ticket_gps_oes_backfill.sql')`);
      await q(`INSERT INTO schema_migrations (filename) VALUES ('478_velocity_review_export.sql')`);

      await client.query(ROLLBACK);

      const t = await q<{ reg: string | null }>(
        `SELECT to_regclass('${SCHEMA}.maintenance_tickets_gps_backup_479')::text AS reg`
      );
      expect(t[0]?.reg).toBeNull();
      const left = await q<{ filename: string }>(`SELECT filename FROM schema_migrations`);
      // Only its OWN row — a rollback that clears the whole tracker would make
      // every earlier migration look pending.
      expect(left.map((r) => r.filename)).toEqual(['478_velocity_review_export.sql']);
    });

    it('is a no-op, not an error, when the forward migration never ran', async () => {
      await expect(client.query(ROLLBACK)).resolves.toBeDefined();
      const rows = await q(`SELECT id, gps_coordinates FROM maintenance_tickets ORDER BY id`);
      expect(rows.some((r) => (r as { gps_coordinates: string | null }).gps_coordinates === null)).toBe(true);
    });

    it('is re-runnable — a second rollback does not throw', async () => {
      await client.query(FORWARD);
      await client.query(ROLLBACK);
      await expect(client.query(ROLLBACK)).resolves.toBeDefined();
    });
  });

});
