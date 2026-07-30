import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { expect } from 'vitest';
import { Pool } from 'pg';
export const PERMISSIONS = [
  'construction-qa.zone-delivery.construction-confirm',
  'construction-qa.zone-delivery.documents-manage',
  'construction-qa.zone-delivery.operations-confirm',
  'construction-qa.zone-delivery.scope-manage',
  'construction-qa.zone-delivery.testing-confirm',
  'construction-qa.zone-delivery.zone-qa-approve',
];
type Counts = {
  tables: string;
  permissions: string;
  role_grants: string;
  migration_rows: string;
};
const COUNT_SQL = `
  SELECT
    (
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    )::text AS tables,
    (
      SELECT COUNT(*) FROM access_permissions
      WHERE key = ANY($2::text[])
    )::text AS permissions,
    (
      SELECT COUNT(*) FROM role_permissions
      WHERE permission_key = ANY($2::text[])
    )::text AS role_grants,
    (
      SELECT COUNT(*) FROM schema_migrations
      WHERE filename = '470_zone_delivery_handover.sql'
    )::text AS migration_rows
`;
async function counts(pool: Pool, tables: string[]): Promise<Counts> {
  const { rows } = await pool.query<Counts>(COUNT_SQL, [tables, PERMISSIONS]);
  return rows[0];
}
type FixtureIds = {
  projectId: string;
  ponStageId: string;
  snagId: string;
  userId: string;
};
export async function verifyZoneEvidencePairing(
  pool: Pool,
  { projectId, userId }: FixtureIds,
): Promise<void> {
  await expect(pool.query(`
    UPDATE zone_delivery_state SET scope_approved_at = NOW()
    WHERE project_id = $1 AND zone_no = 1
  `, [projectId])).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`
    UPDATE zone_delivery_state SET civil_qa_status = 'passed'
    WHERE project_id = $1 AND zone_no = 1
  `, [projectId])).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`
    UPDATE zone_delivery_state
    SET optical_qa_effective_at = NOW(), optical_qa_approved_by = $2
    WHERE project_id = $1 AND zone_no = 1
  `, [projectId, userId])).rejects.toMatchObject({ code: '23514' });
  await pool.query(`
    UPDATE zone_delivery_state SET
      scope_approved_at = NOW(), scope_approved_by = $2,
      civil_qa_status = 'passed', civil_qa_effective_at = NOW(),
      civil_qa_approved_by = $2,
      optical_qa_status = 'passed', optical_qa_effective_at = NOW(),
      optical_qa_approved_by = $2
    WHERE project_id = $1 AND zone_no = 1
  `, [projectId, userId]);
}
export async function verifyDocumentRules(
  pool: Pool,
  { projectId, ponStageId, userId }: FixtureIds,
): Promise<void> {
  const baseDocument = [
    projectId, 1, 'vf_storage', 'zone-delivery/documents/test.pdf',
    'test.pdf', 'application/pdf', 128, 'a'.repeat(64), userId,
  ];
  await expect(pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, document_type, document_source, source_ref,
      filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, 'fac', $3, $4, $5, $6, $7, $8, $9)
  `, [projectId, 1, 'exfo_result', ...baseDocument.slice(3)]))
    .rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, document_type, document_source, source_ref,
      filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, 'test_pack', $3, $4, $5, $6, $7, $8, $9)
  `, baseDocument)).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, pon_stage_id, document_type, document_source,
      source_ref, filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, $3, 'fac', $4, $5, $6, $7, $8, $9, $10)
  `, [projectId, 1, ponStageId, ...baseDocument.slice(2)]))
    .rejects.toMatchObject({ code: '23514' });
  const { rows: [testPack] } = await pool.query<{ id: string }>(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, pon_stage_id, document_type, document_source,
      source_ref, filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, $3, 'test_pack', $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [projectId, 1, ponStageId, ...baseDocument.slice(2)]);
  await expect(pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, pon_stage_id, document_type, document_source,
      source_ref, filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, $3, 'test_pack', $4, $5, $6, $7, $8, $9, $10)
  `, [projectId, 1, ponStageId, ...baseDocument.slice(2)]))
    .rejects.toMatchObject({ code: '23505' });
  await expect(pool.query(`
    UPDATE pon_delivery_state
    SET testing_passed_at = NOW(), testing_confirmed_by = $2
    WHERE pon_stage_id = $1
  `, [ponStageId, userId])).rejects.toMatchObject({ code: '23514' });
  await pool.query(`
    UPDATE pon_delivery_state
    SET testing_passed_at = NOW(), testing_confirmed_by = $2,
        testing_test_pack_document_id = $3
    WHERE pon_stage_id = $1
  `, [ponStageId, userId, testPack.id]);
  await expect(pool.query(`
    DELETE FROM zone_delivery_documents WHERE id = $1
  `, [testPack.id])).rejects.toMatchObject({ code: '23503' });
  await pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, document_type, document_source, source_ref,
      filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, 'fac', $3, $4, $5, $6, $7, $8, $9)
  `, baseDocument);
  await expect(pool.query(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, document_type, document_source, source_ref,
      filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1, $2, 'fac', $3, $4, $5, $6, $7, $8, $9)
  `, baseDocument)).rejects.toMatchObject({ code: '23505' });
}
export async function verifyCrossOwnershipRejected(
  pool: Pool,
  ids: FixtureIds,
): Promise<void> {
  const foreignPon = '47000000-0000-4000-8000-000000000003';
  const foreignSnag = '47000000-0000-4000-8000-000000000004';
  const statements = [
    {
      text: `
        INSERT INTO zone_delivery_documents (
          project_id, zone_no, pon_stage_id, document_type, document_source,
          source_ref, filename, mime_type, size_bytes, checksum_sha256, uploaded_by
        ) VALUES ($1, 1, $2, 'test_pack', 'vf_storage', 'x', 'x.pdf',
          'application/pdf', 1, $3, $4)
      `,
      values: [ids.projectId, foreignPon, 'b'.repeat(64), ids.userId],
    },
    {
      text: `
        INSERT INTO zone_delivery_snag_links (
          project_id, zone_no, snag_id, pon_stage_id, linked_by
        ) VALUES ($1, 1, $2, $3, $4)
      `,
      values: [ids.projectId, foreignSnag, ids.ponStageId, ids.userId],
    },
    {
      text: `
        INSERT INTO zone_delivery_snag_links (
          project_id, zone_no, snag_id, pon_stage_id, linked_by
        ) VALUES ($1, 1, $2, $3, $4)
      `,
      values: [ids.projectId, ids.snagId, foreignPon, ids.userId],
    },
    {
      text: `
        INSERT INTO zone_delivery_activity (
          project_id, zone_no, pon_stage_id, entity_type, entity_id, action,
          effective_at, actor_user_id, actor_email, permission, source
        ) VALUES ($1, 1, $2, 'pon', $2, 'invalid', NOW(), $3,
          'tester@test.local', 'test', 'schema-test')
      `,
      values: [ids.projectId, foreignPon, ids.userId],
    },
  ];
  const codes = await Promise.all(statements.map(async ({ text, values }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(text, values);
      return false;
    } catch (error) {
      return (error as { code?: string }).code;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }));
  expect(codes).toEqual(['23503', '23503', '23503', '23503']);
}
export async function verifyRestrictConstraints(pool: Pool): Promise<void> {
  const constraints = [
    'pon_delivery_state_pon_stage_fk',
    'pon_delivery_state_testing_document_fk',
    'zone_delivery_activity_pon_owner_fk',
    'zone_delivery_documents_pon_owner_fk',
    'zone_delivery_snag_links_pon_owner_fk',
    'zone_delivery_snag_links_snag_owner_fk',
  ];
  const { rows } = await pool.query<{ conname: string; confdeltype: string }>(`
    SELECT conname, confdeltype
    FROM pg_constraint
    WHERE conname = ANY($1::text[])
    ORDER BY conname
  `, [constraints]);
  expect(rows).toEqual(constraints.sort().map(conname => ({
    conname,
    confdeltype: 'r',
  })));
}
export async function verifyMigrationLifecycle(
  pool: Pool,
  tables: string[],
): Promise<void> {
  const migration = await fs.readFile(path.join(
    process.cwd(),
    'scripts/migrations/sql/470_zone_delivery_handover.sql',
  ), 'utf8');
  const rollback = await fs.readFile(path.join(
    process.cwd(),
    'scripts/migrations/sql/rollback_470_zone_delivery_handover.sql',
  ), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  expect(await counts(pool, tables)).toEqual({
    tables: '5',
    permissions: '6',
    role_grants: '12',
    migration_rows: '1',
  });
  const unrelatedKey = 'construction-qa.zone-delivery.future-action';
  await pool.query(`
    INSERT INTO access_permissions (type, key, parent_key, label)
    VALUES ('action', $1, 'construction-qa.qa-centre', 'Future action')
  `, [unrelatedKey]);
  await pool.query(`
    INSERT INTO role_permissions (role, permission_key, actions)
    VALUES ('manager', $1, '{"view": true}'::jsonb)
  `, [unrelatedKey]);
  await pool.query(`
    INSERT INTO user_permission_overrides (
      user_id, permission_key, override_type, actions, granted_by
    ) VALUES ($1, $2, 'grant', '{"view": true}'::jsonb, $1)
  `, ['22222222-2222-2222-2222-222222222222', unrelatedKey]);
  await pool.query(rollback);
  const rollbackCounts = await counts(pool, tables);
  expect(rollbackCounts).toEqual({
    tables: '0',
    permissions: '0',
    role_grants: '0',
    migration_rows: '0',
  });
  const { rows: preserved } = await pool.query<{
    permissions: string;
    role_grants: string;
    overrides: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM access_permissions WHERE key = $1)::text permissions,
      (SELECT COUNT(*) FROM role_permissions
        WHERE permission_key = $1)::text role_grants,
      (SELECT COUNT(*) FROM user_permission_overrides
        WHERE permission_key = $1)::text overrides
  `, [unrelatedKey]);
  expect(preserved[0]).toEqual({
    permissions: '1',
    role_grants: '1',
    overrides: '1',
  });
  await pool.query(migration);
  expect(await counts(pool, tables)).toEqual({
    tables: '5',
    permissions: '6',
    role_grants: '12',
    migration_rows: '1',
  });
}
