import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { expect } from 'vitest';
import { Pool } from 'pg';

type Counts = {
  tables: string;
  permissions: string;
  role_grants?: string;
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
      WHERE key LIKE 'construction-qa.zone-delivery.%'
    )::text AS permissions,
    (
      SELECT COUNT(*) FROM role_permissions
      WHERE permission_key LIKE 'construction-qa.zone-delivery.%'
    )::text AS role_grants,
    (
      SELECT COUNT(*) FROM schema_migrations
      WHERE filename = '470_zone_delivery_handover.sql'
    )::text AS migration_rows
`;

async function counts(pool: Pool, tables: string[]): Promise<Counts> {
  const { rows } = await pool.query<Counts>(COUNT_SQL, [tables]);
  return rows[0];
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

  await pool.query(rollback);

  const rollbackCounts = await counts(pool, tables);
  expect(rollbackCounts).toEqual({
    tables: '0',
    permissions: '0',
    role_grants: '0',
    migration_rows: '0',
  });

  await pool.query(migration);

  expect(await counts(pool, tables)).toEqual({
    tables: '5',
    permissions: '6',
    role_grants: '12',
    migration_rows: '1',
  });
}
