/**
 * Migration 485 — narrowing parking approval from 30 role-holders to 2 named
 * people — executed against a real Postgres.
 *
 * This is an ACCESS-CONTROL change, and the failure mode it guards is silent:
 * if findApproverUserIds keeps reading role_permissions alone, the migration
 * leaves the page correctly gated to two people while every violation notifies
 * NOBODY. An empty recipient list looks exactly like "no violations occurred".
 * So the test asserts the two halves agree, not just that the migration ran.
 *
 * SAFETY / ISOLATION: own scratch schema, same convention as the 483 files —
 * these run in one shared container and siblings mutate public.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig485_approver_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '485_fleet_parking_approver_narrowing.sql'), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_485_fleet_parking_approver_narrowing.sql'), 'utf8'
);

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 2 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Approvers = typeof import('@/modules/fleet/parking/parkingApprovers');
let approvers: Approvers;

const LIZELLE = '10000000-0000-0000-0000-000000000001';
const HEIN = '10000000-0000-0000-0000-000000000002';
const OTHER_ADMIN = '10000000-0000-0000-0000-000000000003';
const A_MANAGER = '10000000-0000-0000-0000-000000000004';
const A_VIEWER = '10000000-0000-0000-0000-000000000005';

const BASE_SCHEMA = `
  CREATE TABLE users (
    id UUID PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    role VARCHAR(50) NOT NULL, permission_key VARCHAR(100) NOT NULL,
    actions JSONB NOT NULL, PRIMARY KEY (role, permission_key)
  );
  CREATE TABLE user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, permission_key VARCHAR(100) NOT NULL,
    override_type VARCHAR(10) NOT NULL CHECK (override_type IN ('grant','revoke')),
    actions JSONB NOT NULL, granted_by UUID, granted_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ, reason TEXT,
    UNIQUE (user_id, permission_key)
  );
`;

const SEED = `
  INSERT INTO users (id, email, role) VALUES
    ('${LIZELLE}', 'lizelle@velocityfibre.co.za', 'admin'),
    ('${HEIN}', 'hein@velocityfibre.co.za', 'super_admin'),
    ('${OTHER_ADMIN}', 'other.admin@velocityfibre.co.za', 'admin'),
    ('${A_MANAGER}', 'a.manager@velocityfibre.co.za', 'manager'),
    ('${A_VIEWER}', 'a.viewer@velocityfibre.co.za', 'viewer');
  INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('admin',       'fleet.parking-requests', '{"view":true,"edit":true,"create":true,"delete":true}'),
    ('super_admin', 'fleet.parking-requests', '{"view":true,"edit":true,"create":true,"delete":true}'),
    ('manager',     'fleet.parking-requests', '{"view":true,"edit":true,"create":true,"delete":false}'),
    ('viewer',      'fleet.parking-requests', '{"view":false,"edit":false,"create":false,"delete":false}');
`;

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(BASE_SCHEMA);
  approvers = await import('@/modules/fleet/parking/parkingApprovers');
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  await admin.end();
});

beforeEach(async () => {
  await db.query('DELETE FROM user_permission_overrides');
  await db.query('DELETE FROM role_permissions');
  await db.query('DELETE FROM users');
  await db.query(SEED);
});

describe('before the migration', () => {
  it('every role-holder is an approver — the problem being fixed', async () => {
    const ids = await approvers.findApproverUserIds();
    expect(ids.sort()).toEqual([LIZELLE, HEIN, OTHER_ADMIN, A_MANAGER].sort());
    expect(ids).not.toContain(A_VIEWER);
  });
});

describe('after the migration', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('narrows the approver list to exactly the two named people', async () => {
    // The whole point of the change.
    const ids = await approvers.findApproverUserIds();
    expect(ids.sort()).toEqual([LIZELLE, HEIN].sort());
  });

  it('drops the other admin and the manager, who kept the role but lost the grant', async () => {
    const ids = await approvers.findApproverUserIds();
    expect(ids).not.toContain(OTHER_ADMIN);
    expect(ids).not.toContain(A_MANAGER);
  });

  it('leaves the role rows present but all-false, not deleted', async () => {
    // Legible in the admin UI as a deliberate revocation rather than an omission.
    const { rows } = await db.query(
      `SELECT role, actions FROM role_permissions
        WHERE permission_key='fleet.parking-requests' AND role IN ('admin','manager','super_admin')`
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.actions.view).toBe(false);
  });

  it('is rerunnable', async () => {
    await db.query(FORWARD);
    expect((await approvers.findApproverUserIds()).sort()).toEqual([LIZELLE, HEIN].sort());
  });

  it('an inactive approver is excluded', async () => {
    await db.query(`UPDATE users SET is_active = false WHERE id = $1`, [LIZELLE]);
    expect(await approvers.findApproverUserIds()).toEqual([HEIN]);
  });

  it('an EXPIRED override stops granting', async () => {
    await db.query(
      `UPDATE user_permission_overrides SET expires_at = now() - interval '1 day' WHERE user_id = $1`,
      [LIZELLE]
    );
    expect(await approvers.findApproverUserIds()).toEqual([HEIN]);
  });

  it('break-glass: a super_admin granting themselves an override is picked up', async () => {
    // The documented escape hatch when both named approvers are away.
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'fleet.parking-requests', 'grant', '{"view":true,"edit":true}')`,
      [OTHER_ADMIN]
    );
    expect((await approvers.findApproverUserIds())).toContain(OTHER_ADMIN);
  });
});

describe('override semantics match isPermissionBlocked', () => {
  it('a revoke override with view:false falls THROUGH to the role, it does not block', async () => {
    // The non-obvious branch. Approximating it would make this list disagree
    // with the gate on the page itself.
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'fleet.parking-requests', 'revoke', '{"view":false,"edit":false}')`,
      [A_MANAGER]
    );
    expect(await approvers.findApproverUserIds()).toContain(A_MANAGER);
  });

  it('a revoke override with view:true DOES block, even with the role granting it', async () => {
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'fleet.parking-requests', 'revoke', '{"view":true,"edit":true}')`,
      [A_MANAGER]
    );
    expect(await approvers.findApproverUserIds()).not.toContain(A_MANAGER);
  });
});

describe('rollback', () => {
  it('restores the role grants and removes the named overrides', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const ids = await approvers.findApproverUserIds();
    expect(ids.sort()).toEqual([LIZELLE, HEIN, OTHER_ADMIN, A_MANAGER].sort());
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM user_permission_overrides
        WHERE permission_key='fleet.parking-requests'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('is rerunnable', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    await db.query(ROLLBACK);
    expect((await approvers.findApproverUserIds()).length).toBe(4);
  });
});
