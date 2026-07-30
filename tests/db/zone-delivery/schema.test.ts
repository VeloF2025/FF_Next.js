import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  PERMISSIONS,
  verifyCrossOwnershipRejected,
  verifyDocumentRules,
  verifyMigrationLifecycle,
  verifyRestrictConstraints,
  verifyZoneEvidencePairing,
} from './migrationLifecycle';

const EXPECTED_TEST_URL =
  'postgres://fibreflow_test:fibreflow_test@localhost:55432/fibreflow_test';

const TABLES = [
  'pon_delivery_state',
  'zone_delivery_activity',
  'zone_delivery_documents',
  'zone_delivery_snag_links',
  'zone_delivery_state',
];

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PON_STAGE_ID = '47000000-0000-4000-8000-000000000001';
const SNAG_ID = '47000000-0000-4000-8000-000000000002';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('zone delivery migration 470', () => {
  let pool: Pool;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL_TEST).toBe(EXPECTED_TEST_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
    await pool.query(`
      TRUNCATE zone_delivery_activity, zone_delivery_snag_links,
        pon_delivery_state, zone_delivery_documents, zone_delivery_state,
        construction_qa_reviews RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates all five delivery tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [TABLES]);

    expect(rows.map(({ table_name }) => table_name)).toEqual(TABLES);
    const { rows: discipline } = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'zone_delivery_snag_links'
        AND column_name = 'qa_discipline'
    `);
    expect(discipline).toEqual([{ column_name: 'qa_discipline' }]);
  });

  it('enforces PON uniqueness, scope reasons, enum values, and row versions', async () => {
    const { rows: columns } = await pool.query<{
      column_name: string;
      column_default: string | null;
      is_nullable: string;
    }>(`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pon_delivery_state'
        AND column_name IN ('pon_stage_id', 'scope_status', 'row_version')
      ORDER BY column_name
    `);

    expect(columns).toEqual([
      expect.objectContaining({ column_name: 'pon_stage_id', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'row_version', column_default: '1', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'scope_status', is_nullable: 'NO' }),
    ]);

    for (const status of ['excluded', 'cancelled']) {
      await expect(pool.query(`
        INSERT INTO pon_delivery_state (pon_stage_id, scope_status)
        VALUES ($1, $2)
      `, [PON_STAGE_ID, status])).rejects.toMatchObject({ code: '23514' });
    }

    await expect(pool.query(`
      INSERT INTO pon_delivery_state (pon_stage_id, scope_status, scope_reason)
      VALUES ($1, 'unknown', 'invalid enum')
    `, [PON_STAGE_ID])).rejects.toMatchObject({ code: '23514' });

    await pool.query(`
      INSERT INTO pon_delivery_state (pon_stage_id, scope_status)
      VALUES ($1, 'included')
    `, [PON_STAGE_ID]);

    await expect(pool.query(`
      INSERT INTO pon_delivery_state (pon_stage_id, scope_status)
      VALUES ($1, 'included')
    `, [PON_STAGE_ID])).rejects.toMatchObject({ code: '23505' });

    await expect(pool.query(`
      UPDATE pon_delivery_state SET row_version = 0 WHERE pon_stage_id = $1
    `, [PON_STAGE_ID])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces zone uniqueness, QA enums, row versions, and terminal handover', async () => {
    await pool.query(`
      INSERT INTO zone_delivery_state (project_id, zone_no)
      VALUES ($1, 1)
    `, [PROJECT_ID]);

    await expect(pool.query(`
      INSERT INTO zone_delivery_state (project_id, zone_no)
      VALUES ($1, 1)
    `, [PROJECT_ID])).rejects.toMatchObject({ code: '23505' });

    await expect(pool.query(`
      UPDATE zone_delivery_state SET civil_qa_status = 'approved'
      WHERE project_id = $1 AND zone_no = 1
    `, [PROJECT_ID])).rejects.toMatchObject({ code: '23514' });

    await expect(pool.query(`
      UPDATE zone_delivery_state SET row_version = 0
      WHERE project_id = $1 AND zone_no = 1
    `, [PROJECT_ID])).rejects.toMatchObject({ code: '23514' });

    await verifyZoneEvidencePairing(pool, {
      projectId: PROJECT_ID, ponStageId: PON_STAGE_ID, snagId: SNAG_ID, userId: USER_ID,
    });

    await pool.query(`
      UPDATE zone_delivery_state
      SET handed_over_at = NOW(), handover_snapshot = '{}'::jsonb
      WHERE project_id = $1 AND zone_no = 1
    `, [PROJECT_ID]);

    await expect(pool.query(`
      UPDATE zone_delivery_state SET handed_over_at = NOW() + INTERVAL '1 minute'
      WHERE project_id = $1 AND zone_no = 1
    `, [PROJECT_ID])).rejects.toThrow(/handed_over_at is immutable/);
  });

  it('enforces document ownership and one active document per owner and type', async () => {
    await verifyDocumentRules(pool, {
      projectId: PROJECT_ID, ponStageId: PON_STAGE_ID, snagId: SNAG_ID, userId: USER_ID,
    });
  });

  it('rejects cross-project and cross-zone PON and snag evidence', async () => {
    await verifyCrossOwnershipRejected(pool, {
      projectId: PROJECT_ID, ponStageId: PON_STAGE_ID, snagId: SNAG_ID, userId: USER_ID,
    });
  });

  it('declares each evidence FK as ON DELETE RESTRICT', async () => {
    await verifyRestrictConstraints(pool);
  });

  it('keeps delivery evidence referenced and activity append-only', async () => {
    await pool.query(`
      INSERT INTO zone_delivery_snag_links (
        project_id, zone_no, snag_id, pon_stage_id, affected_gate,
        handover_blocking, requires_reconfirmation, linked_by
      ) VALUES ($1, 1, $2, $3, 'testing_passed', true, true, $4)
    `, [PROJECT_ID, SNAG_ID, PON_STAGE_ID, USER_ID]);

    await pool.query(`
      INSERT INTO zone_delivery_activity (
        project_id, zone_no, pon_stage_id, entity_type, entity_id, action,
        effective_at, actor_user_id, actor_email, permission, source,
        previous_value, new_value
      ) VALUES (
        $1, 1, $2, 'pon', $2, 'testing_confirmed', NOW(), $3,
        'tester@test.local', 'construction-qa.zone-delivery.testing-confirm',
        'schema-test', '{}'::jsonb, '{"testing_passed": true}'::jsonb
      )
    `, [PROJECT_ID, PON_STAGE_ID, USER_ID]);

    await expect(pool.query(`
      UPDATE zone_delivery_activity SET source = 'tampered'
    `)).rejects.toThrow(/append-only/);
    await expect(pool.query(`
      DELETE FROM zone_delivery_activity
    `)).rejects.toThrow(/append-only/);
    await expect(pool.query(`
      DELETE FROM pon_stage_tracking WHERE id = $1
    `, [PON_STAGE_ID])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query(`
      DELETE FROM snags WHERE id = $1
    `, [SNAG_ID])).rejects.toMatchObject({ code: '23503' });
  });

  it('creates the owner, blocker, activity, and lookup indexes', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      ORDER BY indexname
    `, [[
      'idx_pon_delivery_state_scope',
      'idx_zone_delivery_activity_zone_time',
      'idx_zone_delivery_documents_zone',
      'idx_zone_delivery_snag_links_blocking',
      'ux_zone_delivery_documents_active_pon',
      'ux_zone_delivery_documents_active_zone',
    ]]);

    expect(rows.map(({ indexname }) => indexname)).toEqual([
      'idx_pon_delivery_state_scope',
      'idx_zone_delivery_activity_zone_time',
      'idx_zone_delivery_documents_zone',
      'idx_zone_delivery_snag_links_blocking',
      'ux_zone_delivery_documents_active_pon',
      'ux_zone_delivery_documents_active_zone',
    ]);
  });

  it('adds the six action permissions only to super_admin and admin', async () => {
    const { rows: permissionRows } = await pool.query<{
      key: string;
      parent_key: string;
      type: string;
    }>(`
      SELECT key, parent_key, type
      FROM access_permissions
      WHERE key LIKE 'construction-qa.zone-delivery.%'
      ORDER BY key
    `);

    expect(permissionRows.map(({ key }) => key).sort()).toEqual(PERMISSIONS);
    expect(permissionRows.every(({ parent_key, type }) =>
      parent_key === 'construction-qa.qa-centre' && type === 'action'
    )).toBe(true);

    const { rows: grantRows } = await pool.query<{
      role: string;
      permission_key: string;
      actions: Record<string, boolean>;
    }>(`
      SELECT role, permission_key, actions
      FROM role_permissions
      WHERE permission_key LIKE 'construction-qa.zone-delivery.%'
      ORDER BY role, permission_key
    `);

    expect([...new Set(grantRows.map(({ role }) => role))]).toEqual(['admin', 'super_admin']);
    expect(grantRows).toHaveLength(12);
    expect(grantRows.every(({ actions }) =>
      actions.view && actions.create && actions.edit && actions.delete
    )).toBe(true);

    const { rowCount: overrideCount } = await pool.query(`
      SELECT 1
      FROM user_permission_overrides
      WHERE permission_key LIKE 'construction-qa.zone-delivery.%'
    `);
    expect(overrideCount).toBe(0);
  });

  it('is idempotent, rolls back completely, and reapplies cleanly', async () => {
    await verifyMigrationLifecycle(pool, TABLES);
  });
});
