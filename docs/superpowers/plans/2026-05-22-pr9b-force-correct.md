# PR-9b Force-Correct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only force-correct write API + UI for `stock_serials` that bypasses the state-machine, with a per-row audit trail and a new RBAC permission.

**Architecture:** One service (`serialForceCorrectService.ts`) + one API route (`force-correct.ts`) + two UI surfaces (detail-page modal + admin batch page) + one RBAC migration. Per-serial best-effort transactions; preview-then-confirm for batch; audit row written to existing `stock_serial_events` with `event_type='force_corrected'` (no schema migration needed for the audit table). Service imports `pool` from `@/lib/db-pool` (Wave 2 convention); API uses `withAuth + withPermission('procurement.field-stock.force-correct', 'edit')` from `@/lib/auth`.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript, `pg.Pool` (PostgreSQL), Supabase, Vitest, Playwright MCP, existing `<AppLayout>` + `src/components/ui/*` primitives.

**Spec reference:** `docs/superpowers/specs/2026-05-22-pr9b-force-correct-design.md`

**Worktree:** `/home/hein/Workspace/FF_Next.js-wave2-pr9b-force-correct` on branch `feat/wave2-pr9b-force-correct` (already cut off `origin/master` at `78915652b` 2026-05-22).

---

## File Structure (locked decisions)

| File | Action | Responsibility |
|---|---|---|
| `src/types/field-stock/forceCorrectTarget.ts` | Create | `ForceCorrectTarget` interface |
| `src/types/field-stock/forceCorrectResult.ts` | Create | `ForceCorrectRowResult`, `ForceCorrectResult` interfaces |
| `src/types/field-stock/index.ts` | Modify | Re-export new types |
| `src/modules/procurement/field-stock/services/serialForceCorrectService.ts` | Create | `forceCorrectSerials()` — single + batch, dry-run, per-serial txn, audit write |
| `pages/api/procurement/field-stock/serials/force-correct.ts` | Create | `POST` handler, boundary validation, `withAuth + withPermission` |
| `src/components/field-stock/ForceCorrectFields.tsx` | Create | Shared form: 6 editable fields + reason textarea |
| `pages/procurement/field-stock/serials/force-correct.tsx` | Create | Admin batch page: 3-step compose → preview → result |
| `pages/procurement/field-stock/serials/[serialNumber].tsx` | Modify | Add "Force-correct state" button + modal (gated client-side; server enforces) |
| `scripts/migrations/sql/378_rbac_field_stock_force_correct.sql` | Create | Seed `procurement.field-stock.force-correct` permission + super_admin grant |
| `tests/db/services/field-stock/serialForceCorrect.test.ts` | Create | Real-DB integration tests for the service |
| `tests/api/procurement/field-stock/serials-force-correct.test.ts` | Create | API handler tests (mocked service) |
| `tests/migrations/<MAX+1>_rbac_field_stock_force_correct.test.ts` | Create | Migration idempotency + row presence |

---

## Task 1: Pre-implementation schema probe (DONE 2026-05-22 — kept for reference)

**STATUS: COMPLETE.** Findings folded into the spec §5 "Pre-implementation probe — DONE 2026-05-22" block. Summary:

- `stock_serials`: no `current_warehouse_id`; project FK is `allocated_to_project_id`; status CHECK has 11 values.
- `stock_serial_events`: actor_user_id + payload JSONB + from_state/to_state/occurred_at.
- RBAC: `access_permissions` (catalogue) + `role_permissions(role, permission_key, actions jsonb)`. No `permissions`/`roles` tables.
- MAX migration version = 377 → new migration = 378.
- DB pool: import `pool` from `@/lib/db-pool` (named export).

Subsequent tasks use these confirmed names. No further probe steps unless a Task 12 re-check reveals MAX has advanced.

---

## Task 1b: Schema probe steps (skipped — see Task 1 status above)

**Files:** None created. Outputs go in PR description.

Per `feedback_query_schema_before_migration` + Wave 2 lesson #1, every SQL/audit column referenced in this plan is assumed. The probe confirms or amends.

- [ ] **Step 1: Read DB connection string from credentials file**

Run from worktree root:
```bash
grep -A2 'DATABASE_URL\|Password:' .claude/credentials.local.md | head -20
```
Expected: shows `postgresql://...` connection string for `100.96.203.105:5436`.

- [ ] **Step 2: Probe migrations table and pick next version**

```bash
PSQL='psql "$DATABASE_URL"'   # use the connection string from step 1
$PSQL -c "SELECT version FROM migrations ORDER BY version::int DESC LIMIT 5;"
```
Expected: 5 most recent versions. Note the highest (call it `MAX_VERSION`); the new migration will be `MAX_VERSION + 1`.

- [ ] **Step 3: Probe stock_serials structure**

```bash
$PSQL -c "\d stock_serials"
```
Expected: confirm columns exist with these EXACT names:
- `status` (text or enum)
- `current_location_id`
- `current_warehouse_id`
- `project_id`
- `installed_at_drop_number`
- `activated_at_olt_id`

If any column name differs (e.g. snake_case variant), **stop** and amend the spec + this plan accordingly before continuing.

- [ ] **Step 4: Probe stock_serial_events structure**

```bash
$PSQL -c "\d stock_serial_events"
```
Expected: columns include `serial_id`, `event_type`, `performed_by`, `performed_by_name`, `reason`, plus some JSON column for arbitrary payload. Note the EXACT name of the JSON column (likely `metadata` or `details` or `event_data`).

If the JSON column has a different name than `metadata`, record it as `AUDIT_JSON_COL` and use it consistently in subsequent tasks (replace `metadata` everywhere).

If there is NO JSON column at all, **stop** and amend the spec — adding one is a new migration that needs separate discussion.

- [ ] **Step 5: Probe RBAC tables**

```bash
$PSQL -c "\d permissions"
$PSQL -c "\d role_permissions"
$PSQL -c "\d roles"
```
Expected:
- `permissions` has `resource_key` (unique), `resource_type`, `module`, `label`, `description`, `path`, `sort_order`, `id`.
- `role_permissions` has `role_id`, `permission_id`, `can_view`, `can_edit`, `can_create`, `can_delete`.
- `roles` has `id`, `name`.

If any column name differs, record the actual name and use it in Task 4 (migration). For example if `role_permissions` uses `can_read` instead of `can_view`, the migration uses `can_read`.

- [ ] **Step 6: Record probe results in PR description draft**

Append this section to a scratch file `/tmp/pr9b-probe-results.md`:

```markdown
## Pre-implementation probe (2026-05-22)
- MAX_VERSION: <number>
- AUDIT_JSON_COL: <actual name>
- stock_serials column drift: <none | list>
- RBAC column drift: <none | list>
```

This goes verbatim into the PR description body when the PR is opened.

- [ ] **Step 7: Commit nothing**

This task only reads. No git activity. Proceed to Task 2 once results are recorded.

---

## Task 2: Add shared types

**Files:**
- Create: `src/types/field-stock/forceCorrectTarget.ts`
- Create: `src/types/field-stock/forceCorrectResult.ts`
- Modify: `src/types/field-stock/index.ts`
- Test: none (pure types — verified by downstream tasks that import them)

- [ ] **Step 1: Create forceCorrectTarget.ts**

