/**
 * Integration test for migration 490 — Wiekus's H&S edit grant.
 *
 * The row existing proves nothing. What matters is whether it RESOLVES to
 * edit=true through the same cascade `userHasPermission` runs, because a leaf
 * grant under a blocked ancestor is silently dead — that is exactly what
 * happened to Warwick's training-certificate grant in July, which sat inert for
 * a day while looking correct in the table.
 *
 * So this reproduces the resolution rules from src/lib/permissions/index.ts
 * against real SQL: ancestors are checked for 'view' only, a `grant` override
 * beats the role, and a missing entry is blocked.
 *
 * Requires TEST_DATABASE_URL. Run with: npm run test:migrations
 *
 * SAFETY: scratch schema, dropped unconditionally in afterAll. The rollback
 * file is not run here — it carries its own COMMIT, which would end the
 * wrapping transaction and commit the scratch schema.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig490_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/490_wiekus_health_safety_edit.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const WIEKUS = '11111111-1111-1111-1111-111111111111';
const OTHER_VIEWER = '22222222-2222-2222-2222-222222222222';

/** Live shape of the three tables the resolution reads. */
const PREREQUISITES = `
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email varchar(255) NOT NULL UNIQUE,
    role varchar(50) NOT NULL,
    permissions jsonb
  );
  CREATE TABLE access_permissions (
    key varchar(100) PRIMARY KEY,
    parent_key varchar(100)
  );
  CREATE TABLE role_permissions (
    role varchar(50) NOT NULL,
    permission_key varchar(100) NOT NULL,
    actions jsonb NOT NULL,
    PRIMARY KEY (role, permission_key)
  );
  CREATE TABLE user_permission_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    permission_key varchar(100) NOT NULL,
    override_type varchar(10) NOT NULL,
    actions jsonb NOT NULL,
    granted_by uuid,
    granted_at timestamptz DEFAULT now(),
    expires_at timestamptz,
    reason text,
    UNIQUE (user_id, permission_key)
  );
`;

/** Mirrors production: viewer sees the module but cannot edit it. */
const SEED = `
  INSERT INTO users (id, email, role) VALUES
    ('${WIEKUS}', 'wiekus@velocityfibre.co.za', 'viewer'),
    ('${OTHER_VIEWER}', 'someone.else@velocityfibre.co.za', 'viewer');
  INSERT INTO access_permissions (key, parent_key) VALUES
    ('projects', NULL),
    ('projects.health-safety', 'projects');
  INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('viewer', 'projects',
     '{"view": true, "edit": false, "create": false, "delete": false}'::jsonb),
    ('viewer', 'projects.health-safety',
     '{"view": true, "edit": false, "create": false, "delete": false}'::jsonb);
`;

async function scoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * The resolution `userHasPermission` performs, in SQL:
 *   1. every ancestor must be unblocked for 'view'
 *   2. the leaf must be unblocked for the requested action
 * A `grant` override wins over the role; no entry at all is blocked.
 */
async function isBlocked(userId: string, key: string, action: string): Promise<boolean> {
  const [row] = await scoped<{ blocked: boolean }>(
    `SELECT CASE
              WHEN o.override_type = 'grant'  THEN COALESCE((o.actions->>$3)::boolean, false) IS NOT TRUE
              WHEN o.override_type = 'revoke' AND COALESCE((o.actions->>$3)::boolean, false) THEN true
              WHEN r.actions IS NOT NULL      THEN COALESCE((r.actions->>$3)::boolean, false) IS NOT TRUE
              ELSE true
            END AS blocked
       FROM users u
       LEFT JOIN user_permission_overrides o
              ON o.user_id = u.id AND o.permission_key = $2
             AND (o.expires_at IS NULL OR o.expires_at > NOW())
       LEFT JOIN role_permissions r
              ON r.role = u.role AND r.permission_key = $2
      WHERE u.id = $1`,
    [userId, key, action]
  );
  return row?.blocked ?? true;
}

async function hasPermission(userId: string, key: string, action: string): Promise<boolean> {
  const ancestors = await scoped<{ key: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT parent_key FROM access_permissions WHERE key = $1 AND parent_key IS NOT NULL
       UNION ALL
       SELECT ap.parent_key FROM access_permissions ap
         JOIN ancestors a ON ap.key = a.parent_key
        WHERE ap.parent_key IS NOT NULL
     )
     SELECT parent_key AS key FROM ancestors`,
    [key]
  );
  // Ancestors are checked for 'view' regardless of the action requested.
  for (const a of ancestors) {
    if (await isBlocked(userId, a.key, 'view')) return false;
  }
  return !(await isBlocked(userId, key, action));
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(PREREQUISITES);
  await scoped(SEED);
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await pool.end();
});

describe('migration 490 — Wiekus H&S edit grant', () => {
  it('BEFORE the migration he can view but not edit', async () => {
    // The state that made the shipped feature unusable for him.
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'view')).toBe(true);
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'edit')).toBe(false);
  });

  it('grants edit after the migration — and it is NOT inert', async () => {
    await scoped(FORWARD);

    // The whole point: resolved through the real cascade, not merely present
    // as a row. A leaf grant under a blocked ancestor reads as edit=false here.
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'edit')).toBe(true);
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'view')).toBe(true);
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'create')).toBe(true);
  });

  it('does not grant delete', async () => {
    // Correcting a wrong upload goes through withHsPermission's 'edit' mapping,
    // so he does not need a delete right over H&S records generally.
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'delete')).toBe(false);
  });

  it('does not widen anyone else', async () => {
    // A role-level grant would have caught every viewer; this must not.
    expect(await hasPermission(OTHER_VIEWER, 'projects.health-safety', 'edit')).toBe(false);
  });

  it('does not touch the parent module', async () => {
    // He should still not be able to edit projects generally.
    expect(await hasPermission(WIEKUS, 'projects', 'edit')).toBe(false);
  });

  it('is rerunnable and does not duplicate the row', async () => {
    await scoped(FORWARD);
    const [row] = await scoped<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM user_permission_overrides
        WHERE user_id = $1 AND permission_key = 'projects.health-safety'`,
      [WIEKUS]
    );
    expect(row?.count).toBe('1');
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'edit')).toBe(true);
  });

  it('would be INERT if the parent blocked view — the July failure mode', async () => {
    // Guards the reasoning, not just the outcome: if someone later revokes
    // `projects` view for him, this grant silently stops working. Asserting it
    // here means that coupling is documented and testable rather than folklore.
    await scoped(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'projects', 'revoke',
               '{"view": true, "edit": true, "create": true, "delete": true}'::jsonb)`,
      [WIEKUS]
    );

    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'edit')).toBe(false);

    await scoped(`DELETE FROM user_permission_overrides WHERE user_id = $1 AND permission_key = 'projects'`, [WIEKUS]);
    expect(await hasPermission(WIEKUS, 'projects.health-safety', 'edit')).toBe(true);
  });
});
