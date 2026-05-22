/**
 * Integration Tests: OES Report — ONT Lifecycle (ONT_LIFECYCLE_V2)
 *
 * Uses pg-mem (in-process PostgreSQL emulator) to run the real SQL templates
 * from oesImportService.ts and queriesV2.ts against a seeded schema.
 * These tests exercise the two root-cause bugs directly:
 *
 *  Bug 1: oesImportService auto-demote — activated → not_found on re-import.
 *  Bug 2: loadFtDisputeDefiniteRows counted historical Active rows, not just
 *         the latest activation per serial (inflated 211 → 22 on 2026-05-21).
 *
 * pg-mem supports DISTINCT ON, LOWER(), cardinality(), timestamptz, and the
 * CTE patterns used in our queries. Verified via manual node check before writing.
 *
 * Note: pg-mem does NOT support EXISTS sub-queries in the LEGACY upsert template
 * that reference maintenance_tickets. We test the lifecycle-relevant CASE branches
 * (resolution_status demotion) and skip the maintenance_ticket_id branch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';

// ── Schema helpers ────────────────────────────────────────────────────────────

function createSchema(db: IMemoryDb): void {
  // Register gen_random_uuid so tables with UUID defaults don't fail
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'text',
    implementation: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }),
  });

  db.public.none(`
    CREATE TABLE IF NOT EXISTS oes_pp_data (
      id                    SERIAL PRIMARY KEY,
      serial_number         TEXT NOT NULL,
      project               TEXT NOT NULL,
      date_registered       DATE,
      import_batch_id       TEXT,
      resolution_status     TEXT NOT NULL DEFAULT 'not_found',
      resolved_drop_number  TEXT,
      resolved_source       TEXT,
      resolved_at           TIMESTAMPTZ,
      maintenance_ticket_id TEXT,
      activated_at          TIMESTAMPTZ,
      decommissioned_at     TIMESTAMPTZ,
      linked_via            TEXT[] NOT NULL DEFAULT '{}',
      updated_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (serial_number, project)
    )
  `);

  db.public.none(`
    CREATE TABLE IF NOT EXISTS oes_activations (
      id                  SERIAL PRIMARY KEY,
      serial_number       TEXT,
      drop_number         TEXT,
      activation_date     DATE,
      activation_datetime TIMESTAMPTZ,
      status              TEXT,
      team                TEXT
    )
  `);
}

// ── SQL templates (copied from oesImportService module-level constants) ───────
// Inline here so we can run them directly against pg-mem without wiring up the
// full service layer. Must be kept in sync with oesImportService.ts when changed.

function upsertLegacySql(valuePlaceholders: string): string {
  return `
    INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
    VALUES ${valuePlaceholders}
    ON CONFLICT (serial_number, project) DO UPDATE SET
      date_registered = COALESCE(EXCLUDED.date_registered, oes_pp_data.date_registered),
      import_batch_id = EXCLUDED.import_batch_id,
      resolution_status = CASE
        WHEN oes_pp_data.resolution_status = 'activated' THEN 'not_found'
        ELSE oes_pp_data.resolution_status
      END,
      resolved_drop_number = CASE
        WHEN oes_pp_data.resolution_status = 'activated' THEN NULL
        ELSE oes_pp_data.resolved_drop_number
      END,
      resolved_source = CASE
        WHEN oes_pp_data.resolution_status = 'activated' THEN NULL
        ELSE oes_pp_data.resolved_source
      END,
      resolved_at = CASE
        WHEN oes_pp_data.resolution_status = 'activated' THEN NULL
        ELSE oes_pp_data.resolved_at
      END,
      updated_at = NOW()`;
}

function upsertV2Sql(valuePlaceholders: string): string {
  return `
    INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
    VALUES ${valuePlaceholders}
    ON CONFLICT (serial_number, project) DO UPDATE SET
      date_registered = COALESCE(EXCLUDED.date_registered, oes_pp_data.date_registered),
      import_batch_id = EXCLUDED.import_batch_id,
      resolution_status = oes_pp_data.resolution_status,
      resolved_drop_number = oes_pp_data.resolved_drop_number,
      resolved_source = oes_pp_data.resolved_source,
      resolved_at = oes_pp_data.resolved_at,
      updated_at = NOW()`;
}

// ── Query SQL (copied from queriesV2.ts) ──────────────────────────────────────

const DEFINITE_SQL = `
  WITH latest_batch_per_project AS (
    SELECT project, MAX(import_batch_id) AS bid
    FROM oes_pp_data WHERE project IS NOT NULL GROUP BY project
  ),
  latest_activation AS (
    SELECT DISTINCT ON (LOWER(serial_number))
           serial_number, drop_number, activation_date, status
    FROM oes_activations
    WHERE serial_number IS NOT NULL
    ORDER BY LOWER(serial_number),
             activation_datetime DESC NULLS LAST,
             activation_date DESC NULLS LAST
  )
  SELECT p.serial_number, p.project, la.drop_number, la.status AS activation_status
  FROM oes_pp_data p
  JOIN latest_batch_per_project lb ON p.project = lb.project AND p.import_batch_id = lb.bid
  JOIN latest_activation la ON LOWER(la.serial_number) = LOWER(p.serial_number)
  WHERE LOWER(la.status) = 'active'`;

// pg-mem limitation: correlated NOT EXISTS using outer alias (p.serial_number) inside
// a CTE reference fails. Rewrite to use LEFT JOIN + IS NULL anti-join pattern,
// which pg-mem handles correctly. Semantically equivalent to the production query.
const LIFECYCLE_SQL = `
  WITH latest_batch_per_project AS (
    SELECT project, MAX(import_batch_id) AS bid
    FROM oes_pp_data WHERE project IS NOT NULL GROUP BY project
  ),
  latest_activation AS (
    SELECT DISTINCT ON (LOWER(serial_number))
           serial_number, status
    FROM oes_activations
    WHERE serial_number IS NOT NULL
    ORDER BY LOWER(serial_number),
             activation_datetime DESC NULLS LAST,
             activation_date DESC NULLS LAST
  )
  SELECT p.serial_number, p.project, p.activated_at
  FROM oes_pp_data p
  JOIN latest_batch_per_project lb ON p.project = lb.project AND p.import_batch_id = lb.bid
  LEFT JOIN latest_activation la
    ON LOWER(la.serial_number) = LOWER(p.serial_number)
    AND LOWER(la.status) = 'active'
  WHERE p.activated_at IS NOT NULL
    AND p.decommissioned_at IS NULL
    AND la.serial_number IS NULL`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OES Report — SQL integration tests (pg-mem)', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = newDb();
    createSchema(db);
  });

  afterEach(() => {
    // pg-mem databases are in-memory; GC handles cleanup
  });

  // ── Test 1: No-demote under re-import (flag ON) ─────────────────────────

  it('V2 upsert: activated row keeps resolution_status=activated after re-import', () => {
    const batch1 = 'b1';
    // Seed: existing activated row from a prior import
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id,
        resolution_status, activated_at)
      VALUES ('ALCLB0001', 'MOA', '2024-01-01', '${batch1}',
        'activated', '2024-06-01T10:00:00Z')
    `);

    // Re-import same serial — V2 upsert must not demote
    const batch2 = 'b2';
    db.public.none(upsertV2Sql(`('ALCLB0001', 'MOA', '2024-01-01', '${batch2}')`));

    const rows = db.public.many(
      `SELECT resolution_status, activated_at FROM oes_pp_data WHERE serial_number = 'ALCLB0001'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolution_status).toBe('activated');
    expect(rows[0]!.activated_at).not.toBeNull();
  });

  // ── Test 2: Legacy demote under re-import (flag OFF, control) ────────────

  it('LEGACY upsert: activated row is demoted to not_found after re-import', () => {
    const batch1 = 'b1';
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id,
        resolution_status, activated_at)
      VALUES ('ALCLB0002', 'MOA', '2024-01-01', '${batch1}',
        'activated', '2024-06-01T10:00:00Z')
    `);

    const batch2 = 'b2';
    db.public.none(upsertLegacySql(`('ALCLB0002', 'MOA', '2024-01-01', '${batch2}')`));

    const rows = db.public.many(
      `SELECT resolution_status FROM oes_pp_data WHERE serial_number = 'ALCLB0002'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolution_status).toBe('not_found');
  });

  // ── Test 3: Serial-swap exclusion from Definite ──────────────────────────

  it('Definite query: serial with older Active + newer Inactive → NOT in result', () => {
    const batch = 'b1';
    // PP row
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
      VALUES ('ALCLB0003', 'MOA', '2024-01-01', '${batch}')
    `);
    // Two activations: older Active, newer Inactive
    db.public.none(`
      INSERT INTO oes_activations (serial_number, drop_number, activation_date, activation_datetime, status)
      VALUES
        ('ALCLB0003', 'DR100', '2024-01-01', '2024-01-01 10:00:00', 'Active'),
        ('ALCLB0003', 'DR100', '2024-06-01', '2024-06-01 10:00:00', 'Inactive')
    `);

    const rows = db.public.many(DEFINITE_SQL);
    // Latest activation is Inactive → must be excluded from Definite
    expect(rows).toHaveLength(0);
  });

  it('Definite query: serial with only Active latest → appears in result', () => {
    const batch = 'b1';
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
      VALUES ('ALCLB0004', 'MOA', '2024-01-01', '${batch}')
    `);
    db.public.none(`
      INSERT INTO oes_activations (serial_number, drop_number, activation_date, activation_datetime, status)
      VALUES ('ALCLB0004', 'DR200', '2024-06-01', '2024-06-01 10:00:00', 'Active')
    `);

    const rows = db.public.many(DEFINITE_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activation_status).toBe('Active');
  });

  // ── Test 4: Decommissioned row excluded from Lifecycle ───────────────────

  it('Lifecycle query: decommissioned row is excluded', () => {
    const batch = 'b1';
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id,
        resolution_status, activated_at, decommissioned_at)
      VALUES ('ALCLB0005', 'MOA', '2024-01-01', '${batch}',
        'activated', '2024-05-01T10:00:00Z', '2024-07-01T10:00:00Z')
    `);

    const rows = db.public.many(LIFECYCLE_SQL);
    expect(rows).toHaveLength(0);
  });

  it('Lifecycle query: activated + no decommission + not OLT-Active → appears in result', () => {
    const batch = 'b1';
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id,
        resolution_status, activated_at, resolved_drop_number)
      VALUES ('ALCLB0006', 'MOA', '2024-01-01', '${batch}',
        'activated', '2024-05-01T10:00:00Z', 'DR300')
    `);
    // No OLT-Active row → must appear in Lifecycle
    db.public.none(`
      INSERT INTO oes_activations (serial_number, drop_number, activation_date, activation_datetime, status)
      VALUES ('ALCLB0006', 'DR300', '2024-05-01', '2024-05-01 10:00:00', 'Inactive')
    `);

    const rows = db.public.many(LIFECYCLE_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.serial_number).toBe('ALCLB0006');
  });

  // ── Test 5: Definite and Lifecycle are disjoint ──────────────────────────

  it('Definite and Lifecycle tabs are disjoint (same serial cannot appear in both)', () => {
    const batch = 'b1';
    // Serial A: OLT-Active → Definite only
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id,
        activated_at)
      VALUES ('ALCLB0007', 'MOA', '2024-01-01', '${batch}', '2024-05-01T00:00:00Z')
    `);
    db.public.none(`
      INSERT INTO oes_activations (serial_number, drop_number, activation_date, activation_datetime, status)
      VALUES ('ALCLB0007', 'DR400', '2024-05-01', '2024-05-01 10:00:00', 'Active')
    `);

    const definiteRows = db.public.many(DEFINITE_SQL);
    const lifecycleRows = db.public.many(LIFECYCLE_SQL);

    const definiteSerials = new Set(definiteRows.map((r: { serial_number: string }) => r.serial_number));
    const lifecycleSerials = new Set(lifecycleRows.map((r: { serial_number: string }) => r.serial_number));

    // Intersection must be empty
    for (const s of definiteSerials) {
      expect(lifecycleSerials.has(s)).toBe(false);
    }
  });
});