`src/types/field-stock/forceCorrectTarget.ts`:
```typescript
/**
 * Full set of status values the live stock_serials.status CHECK constraint accepts.
 * Force-correct intentionally allows ALL of them, including the 3 that the
 * 8-value SerialStatusValue / transition.ts state machine omits
 * (allocated_to_project, activated, in_repair) — "bypass the state machine"
 * is the whole point of this feature.
 */
export type ForceCorrectStatus =
  | 'available'
  | 'reserved'
  | 'allocated_to_project'
  | 'in_transit'
  | 'issued'
  | 'installed'
  | 'activated'
  | 'faulty'
  | 'in_repair'
  | 'returned'
  | 'scrapped';

/**
 * Force-correct target fields. All optional; omit = leave column unchanged.
 * `null` = explicitly set the column to NULL (e.g., clear a wrongly-set drop number).
 * At least one field must be present (enforced at the API boundary).
 *
 * The 5 columns map 1:1 to live stock_serials columns confirmed 2026-05-22:
 *   status, current_location_id, allocated_to_project_id,
 *   installed_at_drop_number, activated_at_olt_id.
 * There is no current_warehouse_id column on stock_serials.
 */
export interface ForceCorrectTarget {
  status?: ForceCorrectStatus;
  currentLocationId?: string | null;
  allocatedToProjectId?: string | null;
  installedAtDropNumber?: string | null;
  activatedAtOltId?: string | null;
}
```

- [ ] **Step 2: Create forceCorrectResult.ts**

`src/types/field-stock/forceCorrectResult.ts`:
```typescript
import type { ForceCorrectTarget } from './forceCorrectTarget';

export interface ForceCorrectRowResult {
  serialNumber: string;
  found: boolean;
  applied: boolean;
  before?: Partial<ForceCorrectTarget>;
  after?: Partial<ForceCorrectTarget>;
  changedFields: string[];
  error?: string;
}

export interface ForceCorrectResult {
  dryRun: boolean;
  totalRequested: number;
  totalApplied: number;
  totalFailed: number;
  totalNoOp: number;
  rows: ForceCorrectRowResult[];
}
```

- [ ] **Step 3: Update barrel export**

Append to `src/types/field-stock/index.ts`:
```typescript
export type { ForceCorrectStatus, ForceCorrectTarget } from './forceCorrectTarget';
export type { ForceCorrectRowResult, ForceCorrectResult } from './forceCorrectResult';
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: PASS (no new errors introduced).

- [ ] **Step 5: Commit**

```bash
git add src/types/field-stock/forceCorrectTarget.ts src/types/field-stock/forceCorrectResult.ts src/types/field-stock/index.ts
git commit -m "feat(wave2): PR-9b shared types for force-correct"
```

---

## Task 3: RBAC migration

**Files:**
- Create: `scripts/migrations/sql/378_rbac_field_stock_force_correct.sql`
- Test: `tests/migrations/378_rbac_field_stock_force_correct.test.ts`

- [ ] **Step 1: Re-read MAX_VERSION at the very last moment**

Per `feedback_migration_version_collision`, re-confirm 377 is still the max immediately before writing the file:
```bash
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -t -A -c 'SELECT MAX(version::int) FROM migrations;'"
```
Expected: `377`. If higher (parallel session landed a migration), bump filename + test filename to MAX+1.

- [ ] **Step 2: Write the migration**

`scripts/migrations/sql/378_rbac_field_stock_force_correct.sql`:
```sql
-- Adds RBAC permission 'procurement.field-stock.force-correct' (action-type)
-- under parent 'procurement.field-stock'. Grants edit + view to super_admin
-- defensively (super_admin has implicit-all in some setups; explicit grant
-- ensures the permission is honoured regardless).
BEGIN;

-- 1. Register the permission in the access_permissions catalogue.
INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order)
VALUES (
  'action',
  'procurement.field-stock.force-correct',
  'procurement.field-stock',
  'Force-correct serial state',
  'Bypass state-machine validation and directly set status/location/project/drop/OLT on stock_serials. Writes audit-trail row to stock_serial_events.',
  100
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  parent_key = EXCLUDED.parent_key;

-- 2. Grant to super_admin (idempotent via unique (role, permission_key)).
INSERT INTO role_permissions (role, permission_key, actions)
VALUES (
  'super_admin',
  'procurement.field-stock.force-correct',
  '{"view": true, "create": false, "edit": true, "delete": false}'::jsonb
)
ON CONFLICT (role, permission_key) DO UPDATE SET
  actions = EXCLUDED.actions,
  updated_at = NOW();

COMMIT;

-- ROLLBACK (manual, not auto-applied):
-- BEGIN;
-- DELETE FROM role_permissions WHERE permission_key = 'procurement.field-stock.force-correct';
-- DELETE FROM access_permissions WHERE key = 'procurement.field-stock.force-correct';
-- COMMIT;
```

- [ ] **Step 3: Write the migration test (failing first)**

`tests/migrations/378_rbac_field_stock_force_correct.test.ts` (model on the existing `tests/migrations/358_snag_reports_scope.test.ts`):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  'scripts',
  'migrations',
  'sql',
  '378_rbac_field_stock_force_correct.sql',
);

describe('Migration 378: RBAC force-correct permission', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); });

  it('seeds the new permission row in access_permissions', async () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT key, type, parent_key, label FROM access_permissions
       WHERE key = 'procurement.field-stock.force-correct'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'procurement.field-stock.force-correct',
      type: 'action',
      parent_key: 'procurement.field-stock',
    });
  });

  it('is idempotent — applying twice does not error or duplicate', async () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    await pool.query(sql); // second application
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM access_permissions
       WHERE key = 'procurement.field-stock.force-correct'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('grants super_admin view+edit on the new permission', async () => {
    const { rows } = await pool.query(
      `SELECT actions FROM role_permissions
       WHERE role = 'super_admin'
         AND permission_key = 'procurement.field-stock.force-correct'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actions).toMatchObject({
      view: true,
      edit: true,
      create: false,
      delete: false,
    });
  });
});
```

- [ ] **Step 4: Apply migration against the live DB**

The test above does NOT cover applying against the real Supabase instance (the test pool would only run against the test DB, which is empty for this PR — we don't have a test-DB harness wired for migrations). Instead, apply once to live and verify:

```bash
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -f /dev/stdin" < scripts/migrations/sql/378_rbac_field_stock_force_correct.sql
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -c \"SELECT key, type, parent_key FROM access_permissions WHERE key = 'procurement.field-stock.force-correct';\""
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -c \"SELECT role, permission_key, actions FROM role_permissions WHERE permission_key = 'procurement.field-stock.force-correct';\""
```
Expected: one access_permissions row and one role_permissions row. Then re-apply the migration once more to confirm idempotency on live.

Also record the migration in the `migrations` table (look at how `358_snag_reports_scope` was recorded — likely `INSERT INTO migrations (version, name, executed_at) VALUES ('378', '378_rbac_field_stock_force_correct', NOW())`, but confirm column names first):
```bash
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -c '\\d migrations'"
ssh velo@100.96.203.105 "PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -c \"SELECT * FROM migrations WHERE version = '377';\""
```
Then INSERT the row for 378 matching the same shape.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/<N>_rbac_field_stock_force_correct.sql tests/migrations/<N>_rbac_field_stock_force_correct.test.ts
git commit -m "feat(wave2): PR-9b RBAC migration — procurement.field-stock.force-correct"
```

---

## Task 4: Service — skeleton + first failing test (single serial, status-only target)

**Files:**
- Create: `src/modules/procurement/field-stock/services/serialForceCorrectService.ts`
- Test: `tests/db/services/field-stock/serialForceCorrect.test.ts`

TDD: test first, smallest viable case (one serial, status-only target, not dry-run).

- [ ] **Step 1: Write the failing test (one happy-path case)**

`tests/db/services/field-stock/serialForceCorrect.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';

const TEST_USER = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin' };

describe('forceCorrectSerials — service', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    // IMPORTANT: stock_serials has FK constraints (stock_item_id NOT NULL, FK to stock_items;
    // current_location_id FK to stock_locations) and a unique index on (stock_item_id, serial_number).
    // stock_serial_events has FK on actor_user_id to users(id).
    //
    // Before writing the seed below, READ the existing pattern in
    //   tests/db/setup/seed.sql
    // and
    //   tests/db/services/field-stock/searchSerials.test.ts   (Wave 2 PR-8)
    //   tests/db/services/field-stock/getSerialTimeline.test.ts  (Wave 2 PR-9a)
    // and reuse whatever fixtures they create (a sentinel stock_item, a sentinel user, etc).
    // The TEST_USER.id literal above must be a UUID that already exists in users() OR be
    // inserted as part of the fixture; FK will fail otherwise.
    //
    // If the existing setup does not already give us a seeded serial we can mutate
    // freely, extend tests/db/setup/seed.sql (which Wave 2 already touched in #1738 to
    // mirror prod's projects.project_name column).
    await pool.query(`DELETE FROM stock_serial_events WHERE actor_user_id = $1::uuid`, [TEST_USER.id]);
    await pool.query(`
      UPDATE stock_serials
         SET status = 'installed',
             installed_at_drop_number = '1234567',
             current_location_id = NULL,
             allocated_to_project_id = NULL,
             activated_at_olt_id = NULL
       WHERE serial_number = 'TEST-SN-A'
    `);
  });

  it('force-corrects status on one serial and returns applied=true', async () => {
    const result = await forceCorrectSerials({
      serials: ['TEST-SN-A'],
      target: { status: 'available' },
      reason: 'unit test — flip back to available',
      performedBy: TEST_USER.id,
      performedByName: TEST_USER.name,
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.totalRequested).toBe(1);
    expect(result.totalApplied).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(result.totalNoOp).toBe(0);
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.serialNumber).toBe('TEST-SN-A');
    expect(row.found).toBe(true);
    expect(row.applied).toBe(true);
    expect(row.changedFields).toEqual(['status']);
    expect(row.before).toEqual({ status: 'installed' });
    expect(row.after).toEqual({ status: 'available' });
  });
});
```

- [ ] **Step 2: Run test — must FAIL with import error**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialForceCorrect.test.ts
```
Expected: FAIL with "Cannot find module '@/modules/procurement/field-stock/services/serialForceCorrectService'".

- [ ] **Step 3: Implement minimal service (single-serial, status-only)**

`src/modules/procurement/field-stock/services/serialForceCorrectService.ts`:
```typescript
/**
 * Force-correct serial state — bypasses the state machine.
 * Each serial wrapped in its own pg transaction (best-effort).
 * Writes one stock_serial_events row per CHANGED serial (no-op and not-found do not write).
 *
 * Column mapping (live as of 2026-05-22):
 *   ForceCorrectTarget                stock_serials column
 *   ──────────────────────────────────────────────────────────
 *   status                            status
 *   currentLocationId                 current_location_id
 *   allocatedToProjectId              allocated_to_project_id
 *   installedAtDropNumber             installed_at_drop_number
 *   activatedAtOltId                  activated_at_olt_id
 *
 * Audit row layout (stock_serial_events):
 *   actor_user_id  ← performedBy (uuid)
 *   from_state     ← old status (only when status changed; else NULL)
 *   to_state       ← new status (only when status changed; else NULL)
 *   payload        ← { isForceCorrect, performedByName, reason,
 *                      before, after, changedFields }
 *   occurred_at    ← NOW()
 *   source_table / source_id intentionally NULL (bypasses the dedupe unique
 *                  index defined on those columns).
 */
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type {
  ForceCorrectTarget,
  ForceCorrectRowResult,
  ForceCorrectResult,
} from '@/types/field-stock';

export interface ForceCorrectParams {
  serials: string[];
  target: ForceCorrectTarget;
  reason: string;
  performedBy: string;        // uuid (req.user.id)
  performedByName: string;    // display name (req.user.name)
  dryRun: boolean;
}

const TARGET_COLUMN_MAP: Record<keyof ForceCorrectTarget, string> = {
  status: 'status',
  currentLocationId: 'current_location_id',
  allocatedToProjectId: 'allocated_to_project_id',
  installedAtDropNumber: 'installed_at_drop_number',
  activatedAtOltId: 'activated_at_olt_id',
};

const TARGET_FIELDS = Object.keys(TARGET_COLUMN_MAP) as (keyof ForceCorrectTarget)[];

export async function forceCorrectSerials(p: ForceCorrectParams): Promise<ForceCorrectResult> {
  const rows: ForceCorrectRowResult[] = [];
  for (const sn of p.serials) {
    rows.push(await processOne(sn, p));
  }
  return {
    dryRun: p.dryRun,
    totalRequested: p.serials.length,
    totalApplied: rows.filter(r => r.applied).length,
    totalFailed: rows.filter(r => r.error).length,
    totalNoOp: rows.filter(r => r.found && !r.error && r.changedFields.length === 0).length,
    rows,
  };
}

async function processOne(serialNumber: string, p: ForceCorrectParams): Promise<ForceCorrectRowResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: current } = await client.query(
      `SELECT id,
              status,
              current_location_id        AS "currentLocationId",
              allocated_to_project_id    AS "allocatedToProjectId",
              installed_at_drop_number   AS "installedAtDropNumber",
              activated_at_olt_id        AS "activatedAtOltId"
       FROM stock_serials WHERE serial_number = $1 FOR UPDATE`,
      [serialNumber],
    );
    if (current.length === 0) {
      await client.query('ROLLBACK');
      return { serialNumber, found: false, applied: false, changedFields: [] };
    }

    const before: Partial<ForceCorrectTarget> = {};
    const after: Partial<ForceCorrectTarget> = {};
    const changed: (keyof ForceCorrectTarget)[] = [];
    for (const field of TARGET_FIELDS) {
      if (!(field in p.target)) continue;
      const newVal = p.target[field] ?? null;
      const oldVal = (current[0] as Record<string, unknown>)[field] ?? null;
      if (oldVal !== newVal) {
        (before as Record<string, unknown>)[field] = oldVal;
        (after as Record<string, unknown>)[field] = newVal;
        changed.push(field);
      }
    }
    if (changed.length === 0) {
      await client.query('ROLLBACK');
      return { serialNumber, found: true, applied: false, changedFields: [] };
    }
    if (p.dryRun) {
      await client.query('ROLLBACK');
      return { serialNumber, found: true, applied: false, before, after, changedFields: changed };
    }

    // Build UPDATE statement dynamically over the changed columns.
    const setParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const field of changed) {
      setParts.push(`${TARGET_COLUMN_MAP[field]} = $${i++}`);
      params.push(p.target[field] ?? null);
    }
    params.push(current[0].id);
    await client.query(
      `UPDATE stock_serials
         SET ${setParts.join(', ')}, updated_at = NOW()
       WHERE id = $${i}`,
      params,
    );

    // Audit
    const statusChanged = changed.includes('status');
    await client.query(
      `INSERT INTO stock_serial_events
         (serial_id, event_type, from_state, to_state, actor_user_id, payload, occurred_at)
       VALUES ($1, 'force_corrected', $2, $3, $4::uuid, $5::jsonb, NOW())`,
      [
        current[0].id,
        statusChanged ? (before.status ?? null) : null,
        statusChanged ? (after.status ?? null) : null,
        p.performedBy,
        JSON.stringify({
          isForceCorrect: true,
          performedByName: p.performedByName,
          reason: p.reason,
          before,
          after,
          changedFields: changed,
        }),
      ],
    );

    await client.query('COMMIT');
    return { serialNumber, found: true, applied: true, before, after, changedFields: changed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    log.error('forceCorrectSerials row failed', { serialNumber, err: msg }, 'serialForceCorrect');
    return { serialNumber, found: false, applied: false, changedFields: [], error: msg };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test — must PASS**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialForceCorrect.test.ts
```
Expected: PASS (the one test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/procurement/field-stock/services/serialForceCorrectService.ts tests/db/services/field-stock/serialForceCorrect.test.ts
git commit -m "feat(wave2): PR-9b force-correct service — happy path"
```

---

## Task 5: Service — dry-run, no-op, not-found, multi-field target

Add tests + behaviour for the cases beyond the single happy path. The service already supports these from Task 4; this task PROVES they work.

**Files:**
- Modify: `tests/db/services/field-stock/serialForceCorrect.test.ts`

- [ ] **Step 1: Add dry-run test**

Append to the `describe` block:
```typescript
it('dryRun=true returns before/after but writes no row and no audit', async () => {
  const result = await forceCorrectSerials({
    serials: ['TEST-SN-A'],
    target: { status: 'available' },
    reason: 'dry-run test — should not commit',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: true,
  });
  expect(result.dryRun).toBe(true);
  expect(result.totalApplied).toBe(0);
  expect(result.rows[0].applied).toBe(false);
  expect(result.rows[0].before).toEqual({ status: 'installed' });
  expect(result.rows[0].after).toEqual({ status: 'available' });

  const { rows: current } = await pool.query(
    `SELECT status FROM stock_serials WHERE serial_number = 'TEST-SN-A'`,
  );
  expect(current[0].status).toBe('installed');

  const { rows: audits } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM stock_serial_events
     WHERE actor_user_id = $1::uuid AND event_type = 'force_corrected'`,
    [TEST_USER.id],
  );
  expect(audits[0].n).toBe(0);
});
```

- [ ] **Step 2: Add no-op test**

```typescript
it('no-op when target equals current state — found=true, applied=false, no audit', async () => {
  const result = await forceCorrectSerials({
    serials: ['TEST-SN-A'],
    target: { status: 'installed' }, // already installed
    reason: 'no-op test',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  expect(result.totalNoOp).toBe(1);
  expect(result.totalApplied).toBe(0);
  expect(result.rows[0].found).toBe(true);
  expect(result.rows[0].applied).toBe(false);
  expect(result.rows[0].changedFields).toEqual([]);

  const { rows: audits } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM stock_serial_events
     WHERE actor_user_id = $1::uuid AND event_type = 'force_corrected'`,
    [TEST_USER.id],
  );
  expect(audits[0].n).toBe(0);
});
```

- [ ] **Step 3: Add not-found test**

```typescript
it('not-found serial — returns found=false, applied=false, no audit', async () => {
  const result = await forceCorrectSerials({
    serials: ['NONEXISTENT-SN'],
    target: { status: 'available' },
    reason: 'not-found test',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  expect(result.totalRequested).toBe(1);
  expect(result.totalApplied).toBe(0);
  expect(result.totalFailed).toBe(0); // not-found is NOT a failure
  expect(result.rows[0].found).toBe(false);
  expect(result.rows[0].applied).toBe(false);
});
```

- [ ] **Step 4: Add multi-field target test (with null = clear)**

```typescript
it('clears installed_at_drop_number via explicit null and updates status atomically', async () => {
  const result = await forceCorrectSerials({
    serials: ['TEST-SN-A'],
    target: { status: 'available', installedAtDropNumber: null },
    reason: '807-incident remediation simulation',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  expect(result.totalApplied).toBe(1);
  expect(result.rows[0].changedFields.sort()).toEqual(['installedAtDropNumber', 'status']);
  expect(result.rows[0].before).toEqual({ status: 'installed', installedAtDropNumber: '1234567' });
  expect(result.rows[0].after).toEqual({ status: 'available', installedAtDropNumber: null });

  const { rows } = await pool.query(
    `SELECT status, installed_at_drop_number FROM stock_serials WHERE serial_number = 'TEST-SN-A'`,
  );
  expect(rows[0].status).toBe('available');
  expect(rows[0].installed_at_drop_number).toBeNull();
});
```

- [ ] **Step 5: Add audit row shape test**

```typescript
it('audit row payload captures before/after/changedFields/isForceCorrect/reason/performedByName', async () => {
  await forceCorrectSerials({
    serials: ['TEST-SN-A'],
    target: { status: 'available' },
    reason: 'audit shape test',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  const { rows } = await pool.query(
    `SELECT event_type, from_state, to_state, actor_user_id, payload
       FROM stock_serial_events
      WHERE actor_user_id = $1::uuid AND event_type = 'force_corrected'
      ORDER BY occurred_at DESC LIMIT 1`,
    [TEST_USER.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].event_type).toBe('force_corrected');
  expect(rows[0].from_state).toBe('installed');
  expect(rows[0].to_state).toBe('available');
  expect(rows[0].actor_user_id).toBe(TEST_USER.id);
  expect(rows[0].payload).toMatchObject({
    isForceCorrect: true,
    reason: 'audit shape test',
    performedByName: TEST_USER.name,
    before: { status: 'installed' },
    after: { status: 'available' },
    changedFields: ['status'],
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialForceCorrect.test.ts
```
Expected: 5 specs PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/db/services/field-stock/serialForceCorrect.test.ts
git commit -m "test(wave2): PR-9b force-correct — dry-run, no-op, not-found, multi-field, audit shape"
```

---

## Task 6: Service — batch + per-serial atomicity

**Files:**
- Modify: `tests/db/services/field-stock/serialForceCorrect.test.ts`

- [ ] **Step 1: Add second seed serial in beforeEach**

Same caveats as Task 4 step 1 apply — extend `tests/db/setup/seed.sql` to provide both `TEST-SN-A` and `TEST-SN-B` (linked to a sentinel `stock_item_id`), then the `beforeEach` only resets their mutable columns:

```typescript
beforeEach(async () => {
  await pool.query(`DELETE FROM stock_serial_events WHERE actor_user_id = $1::uuid`, [TEST_USER.id]);
  await pool.query(`
    UPDATE stock_serials
       SET status = 'installed', installed_at_drop_number = '1234567'
     WHERE serial_number = 'TEST-SN-A'
  `);
  await pool.query(`
    UPDATE stock_serials
       SET status = 'available', installed_at_drop_number = NULL
     WHERE serial_number = 'TEST-SN-B'
  `);
});
```

- [ ] **Step 2: Add batch test — mixed outcomes**

```typescript
it('batch: applies changed, skips no-op, marks not-found — best-effort', async () => {
  const result = await forceCorrectSerials({
    serials: ['TEST-SN-A', 'TEST-SN-B', 'NONEXISTENT-SN'],
    target: { status: 'available' },
    reason: 'batch best-effort test',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  expect(result.totalRequested).toBe(3);
  expect(result.totalApplied).toBe(1);   // only SN-A changed
  expect(result.totalNoOp).toBe(1);      // SN-B already available
  expect(result.totalFailed).toBe(0);    // not-found ≠ failure
  expect(result.rows).toHaveLength(3);
  const byName = Object.fromEntries(result.rows.map(r => [r.serialNumber, r]));
  expect(byName['TEST-SN-A'].applied).toBe(true);
  expect(byName['TEST-SN-B'].found).toBe(true);
  expect(byName['TEST-SN-B'].applied).toBe(false);
  expect(byName['NONEXISTENT-SN'].found).toBe(false);
});
```

- [ ] **Step 3: Add atomicity test — SN-A's commit is independent of SN-B's no-op**

```typescript
it('per-serial txn isolation: one row writes audit, the other writes nothing', async () => {
  await forceCorrectSerials({
    serials: ['TEST-SN-A', 'TEST-SN-B'],
    target: { status: 'available' },
    reason: 'isolation test',
    performedBy: TEST_USER.id,
    performedByName: TEST_USER.name,
    dryRun: false,
  });
  const { rows } = await pool.query(
    `SELECT s.serial_number, COUNT(e.id)::int AS event_count
     FROM stock_serials s
     LEFT JOIN stock_serial_events e
       ON e.serial_id = s.id AND e.actor_user_id = $1::uuid AND e.event_type = 'force_corrected'
     WHERE s.serial_number IN ('TEST-SN-A', 'TEST-SN-B')
     GROUP BY s.serial_number ORDER BY s.serial_number`,
    [TEST_USER.id],
  );
  expect(rows.find(r => r.serial_number === 'TEST-SN-A').event_count).toBe(1);
  expect(rows.find(r => r.serial_number === 'TEST-SN-B').event_count).toBe(0);
});
```

- [ ] **Step 4: Run tests**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialForceCorrect.test.ts
```
Expected: 7 specs PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/db/services/field-stock/serialForceCorrect.test.ts
git commit -m "test(wave2): PR-9b force-correct — batch best-effort + per-serial txn isolation"
```

---

## Task 7: API handler

**Files:**
- Create: `pages/api/procurement/field-stock/serials/force-correct.ts`
- Test: `tests/api/procurement/field-stock/serials-force-correct.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/api/procurement/field-stock/serials-force-correct.test.ts` (model on `serials-search.test.ts` for `vi.hoisted` + `vi.mock` patterns):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { forceCorrectMock } = vi.hoisted(() => ({ forceCorrectMock: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/procurement/field-stock/services/serialForceCorrectService', () => ({
  forceCorrectSerials: forceCorrectMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/serials/force-correct';

interface CapturedRes extends Partial<NextApiResponse> {
  statusCode?: number;
  jsonData?: unknown;
}
function makeRes(): NextApiResponse & CapturedRes {
  const res: CapturedRes = {};
  res.status = vi.fn((c: number) => { res.statusCode = c; return res as NextApiResponse; });
  res.json = vi.fn((d: unknown) => { res.jsonData = d; return res as NextApiResponse; });
  res.setHeader = vi.fn();
  return res as NextApiResponse & CapturedRes;
}
function makeReq(body: unknown, method = 'POST'): NextApiRequest {
  return {
    method,
    body,
    headers: {},
    query: {},
    user: { id: 'test-user', name: 'Test Admin' },
  } as unknown as NextApiRequest;
}

describe('POST /api/procurement/field-stock/serials/force-correct', () => {
  beforeEach(() => { forceCorrectMock.mockReset(); });

  it('405 on non-POST', async () => {
    const res = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(res.statusCode).toBe(405);
  });

  it('400 when serials missing', async () => {
    const res = makeRes();
    await handler(makeReq({ target: { status: 'available' }, reason: 'twelve chars min' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when serials empty array', async () => {
    const res = makeRes();
    await handler(makeReq({ serials: [], target: { status: 'available' }, reason: 'twelve chars' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when serials exceeds 500', async () => {
    const res = makeRes();
    const serials = Array.from({ length: 501 }, (_, i) => `SN-${i}`);
    await handler(makeReq({ serials, target: { status: 'available' }, reason: 'twelve chars' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when target has no fields', async () => {
    const res = makeRes();
    await handler(makeReq({ serials: ['SN-A'], target: {}, reason: 'twelve chars' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when status not in allowed enum', async () => {
    const res = makeRes();
    await handler(makeReq({ serials: ['SN-A'], target: { status: 'banana' }, reason: 'twelve chars' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when reason shorter than 10 chars', async () => {
    const res = makeRes();
    await handler(makeReq({ serials: ['SN-A'], target: { status: 'available' }, reason: 'short' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('defaults dryRun to true when missing from body', async () => {
    forceCorrectMock.mockResolvedValue({
      dryRun: true, totalRequested: 1, totalApplied: 0, totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const res = makeRes();
    await handler(makeReq({
      serials: ['SN-A'],
      target: { status: 'available' },
      reason: 'twelve chars min length',
    }), res);
    expect(res.statusCode).toBe(200);
    expect(forceCorrectMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('passes performedBy/performedByName from req.user', async () => {
    forceCorrectMock.mockResolvedValue({
      dryRun: false, totalRequested: 1, totalApplied: 1, totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const res = makeRes();
    await handler(makeReq({
      serials: ['SN-A'],
      target: { status: 'available' },
      reason: 'twelve chars min length',
      dryRun: false,
    }), res);
    expect(forceCorrectMock).toHaveBeenCalledWith(expect.objectContaining({
      performedBy: 'test-user',
      performedByName: 'Test Admin',
    }));
  });
});
```

- [ ] **Step 2: Run test — must FAIL with import error**

```bash
npx vitest run tests/api/procurement/field-stock/serials-force-correct.test.ts
```
Expected: FAIL (handler file does not exist yet).

- [ ] **Step 3: Implement the handler**

`pages/api/procurement/field-stock/serials/force-correct.ts`:
```typescript
/**
 * Force-Correct Serial State API
 * POST /api/procurement/field-stock/serials/force-correct
 * Bypasses state-machine validation. Requires procurement.field-stock.force-correct edit.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';
import type { ForceCorrectTarget } from '@/types/field-stock';

const VALID_STATUSES = [
  'available', 'reserved', 'allocated_to_project', 'in_transit', 'issued',
  'installed', 'activated', 'faulty', 'in_repair', 'returned', 'scrapped',
] as const;
const TARGET_KEYS: (keyof ForceCorrectTarget)[] = [
  'status', 'currentLocationId', 'allocatedToProjectId',
  'installedAtDropNumber', 'activatedAtOltId',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  const body = (req.body ?? {}) as {
    serials?: unknown;
    target?: unknown;
    reason?: unknown;
    dryRun?: unknown;
  };

  // 1. serials
  if (!Array.isArray(body.serials)) {
    return apiResponse.validationError(res, { serials: 'serials must be an array' });
  }
  const serials = body.serials
    .filter((s: unknown): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (serials.length === 0) {
    return apiResponse.validationError(res, { serials: 'at least one non-empty serial required' });
  }
  if (serials.length > 500) {
    return apiResponse.validationError(res, { serials: 'max 500 serials per batch' });
  }

  // 2. target
  if (!body.target || typeof body.target !== 'object' || Array.isArray(body.target)) {
    return apiResponse.validationError(res, { target: 'target object required' });
  }
  const rawTarget = body.target as Record<string, unknown>;
  const target: ForceCorrectTarget = {};
  for (const key of TARGET_KEYS) {
    if (key in rawTarget) {
      // null and string both allowed; status validated below
      target[key] = rawTarget[key] as never;
    }
  }
  if (Object.keys(target).length === 0) {
    return apiResponse.validationError(res, { target: 'at least one target field required' });
  }
  if ('status' in target && target.status && !VALID_STATUSES.includes(target.status as typeof VALID_STATUSES[number])) {
    return apiResponse.validationError(res, {
      'target.status': `must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  // 3. reason
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10) {
    return apiResponse.validationError(res, { reason: 'reason must be at least 10 characters' });
  }

  // 4. dryRun (default true if missing)
  const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : true;

  try {
    const result = await forceCorrectSerials({
      serials,
      target,
      reason,
      performedBy: user.id,
      performedByName: user.name,
      dryRun,
    });
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('force-correct API error', { err }, 'force-correct');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('procurement.field-stock.force-correct', 'edit')(handler));
```

- [ ] **Step 4: Run tests — must PASS**

```bash
npx vitest run tests/api/procurement/field-stock/serials-force-correct.test.ts
```
Expected: 9 specs PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/api/procurement/field-stock/serials/force-correct.ts tests/api/procurement/field-stock/serials-force-correct.test.ts
git commit -m "feat(wave2): PR-9b force-correct API handler + validation tests"
```

---

## Task 8: Shared `<ForceCorrectFields>` component

**Files:**
- Create: `src/components/field-stock/ForceCorrectFields.tsx`

The component is the form shared by the detail-page modal and the batch admin page. Pure presentational + controlled input. No data fetching, no API calls — both consumers pass it data.

- [ ] **Step 1: Implement component**

`src/components/field-stock/ForceCorrectFields.tsx`:
```typescript
import type { ForceCorrectTarget } from '@/types/field-stock';

const STATUSES = [
  'available', 'reserved', 'issued', 'in_transit',
  'installed', 'faulty', 'returned', 'scrapped',
] as const;

interface Props {
  /** Optional: when present, rendered as a "current value" column next to each input. */
  currentValues?: Partial<ForceCorrectTarget>;
  value: ForceCorrectTarget;
  reason: string;
  onChange: (next: ForceCorrectTarget) => void;
  onReasonChange: (next: string) => void;
}

// `undefined` = leave unchanged, `null` = explicit clear, `''`/string = set
type Cell = string | null | undefined;

function setField<K extends keyof ForceCorrectTarget>(
  current: ForceCorrectTarget,
  key: K,
  next: Cell,
): ForceCorrectTarget {
  const copy = { ...current };
  if (next === undefined) {
    delete copy[key];
  } else {
    copy[key] = next as ForceCorrectTarget[K];
  }
  return copy;
}

export function ForceCorrectFields({ currentValues, value, reason, onChange, onReasonChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
        ⚠ This bypasses state-machine validation. Use only when the existing state is wrong
        and no valid transition exists. Every change is audited.
      </div>

      <FieldRow label="Status" currentValue={currentValues?.status}>
        <select
          value={value.status ?? ''}
          onChange={(e) => onChange(setField(value, 'status', e.target.value === '' ? undefined : (e.target.value as typeof STATUSES[number])))}
          className="border rounded px-2 py-1 w-full"
        >
          <option value="">(leave unchanged)</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </FieldRow>

      <NullableTextRow label="Current location ID" field="currentLocationId" value={value} currentValues={currentValues} onChange={onChange} />
      <NullableTextRow label="Allocated project ID" field="allocatedToProjectId" value={value} currentValues={currentValues} onChange={onChange} />
      <NullableTextRow label="Installed at drop" field="installedAtDropNumber" value={value} currentValues={currentValues} onChange={onChange} />
      <NullableTextRow label="Activated at OLT" field="activatedAtOltId" value={value} currentValues={currentValues} onChange={onChange} />

      <div>
        <label className="block text-sm font-medium mb-1">Reason (required, min 10 chars)</label>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="border rounded px-2 py-1 w-full min-h-[60px]"
          placeholder="Why is this force-correct needed?"
        />
        <p className="text-xs text-gray-500 mt-1">{reason.trim().length} / 10 chars</p>
      </div>
    </div>
  );
}

function FieldRow({ label, currentValue, children }: { label: string; currentValue?: Cell; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 items-center">
      <label className="text-sm font-medium">{label}</label>
      <div className="text-sm text-gray-600">{currentValue === undefined ? '—' : currentValue === null ? 'NULL' : currentValue}</div>
      <div>{children}</div>
    </div>
  );
}

function NullableTextRow({
  label, field, value, currentValues, onChange,
}: {
  label: string;
  field: keyof Omit<ForceCorrectTarget, 'status'>;
  value: ForceCorrectTarget;
  currentValues?: Partial<ForceCorrectTarget>;
  onChange: (next: ForceCorrectTarget) => void;
}) {
  const cur = value[field];
  const display = cur === undefined ? 'keep' : cur === null ? 'clear' : 'set';
  return (
    <FieldRow label={label} currentValue={currentValues?.[field] as Cell}>
      <div className="flex gap-1">
        <select
          value={display}
          onChange={(e) => {
            if (e.target.value === 'keep') onChange(setField(value, field, undefined));
            else if (e.target.value === 'clear') onChange(setField(value, field, null));
            else onChange(setField(value, field, ''));
          }}
          className="border rounded px-2 py-1"
        >
          <option value="keep">Keep</option>
          <option value="clear">Clear (NULL)</option>
          <option value="set">Set to…</option>
        </select>
        {display === 'set' && (
          <input
            type="text"
            value={(cur as string) ?? ''}
            onChange={(e) => onChange(setField(value, field, e.target.value))}
            className="border rounded px-2 py-1 flex-1"
          />
        )}
      </div>
    </FieldRow>
  );
}
```

> Styling above uses Tailwind utility classes; the repo uses Tailwind elsewhere. If a primitive like `<Button>` / `<Select>` from `src/components/ui/` is the conventional choice for this codebase, substitute it. Behaviour and prop contract stay the same.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/field-stock/ForceCorrectFields.tsx
git commit -m "feat(wave2): PR-9b shared <ForceCorrectFields> form component"
```

---

## Task 9: Detail-page modal integration

**Files:**
- Modify: `pages/procurement/field-stock/serials/[serialNumber].tsx`

Add a "Force-correct state" button + modal that wraps `<ForceCorrectFields>`. Pre-fills `currentValues` from the serial detail already on screen.

- [ ] **Step 1: Read the existing detail page to find the integration point**

```bash
sed -n '1,80p' pages/procurement/field-stock/serials/\[serialNumber\].tsx
```
Locate where the existing primary action (likely "Transition") is rendered. The new "Force-correct state" button sits next to it.

- [ ] **Step 2: Add modal state + handler**

Inside the page component:
```typescript
import { useState } from 'react';
import { ForceCorrectFields } from '@/components/field-stock/ForceCorrectFields';
import type { ForceCorrectTarget, ForceCorrectResult } from '@/types/field-stock';

// ... inside the component:
const [showForceCorrect, setShowForceCorrect] = useState(false);
const [fcTarget, setFcTarget] = useState<ForceCorrectTarget>({});
const [fcReason, setFcReason] = useState('');
const [fcSubmitting, setFcSubmitting] = useState(false);

async function handleForceCorrect() {
  setFcSubmitting(true);
  try {
    const res = await fetch('/api/procurement/field-stock/serials/force-correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serials: [serial.serialNumber],
        target: fcTarget,
        reason: fcReason,
        dryRun: false,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      alert(`Force-correct failed: ${json.error?.message ?? res.statusText}`);
      return;
    }
    const result = json.data as ForceCorrectResult;
    if (result.totalApplied > 0) {
      // Refresh detail page data; setShowForceCorrect(false).
      window.location.reload();
    } else {
      alert(`No changes applied. ${result.rows[0]?.error ?? 'See network tab for details.'}`);
    }
  } finally {
    setFcSubmitting(false);
  }
}

const currentForFc: Partial<ForceCorrectTarget> = {
  status: serial.status,
  currentLocationId: serial.currentLocationId ?? null,
  allocatedToProjectId: serial.allocatedToProjectId ?? null,
  installedAtDropNumber: serial.installedAtDropNumber ?? null,
  activatedAtOltId: serial.activatedAtOltId ?? null,
};
```

Adjust the `currentForFc` field reads to match whatever shape the existing detail page already has for `serial`. If those fields aren't already on the loaded detail object, fetch them via the same service as the rest of the page (don't add a new fetch in this PR).

- [ ] **Step 3: Render the button + modal**

Next to the existing action button area:
```tsx
<button
  type="button"
  onClick={() => setShowForceCorrect(true)}
  className="ml-2 px-3 py-1 rounded border border-red-400 text-red-700 hover:bg-red-50"
>
  Force-correct state
</button>

{showForceCorrect && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
    <div className="bg-white rounded shadow-xl max-w-2xl w-full m-4 p-4">
      <h2 className="text-lg font-semibold mb-2">Force-correct {serial.serialNumber}</h2>
      <ForceCorrectFields
        currentValues={currentForFc}
        value={fcTarget}
        reason={fcReason}
        onChange={setFcTarget}
        onReasonChange={setFcReason}
      />
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={() => setShowForceCorrect(false)}
          className="px-3 py-1 rounded border"
        >Cancel</button>
        <button
          type="button"
          onClick={handleForceCorrect}
          disabled={
            fcSubmitting ||
            Object.keys(fcTarget).length === 0 ||
            fcReason.trim().length < 10
          }
          className="px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50"
        >Apply force-correct</button>
      </div>
    </div>
  </div>
)}
```

> Reuse modal primitive from `src/components/ui/` if one exists (search `git grep -l "DialogContent\|Modal\b" src/components/ui/`). Behaviour stays the same.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/procurement/field-stock/serials/\[serialNumber\].tsx
git commit -m "feat(wave2): PR-9b force-correct modal on serial detail page"
```

---

## Task 10: Admin batch page

**Files:**
- Create: `pages/procurement/field-stock/serials/force-correct.tsx`

Three-step UX: compose → preview → result. All in one page component; step state tracked locally.

- [ ] **Step 1: Implement the page**

`pages/procurement/field-stock/serials/force-correct.tsx`:
```typescript
import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { ForceCorrectFields } from '@/components/field-stock/ForceCorrectFields';
import type { ForceCorrectTarget, ForceCorrectResult } from '@/types/field-stock';

type Step = 'compose' | 'preview' | 'result';

export default function ForceCorrectBatchPage() {
  const [step, setStep] = useState<Step>('compose');
  const [pasted, setPasted] = useState('');
  const [target, setTarget] = useState<ForceCorrectTarget>({});
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ForceCorrectResult | null>(null);
  const [result, setResult] = useState<ForceCorrectResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const serials = pasted
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const composeValid =
    serials.length > 0 &&
    serials.length <= 500 &&
    Object.keys(target).length > 0 &&
    reason.trim().length >= 10;

  async function call(dryRun: boolean): Promise<ForceCorrectResult | null> {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/procurement/field-stock/serials/force-correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials, target, reason, dryRun }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json.error?.message ?? res.statusText);
        return null;
      }
      return json.data as ForceCorrectResult;
    } finally {
      setSubmitting(false);
    }
  }

  async function onPreview() {
    const r = await call(true);
    if (r) { setPreview(r); setStep('preview'); }
  }
  async function onApply() {
    const r = await call(false);
    if (r) { setResult(r); setStep('result'); }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <h1 className="text-xl font-semibold">Force-correct serials (batch)</h1>
        {errorMsg && <div className="text-red-700 text-sm">{errorMsg}</div>}

        {step === 'compose' && (
          <ComposeStep
            serials={serials}
            pasted={pasted}
            onPastedChange={setPasted}
            target={target}
            onTargetChange={setTarget}
            reason={reason}
            onReasonChange={setReason}
            onNext={onPreview}
            disabled={!composeValid || submitting}
          />
        )}

        {step === 'preview' && preview && (
          <PreviewStep
            preview={preview}
            onBack={() => setStep('compose')}
            onApply={onApply}
            submitting={submitting}
          />
        )}

        {step === 'result' && result && (
          <ResultStep result={result} onRestart={() => {
            setPasted(''); setTarget({}); setReason('');
            setPreview(null); setResult(null); setStep('compose');
          }} />
        )}
      </div>
    </AppLayout>
  );
}

function ComposeStep(props: {
  serials: string[];
  pasted: string; onPastedChange: (s: string) => void;
  target: ForceCorrectTarget; onTargetChange: (t: ForceCorrectTarget) => void;
  reason: string; onReasonChange: (r: string) => void;
  onNext: () => void; disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">Serial numbers (one per line)</label>
        <textarea
          value={props.pasted}
          onChange={(e) => props.onPastedChange(e.target.value)}
          className="border rounded px-2 py-1 w-full min-h-[140px] font-mono text-sm"
          placeholder="Paste serial numbers, one per line"
        />
        <p className="text-xs text-gray-500 mt-1">{props.serials.length} serial(s) (max 500)</p>
      </div>
      <ForceCorrectFields
        value={props.target}
        reason={props.reason}
        onChange={props.onTargetChange}
        onReasonChange={props.onReasonChange}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={props.onNext}
          disabled={props.disabled}
          className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
        >Preview changes →</button>
      </div>
    </div>
  );
}

function PreviewStep(props: {
  preview: ForceCorrectResult;
  onBack: () => void; onApply: () => void; submitting: boolean;
}) {
  const { preview } = props;
  return (
    <div className="space-y-3">
      <div className="text-sm">
        {preview.totalRequested} requested · {preview.rows.filter(r => !r.found).length} not found · {preview.totalNoOp} no-op · {preview.rows.filter(r => r.changedFields.length > 0).length} would change
      </div>
      <PreviewTable rows={preview.rows} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={props.onBack} className="px-3 py-1 rounded border">← Edit list</button>
        <button
          type="button"
          onClick={props.onApply}
          disabled={props.submitting}
          className="px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50"
        >Apply {preview.rows.filter(r => r.changedFields.length > 0).length} changes</button>
      </div>
    </div>
  );
}

function ResultStep(props: { result: ForceCorrectResult; onRestart: () => void }) {
  const { result } = props;
  return (
    <div className="space-y-3">
      <div className="text-sm">
        Applied: {result.totalApplied} · Failed: {result.totalFailed} · No-op: {result.totalNoOp} · Not found: {result.rows.filter(r => !r.found).length}
      </div>
      <PreviewTable rows={result.rows} showApplied />
      <div className="flex justify-end">
        <button type="button" onClick={props.onRestart} className="px-3 py-1 rounded border">Start over</button>
      </div>
    </div>
  );
}

function PreviewTable({ rows, showApplied }: { rows: ForceCorrectResult['rows']; showApplied?: boolean }) {
  return (
    <table className="w-full text-sm border">
      <thead className="bg-gray-100">
        <tr>
          <th className="text-left p-2">Serial</th>
          <th className="text-left p-2">Found</th>
          <th className="text-left p-2">Changed fields</th>
          {showApplied && <th className="text-left p-2">Applied</th>}
          <th className="text-left p-2">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.serialNumber} className="border-t">
            <td className="p-2 font-mono">{r.serialNumber}</td>
            <td className="p-2">{r.found ? '✓' : '✗'}</td>
            <td className="p-2">{r.changedFields.join(', ') || '—'}</td>
            {showApplied && <td className="p-2">{r.applied ? '✓' : '—'}</td>}
            <td className="p-2 text-red-700">{r.error ?? (!r.found ? 'not found' : r.changedFields.length === 0 ? 'no-op' : '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -20
```
Expected: TS PASS; build PASS.

- [ ] **Step 3: Commit**

```bash
git add pages/procurement/field-stock/serials/force-correct.tsx
git commit -m "feat(wave2): PR-9b admin batch page — compose → preview → result"
```

---

## Task 11: Playwright UI smoke

**Files:** No code files. Smoke is run via `mcp__playwriter__execute` against `localhost:3004` (local dev) or `dev.fibreflow.app`. Output: screenshots embedded in PR description.

- [ ] **Step 1: Start local dev**

```bash
PORT=3004 npm run dev &
# wait for "ready - started server on 0.0.0.0:3004"
```

- [ ] **Step 2: Seed a known test serial**

```bash
psql "$DATABASE_URL" <<SQL
INSERT INTO stock_serials (id, serial_number, status, installed_at_drop_number)
VALUES ('99999999-9999-9999-9999-999999999999', 'PR9B-SMOKE-001', 'installed', '9999999')
ON CONFLICT (serial_number) DO UPDATE SET status='installed', installed_at_drop_number='9999999';
SQL
```

- [ ] **Step 3: Detail-page modal smoke via `mcp__playwriter__execute`**

Drive the browser:
1. Navigate to `http://localhost:3004/procurement/field-stock/serials/PR9B-SMOKE-001`.
2. Wait for current state to render (status=installed).
3. Click "Force-correct state" button.
4. In the modal: select status='available', set installedAtDropNumber to "Clear", type reason "smoke test — clear false-activation".
5. Click "Apply force-correct".
6. Wait for page reload; assert status now reads `available`.
7. Screenshot (or `page.evaluate()` DOM dump per Wave 2 lesson #3 if screenshot times out).

- [ ] **Step 4: Batch page smoke**

1. Navigate to `http://localhost:3004/procurement/field-stock/serials/force-correct`.
2. Paste `PR9B-SMOKE-001` into the textarea.
3. Set status='installed' in the target (reverse the change from step 3 to leave the DB clean).
4. Set reason "smoke test — revert".
5. Click "Preview changes →"; assert preview table renders one row with `Changed fields: status`.
6. Click "Apply 1 changes"; assert result table shows `Applied: ✓`.
7. Screenshot.

- [ ] **Step 5: Clean up the smoke serial**

```bash
psql "$DATABASE_URL" -c "DELETE FROM stock_serial_events WHERE serial_id = '99999999-9999-9999-9999-999999999999';"
psql "$DATABASE_URL" -c "DELETE FROM stock_serials WHERE id = '99999999-9999-9999-9999-999999999999';"
```

- [ ] **Step 6: Save screenshots to the PR body draft**

Append to `/tmp/pr9b-pr-body.md` (which the open-PR step will use): the screenshot file paths or the DOM dumps.

- [ ] **Step 7: Stop dev server**

```bash
# Find PID by port (per CLAUDE.md hard rule — no pkill -f)
lsof -i :3004
kill <PID>
```

- [ ] **Step 8: No commit needed** (smoke artefacts live in PR body, not in the repo).

---

## Task 12: Final pre-PR checks

**Files:** None modified.

- [ ] **Step 1: Lint + ratchet check**

```bash
npm run ci:quick 2>&1 | tail -50
```
Expected: PASS. If lint regressions vs the ratchet baseline, fix in this PR.

- [ ] **Step 2: Full type-check**

```bash
npx tsc --noEmit 2>&1 | tail -30
```
Expected: zero new errors.

- [ ] **Step 3: Full vitest sweep (only the files we own)**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run \
  tests/db/services/field-stock/serialForceCorrect.test.ts \
  tests/api/procurement/field-stock/serials-force-correct.test.ts \
  tests/migrations/*_rbac_field_stock_force_correct.test.ts
```
Expected: all pass.

- [ ] **Step 4: Antihall check**

```bash
npm run antihall 2>&1 | tail -20
```
Expected: no references to undefined symbols.

- [ ] **Step 5: Parallel-session collision check**

```bash
gh pr list --search "force-correct OR force_correct"
gh pr list --search "field-stock.force-correct"
```
Expected: no other open PR touching the same feature (per Wave 2 lesson #2 / `feedback_parallel_hotfix_collision`).

- [ ] **Step 6: Migration version re-check (last guard)**

```bash
psql "$DATABASE_URL" -c "SELECT MAX(version::int) FROM migrations;"
```
If MAX has advanced past our chosen version since Task 3, **bump our migration filename + test filename** before opening the PR.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/wave2-pr9b-force-correct
gh pr create \
  --title "feat(wave2): PR-9b force-correct write API + admin UI" \
  --body "$(cat /tmp/pr9b-pr-body.md)"
```

PR body must include:
- Probe results from Task 1 (verbatim).
- Smoke screenshots/DOM dumps from Task 11.
- Links to Wave 2 spec + this plan.
- Note that this PR was picked up on user override of the deferral (no formal trigger fired).

- [ ] **Step 8: No additional commit**

The PR body is the artefact; nothing else changes in the repo.

---

## Self-Review (pre-handoff)

**Spec coverage:**
- §3 architecture → Tasks 4 (service), 7 (API), 8–10 (UI).
- §4 API & service contract → Tasks 4 (service impl) + 7 (API validation).
- §5 data & audit → Tasks 1 (probe), 3 (migration), 5 (audit-row metadata test).
- §6 UI → Tasks 8 (shared component), 9 (modal), 10 (batch page).
- §7 types → Task 2.
- §8 testing → Tasks 4–7 (service + API), 11 (UI smoke). Migration test in Task 3.
- §9 risks → addressed via probe (Task 1), migration re-version (Task 12 step 6), parallel-PR check (Task 12 step 5).
- §10 out-of-scope → no task touches the listed surfaces; spec scope is locked.

**No placeholders:** the migration filename and test filename use `<N>` / `<MAX_VERSION+1>` literally as placeholders, but Task 1 step 2 + Task 3 step 1 explicitly require resolving the actual number before writing. No TBD/TODO left behind.

**Type consistency:** `forceCorrectSerials`, `ForceCorrectTarget`, `ForceCorrectRowResult`, `ForceCorrectResult` used consistently across Tasks 2, 4, 5, 6, 7, 8, 9, 10. API handler param shape (`{ serials, target, reason, performedBy, performedByName, dryRun }`) matches service interface.
