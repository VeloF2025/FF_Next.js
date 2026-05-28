# Sprint E — Serial Lifecycle State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `stock_serials.status` the single, validated, trigger-emitted source of truth for the ONT/Gizzu lifecycle. Generic validate + emit triggers replace mig 365/366/367; one TS helper `promoteSerial` is the only sanctioned write path; ESLint + CI grep gate enforce the discipline. Plus the Sprint D deferred fast-follows. One big-bang cutover.

**Architecture:** New migration 387 widens the status CHECK to 8 values, adds two lookup tables (`stock_serial_status_transitions`, `stock_serial_status_holder_pairs`), installs three triggers on `stock_serials` (status-validate, status-emit, holder-validate). All status writes route through `src/modules/procurement/field-stock/services/serialLifecycle.ts::promoteSerial`, which sets per-txn `SET LOCAL ff.event_*` GUCs the emit trigger reads. Existing Sprint D custody helpers (`postIssueToHolderWith` etc.) compose inside the verbs. ESLint rule `local/no-direct-serial-status-write` + a `Gate 5` grep check in `scripts/ci-local.sh` enforce the no-bypass discipline.

**Tech Stack:** TypeScript 5, Next.js Pages Router, `pg.Pool` via `@/lib/db-pool` + `transaction()` helper, Postgres triggers (plpgsql), Vitest 0.34, `tsx` for scripts, self-hosted Supabase Postgres (shared dev+prod).

**Spec:** `docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md`

**Branch / worktree:** Each track gets its own worktree per [[feedback_worktree_per_plan_isolation]]. Suggested:
- Tracks 1–6: `feat/serial-lifecycle-sprintE-<track>` under `/home/hein/Workspace/FF_Next.js-sprintE-<track>`
- Track 7 (cutover) is operational, not a code track.

---

## Hard prerequisites (do BEFORE starting Track 1)

1. **A/B/C/D production app promotion.** Sprints B/A/C/D code on `fibreflow-production.service` (after-hours, with Hein's explicit approval, via `bash scripts/deploy-local.sh production`). ~24h soak before scheduling Sprint E.
2. **PR #1805 (drift bug fixes) merged + cleanup script run.** The 27 drifted rows must be cleaned (`scripts/cleanup-serial-drift-2026-05-28.ts --commit`) before mig 387's backfill runs — otherwise the backfill seeds drifted state into the synthetic events.
3. **Migration version reconfirmed at start of each track:** `SELECT MAX(version)::int FROM migrations;` and `gh pr list --search 'migration in:title'` per [[feedback_migration_version_collision]] and [[feedback_parallel_session_migration_coordination]].

---

## Track 1 — Foundation: migration + helper + tests

Single PR. Lands the trigger infrastructure and the `promoteSerial` helper. Does NOT yet retire mig 365/366/367 (Track 2 will, once verbs are refactored).

### Task 1.1: New migration 387 — schema + transitions + holder pairs

**Files:**
- Create: `scripts/migrations/sql/387_serial_lifecycle_state_machine.sql`
- Create: `scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql`

- [ ] **Step 1.1.1: Verify migration version is free**

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -t -A \
  -c "SELECT MAX(version)::int FROM migrations;"
gh pr list --search "migration in:title"
ls scripts/migrations/sql/387_* 2>&1
```

Expected: MAX < 387, no PR with `387` in title, no file collisions.

- [ ] **Step 1.1.2: Write the forward migration**

Create `scripts/migrations/sql/387_serial_lifecycle_state_machine.sql`:

```sql
-- Migration 387: Serial lifecycle state machine (Sprint E)
-- Spec: docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md
-- Replaces per-source emit triggers (mig 365/366/367) with one generic
-- status-validate + status-emit + holder-validate pair on stock_serials.
-- pre_provision remains an overlay (pp_flagged + pp_resolution_status, mig 312).

BEGIN;

-- 1. Widen the status CHECK to the 8-value vocabulary.
--    Drops `reserved`, `in_transit`, `in_repair` from acceptable values; the
--    backfill task (Track 5) maps `available` → `in_stock` first, so the
--    CHECK widening can be done before the rename in the same txn.
ALTER TABLE stock_serials
  DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials
  ADD CONSTRAINT stock_serials_status_check
  CHECK (status IN (
    'available',                -- legacy, retained until backfill renames to in_stock
    'in_stock',
    'allocated_to_project',
    'issued',
    'installed',
    'activated',
    'faulty',
    'returned',
    'scrapped'
  ));

-- 2. Transition matrix table.
CREATE TABLE stock_serial_status_transitions (
  from_state    varchar(50),                -- NULL means INSERT (no prior row)
  to_state      varchar(50)   NOT NULL,
  event_type    varchar(50)   NOT NULL,
  description   text,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO stock_serial_status_transitions (from_state, to_state, event_type, description) VALUES
  (NULL,                  'in_stock',             'received',              'GRN posting / Odoo opening seed'),
  ('in_stock',            'allocated_to_project', 'allocated',             'Project allocation'),
  ('allocated_to_project','issued',               'issued_to_tech',        'Picking done'),
  ('in_stock',            'issued',               'issued_to_tech',        'Picking done (allocation skipped)'),
  ('issued',              'installed',            'installed_at_drop',     'Field install'),
  ('installed',           'activated',            'activated',             'OES activation'),
  ('installed',           'faulty',               'marked_faulty',         'RMA flagged pre-activation'),
  ('activated',           'faulty',               'marked_faulty',         'RMA flagged post-activation'),
  ('issued',              'faulty',               'marked_faulty',         'Tech-side fault before install'),
  ('installed',           'returned',             'returned_to_warehouse', 'Pulled from drop'),
  ('activated',           'returned',             'returned_to_warehouse', 'Customer cancel + recovery'),
  ('faulty',              'returned',             'returned_to_warehouse', 'RMA returned'),
  ('returned',            'in_stock',             'restocked',             'Return disposition=restock'),
  ('returned',            'scrapped',             'scrapped',              'Return disposition=scrap'),
  ('faulty',              'scrapped',             'scrapped',              'Scrapped without restock'),
  -- Self-loops (no-op writes) — explicitly allowed, emit nothing
  ('in_stock',            'in_stock',             'no_op',                 'Same-state UPDATE'),
  ('issued',              'issued',               'no_op',                 'Same-state UPDATE'),
  ('installed',           'installed',            'no_op',                 'Same-state UPDATE'),
  ('activated',           'activated',            'no_op',                 'Same-state UPDATE');

-- 3. Holder cross-validation pairs (status × holder_type).
--    NULL holder_type means holder_id IS NULL is acceptable.
CREATE TABLE stock_serial_status_holder_pairs (
  status        varchar(50) NOT NULL,
  holder_type   varchar(50),                -- NULL = holder_id IS NULL required
  PRIMARY KEY (status, holder_type)
);
COMMENT ON TABLE stock_serial_status_holder_pairs IS
  'Allowed (status, holder_type) pairs. Multiple rows per status mean each is acceptable.';

INSERT INTO stock_serial_status_holder_pairs (status, holder_type) VALUES
  ('available',            'warehouse'),       -- legacy, until backfill
  ('in_stock',             'warehouse'),
  ('allocated_to_project', 'warehouse'),       -- earmarked but still at warehouse
  ('allocated_to_project', 'project'),         -- moved to project staging
  ('issued',               'staff'),
  ('installed',            NULL),              -- at customer, no tracked holder
  ('activated',            NULL),
  ('faulty',               'staff'),           -- during pickup
  ('faulty',               'warehouse'),       -- after pickup
  ('faulty',               'vendor'),          -- RMA in flight
  ('returned',             'warehouse'),
  ('scrapped',             NULL),
  ('scrapped',             'vendor');

-- 4. Side table for any RAISE NOTICE warnings during bypass operations.
CREATE TABLE stock_serial_lifecycle_violations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id     uuid REFERENCES stock_serials(id),
  serial_number varchar(100),
  attempted_from varchar(50),
  attempted_to   varchar(50),
  source_table  varchar(50),
  source_id     uuid,
  bypass_used   boolean DEFAULT false,
  raised_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_ssv_raised_at ON stock_serial_lifecycle_violations (raised_at DESC);

-- 5. Status-validate trigger function.
CREATE OR REPLACE FUNCTION trg_stock_serial_status_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_from      varchar(50);
  v_to        varchar(50);
  v_bypass    boolean;
  v_allowed   boolean;
BEGIN
  v_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  v_to   := NEW.status;

  -- No-op same-state writes pass without check
  IF v_from IS NOT DISTINCT FROM v_to AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_bypass := COALESCE(current_setting('ff.bypass_validation', true), 'false') = 'true';

  IF v_bypass THEN
    -- Log the bypass to the violations side-table for audit; allow write
    INSERT INTO stock_serial_lifecycle_violations
      (serial_id, serial_number, attempted_from, attempted_to,
       source_table, source_id, bypass_used)
    VALUES
      (NEW.id, NEW.serial_number, v_from, v_to,
       NULLIF(current_setting('ff.event_source_table', true), ''),
       NULLIF(current_setting('ff.event_source_id', true), '')::uuid,
       true);
    RETURN NEW;
  END IF;

  SELECT TRUE INTO v_allowed
    FROM stock_serial_status_transitions
   WHERE from_state IS NOT DISTINCT FROM v_from
     AND to_state   = v_to
   LIMIT 1;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'lifecycle_violation: % → % not allowed for serial % (set ff.bypass_validation=true to override)',
      COALESCE(v_from, 'NULL'), v_to, NEW.serial_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Status-emit trigger function. Reads per-txn GUCs for context.
CREATE OR REPLACE FUNCTION trg_stock_serial_status_emit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_from        varchar(50);
  v_event_type  varchar(50);
  v_source_table varchar(50);
  v_source_id    uuid;
  v_payload     jsonb;
BEGIN
  v_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;

  -- Skip no-op same-state
  IF v_from IS NOT DISTINCT FROM NEW.status AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  SELECT event_type INTO v_event_type
    FROM stock_serial_status_transitions
   WHERE from_state IS NOT DISTINCT FROM v_from
     AND to_state   = NEW.status
   LIMIT 1;

  -- Unknown transition (only possible with bypass): emit a generic event
  IF v_event_type IS NULL THEN
    v_event_type := 'force_corrected';
  END IF;

  v_source_table := NULLIF(current_setting('ff.event_source_table', true), '');
  v_source_id    := NULLIF(current_setting('ff.event_source_id',    true), '')::uuid;
  v_payload      := COALESCE(NULLIF(current_setting('ff.event_payload', true), '')::jsonb, '{}'::jsonb);

  INSERT INTO stock_serial_events
    (serial_id, event_type, from_state, to_state,
     source_table, source_id,
     actor_user_id, actor_staff_id,
     payload, occurred_at)
  VALUES
    (NEW.id, v_event_type, v_from, NEW.status,
     v_source_table, v_source_id,
     NULLIF(current_setting('ff.event_actor_user_id',  true), '')::uuid,
     NULLIF(current_setting('ff.event_actor_staff_id', true), '')::uuid,
     v_payload,
     COALESCE(NULLIF(current_setting('ff.event_occurred_at', true), '')::timestamptz, NOW()))
  ON CONFLICT (serial_id, source_table, source_id, event_type)
    WHERE source_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

-- 7. Holder-validate trigger function.
CREATE OR REPLACE FUNCTION trg_stock_serial_holder_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_holder_type varchar(50);
  v_allowed     boolean;
BEGIN
  IF current_setting('ff.bypass_validation', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.holder_id IS NULL THEN
    v_holder_type := NULL;
  ELSE
    SELECT holder_type INTO v_holder_type
      FROM stock_holders
     WHERE id = NEW.holder_id;
  END IF;

  SELECT TRUE INTO v_allowed
    FROM stock_serial_status_holder_pairs
   WHERE status = NEW.status
     AND holder_type IS NOT DISTINCT FROM v_holder_type
   LIMIT 1;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'holder_mismatch: status=% with holder_type=% not allowed for serial %',
      NEW.status, COALESCE(v_holder_type, 'NULL'), NEW.serial_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 8. Install triggers. NOTE: legacy mig 365/366/367 triggers REMAIN INSTALLED
--    until Track 2 retires them after the verbs are refactored.
DROP TRIGGER IF EXISTS trg_stock_serial_status_validate_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_status_validate_t
  BEFORE INSERT OR UPDATE OF status ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_status_validate();

DROP TRIGGER IF EXISTS trg_stock_serial_status_emit_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_status_emit_t
  AFTER INSERT OR UPDATE OF status ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_status_emit();

DROP TRIGGER IF EXISTS trg_stock_serial_holder_validate_t ON stock_serials;
CREATE TRIGGER trg_stock_serial_holder_validate_t
  BEFORE INSERT OR UPDATE OF status, holder_id ON stock_serials
  FOR EACH ROW EXECUTE FUNCTION trg_stock_serial_holder_validate();

INSERT INTO migrations (version, name)
  VALUES (387, 'serial_lifecycle_state_machine')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 1.1.3: Write the rollback migration**

Create `scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql`:

```sql
-- Rollback 387: drop new triggers + tables; restore 11-value CHECK; un-rename in_stock.
-- mig 365/366/367 triggers are still installed (Track 2 does not retire them in the
-- same PR as Track 1's foundation), so no re-install needed here.

BEGIN;

DROP TRIGGER IF EXISTS trg_stock_serial_status_validate_t ON stock_serials;
DROP TRIGGER IF EXISTS trg_stock_serial_status_emit_t ON stock_serials;
DROP TRIGGER IF EXISTS trg_stock_serial_holder_validate_t ON stock_serials;
DROP FUNCTION IF EXISTS trg_stock_serial_status_validate();
DROP FUNCTION IF EXISTS trg_stock_serial_status_emit();
DROP FUNCTION IF EXISTS trg_stock_serial_holder_validate();

-- Rename in_stock back to available before restoring the 11-value CHECK
UPDATE stock_serials SET status = 'available' WHERE status = 'in_stock';

ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials
  ADD CONSTRAINT stock_serials_status_check
  CHECK (status IN (
    'available','reserved','allocated_to_project','in_transit','issued',
    'installed','activated','faulty','in_repair','returned','scrapped'
  ));

DROP TABLE IF EXISTS stock_serial_lifecycle_violations;
DROP TABLE IF EXISTS stock_serial_status_holder_pairs;
DROP TABLE IF EXISTS stock_serial_status_transitions;

DELETE FROM migrations WHERE version = '387';

COMMIT;
```

- [ ] **Step 1.1.4: Smoke-test the migration on a Docker-spun DB**

```bash
# Bring up an ephemeral Postgres with prod schema only
docker run --rm -d --name sprintE-smoke -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
sleep 5
PGPASSWORD="$PGPASSWORD" pg_dump -h 100.96.203.105 -p 5437 -U postgres -d fibreflow \
  --schema-only --no-owner > /tmp/ff-schema.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -c "CREATE DATABASE fibreflow;"
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d fibreflow < /tmp/ff-schema.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d fibreflow \
  < scripts/migrations/sql/387_serial_lifecycle_state_machine.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d fibreflow \
  -c "SELECT COUNT(*) FROM stock_serial_status_transitions;" \
  -c "SELECT COUNT(*) FROM stock_serial_status_holder_pairs;"
# Test rollback
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d fibreflow \
  < scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d fibreflow \
  -c "SELECT COUNT(*) FROM stock_serial_status_transitions;" 2>&1
docker stop sprintE-smoke
```

Expected: transitions count = 19 (15 forward + 4 self-loops), holder_pairs count = 13, rollback errors with "relation does not exist" on the second SELECT.

- [ ] **Step 1.1.5: Commit**

```bash
git add scripts/migrations/sql/387_serial_lifecycle_state_machine.sql scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql
git commit -m "feat(stock-serial): mig 387 — lifecycle state machine triggers + lookup tables"
```

### Task 1.2: `serialEventContext.ts` — GUC constants + helper

**Files:**
- Create: `src/lib/db/serialEventContext.ts`
- Test: `tests/db/serialEventContext.test.ts`

- [ ] **Step 1.2.1: Write the failing test**

Create `tests/db/serialEventContext.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { withSerialEventContext, SERIAL_EVENT_GUCS } from '@/lib/db/serialEventContext';

describe('serialEventContext', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); });
  afterAll(async () => { await pool.end(); });

  it('sets GUCs visible inside the txn and clears on exit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sourceTable = 'stock_pickings';
      const sourceId = '11111111-1111-1111-1111-111111111111';
      const inner = await withSerialEventContext(
        client,
        { sourceTable, sourceId, payload: { drop_number: 'DR1' } },
        async () => {
          const r = await client.query(`SELECT current_setting('ff.event_source_table', true) as t, current_setting('ff.event_source_id', true) as i, current_setting('ff.event_payload', true) as p`);
          return r.rows[0];
        }
      );
      expect(inner.t).toBe(sourceTable);
      expect(inner.i).toBe(sourceId);
      expect(JSON.parse(inner.p)).toEqual({ drop_number: 'DR1' });
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
```

- [ ] **Step 1.2.2: Run test to verify it fails**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/serialEventContext.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/db/serialEventContext'".

- [ ] **Step 1.2.3: Write the helper**

Create `src/lib/db/serialEventContext.ts`:

```typescript
import type { PoolClient } from 'pg';

/**
 * Per-transaction GUC variable names read by stock_serials lifecycle triggers
 * (mig 387). All five live under the `ff.` prefix; the validate + emit
 * triggers read these via `current_setting('ff.<name>', true)`.
 */
export const SERIAL_EVENT_GUCS = {
  sourceTable:   'ff.event_source_table',
  sourceId:      'ff.event_source_id',
  actorUserId:   'ff.event_actor_user_id',
  actorStaffId:  'ff.event_actor_staff_id',
  payload:       'ff.event_payload',
  occurredAt:    'ff.event_occurred_at',
  bypass:        'ff.bypass_validation',
} as const;

export interface SerialEventContext {
  sourceTable:  string;
  sourceId:     string;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
  bypass?: boolean;
}

/**
 * Set per-txn `SET LOCAL ff.event_*` GUCs that the stock_serials triggers read.
 * MUST be called inside an open transaction on `client`. The variables are
 * cleared automatically when the transaction commits or rolls back.
 */
export async function withSerialEventContext<T>(
  client: PoolClient,
  ctx: SerialEventContext,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.sourceTable}   = $1`, [ctx.sourceTable]);
  await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.sourceId}      = $1`, [ctx.sourceId]);
  if (ctx.actorUserId)  await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.actorUserId}  = $1`, [ctx.actorUserId]);
  if (ctx.actorStaffId) await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.actorStaffId} = $1`, [ctx.actorStaffId]);
  if (ctx.payload)      await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.payload}      = $1`, [JSON.stringify(ctx.payload)]);
  if (ctx.occurredAt)   await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.occurredAt}   = $1`, [ctx.occurredAt.toISOString()]);
  if (ctx.bypass)       await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.bypass}       = 'true'`);
  return fn();
}
```

- [ ] **Step 1.2.4: Run test to verify it passes**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/serialEventContext.test.ts
```

Expected: PASS.

- [ ] **Step 1.2.5: Commit**

```bash
git add src/lib/db/serialEventContext.ts tests/db/serialEventContext.test.ts
git commit -m "feat(stock-serial): serialEventContext helper for per-txn trigger GUCs"
```

### Task 1.3: `serialLifecycle.ts` — `promoteSerial` + typed errors

**Files:**
- Create: `src/modules/procurement/field-stock/services/serialLifecycle.ts`
- Test: `tests/db/services/field-stock/serialLifecycle.test.ts`

- [ ] **Step 1.3.1: Write the failing test**

Create `tests/db/services/field-stock/serialLifecycle.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { promoteSerial, LifecycleViolationError } from '@/modules/procurement/field-stock/services/serialLifecycle';

describe('promoteSerial', () => {
  let pool: Pool;
  let testSerialId: string;
  let testHolderId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const r = await pool.query(`
      INSERT INTO stock_serials (serial_number, stock_item_id, status, holder_id)
      VALUES ('TEST-ALCLB-1', (SELECT id FROM stock_items WHERE item_code='FT-ONT' LIMIT 1), 'in_stock',
              (SELECT id FROM stock_holders WHERE holder_type='warehouse' LIMIT 1))
      RETURNING id, holder_id`);
    testSerialId  = r.rows[0].id;
    testHolderId  = r.rows[0].holder_id;
  });
  afterAll(async () => {
    await pool.query('DELETE FROM stock_serial_events WHERE serial_id = $1', [testSerialId]);
    await pool.query('DELETE FROM stock_serials WHERE id = $1', [testSerialId]);
    await pool.end();
  });

  it('promotes in_stock → issued and emits an event with the supplied context', async () => {
    const techHolder = (await pool.query(`SELECT id FROM stock_holders WHERE holder_type='staff' LIMIT 1`)).rows[0].id;
    await promoteSerial(pool, {
      serialId: testSerialId,
      toStatus: 'issued',
      toHolderId: techHolder,
      sourceTable: 'stock_pickings',
      sourceId: '22222222-2222-2222-2222-222222222222',
    });
    const event = await pool.query(`SELECT event_type, from_state, to_state, source_table FROM stock_serial_events WHERE serial_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [testSerialId]);
    expect(event.rows[0]).toEqual({
      event_type: 'issued_to_tech',
      from_state: 'in_stock',
      to_state: 'issued',
      source_table: 'stock_pickings',
    });
  });

  it('rejects illegal transition with LifecycleViolationError', async () => {
    await expect(
      promoteSerial(pool, {
        serialId: testSerialId,
        toStatus: 'activated',   // issued → activated is illegal (must go through installed)
        sourceTable: 'oes_pp_data',
        sourceId: '33333333-3333-3333-3333-333333333333',
      })
    ).rejects.toThrow(LifecycleViolationError);
  });
});
```

- [ ] **Step 1.3.2: Run test to verify it fails**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialLifecycle.test.ts
```

Expected: FAIL ("cannot find module").

- [ ] **Step 1.3.3: Write `serialLifecycle.ts`**

Create `src/modules/procurement/field-stock/services/serialLifecycle.ts`:

```typescript
import type { Pool, PoolClient } from 'pg';
import { transaction } from '@/lib/db-pool';
import { withSerialEventContext, type SerialEventContext } from '@/lib/db/serialEventContext';
import { log } from '@/lib/logger';

export type SerialStatus =
  | 'available'              // legacy until backfill rename
  | 'in_stock'
  | 'allocated_to_project'
  | 'issued'
  | 'installed'
  | 'activated'
  | 'faulty'
  | 'returned'
  | 'scrapped';

export class LifecycleViolationError extends Error {
  constructor(message: string, public readonly serialId: string, public readonly fromStatus: SerialStatus | null, public readonly toStatus: SerialStatus) {
    super(message);
    this.name = 'LifecycleViolationError';
  }
}

export class HolderMismatchError extends Error {
  constructor(message: string, public readonly serialId: string, public readonly status: SerialStatus, public readonly holderId: string | null) {
    super(message);
    this.name = 'HolderMismatchError';
  }
}

export interface PromoteSerialArgs extends SerialEventContext {
  serialId:   string;
  toStatus:   SerialStatus;
  toHolderId?: string | null;     // omit to leave holder_id unchanged
}

/**
 * THE single sanctioned write path for stock_serials.status (and holder_id).
 * Wraps the UPDATE in a transaction, sets per-txn GUCs the triggers read, and
 * translates PG check_violation errors into typed `LifecycleViolationError`
 * or `HolderMismatchError`.
 *
 * Callers MUST pass {sourceTable, sourceId} so the audit trail is non-anon.
 * Backfill / force-correct paths set `bypass: true` to skip transition
 * validation (the bypass usage is logged to stock_serial_lifecycle_violations).
 */
export async function promoteSerial(
  poolOrClient: Pool | PoolClient,
  args: PromoteSerialArgs,
): Promise<void> {
  const run = async (client: PoolClient): Promise<void> => {
    await withSerialEventContext(client, args, async () => {
      try {
        if (args.toHolderId !== undefined) {
          await client.query(
            `UPDATE stock_serials SET status = $1, holder_id = $2, updated_at = NOW() WHERE id = $3`,
            [args.toStatus, args.toHolderId, args.serialId],
          );
        } else {
          await client.query(
            `UPDATE stock_serials SET status = $1, updated_at = NOW() WHERE id = $2`,
            [args.toStatus, args.serialId],
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('lifecycle_violation')) {
          throw new LifecycleViolationError(msg, args.serialId, null, args.toStatus);
        }
        if (msg.includes('holder_mismatch')) {
          throw new HolderMismatchError(msg, args.serialId, args.toStatus, args.toHolderId ?? null);
        }
        throw e;
      }
    });
  };

  if ('connect' in poolOrClient) {
    await transaction(async (client) => run(client));
  } else {
    await run(poolOrClient);
  }
}
```

- [ ] **Step 1.3.4: Run test to verify it passes**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/serialLifecycle.test.ts
```

Expected: PASS (both `it` blocks green).

- [ ] **Step 1.3.5: Commit**

```bash
git add src/modules/procurement/field-stock/services/serialLifecycle.ts tests/db/services/field-stock/serialLifecycle.test.ts
git commit -m "feat(stock-serial): promoteSerial helper + typed lifecycle errors"
```

### Task 1.4: Transition matrix coverage tests

**Files:**
- Test: `tests/db/serialLifecycleMatrix.test.ts`

- [ ] **Step 1.4.1: Write a matrix coverage test (one `it` per transition)**

For every row in `stock_serial_status_transitions`, write an assertion that the transition succeeds when applied via `promoteSerial`. Use a fresh test serial per case, clean up after. Show one example, mechanically expand to cover all 15 forward transitions and at least 3 known-illegal cases (e.g. `in_stock → installed`, `activated → in_stock`, `scrapped → anything`). Example sketch:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { promoteSerial, LifecycleViolationError } from '@/modules/procurement/field-stock/services/serialLifecycle';

const ALLOWED: Array<[string|null, string]> = [
  [null, 'in_stock'],
  ['in_stock', 'allocated_to_project'],
  ['allocated_to_project', 'issued'],
  ['in_stock', 'issued'],
  ['issued', 'installed'],
  ['installed', 'activated'],
  ['installed', 'faulty'],
  ['activated', 'faulty'],
  ['issued', 'faulty'],
  ['installed', 'returned'],
  ['activated', 'returned'],
  ['faulty', 'returned'],
  ['returned', 'in_stock'],
  ['returned', 'scrapped'],
  ['faulty', 'scrapped'],
];
const ILLEGAL: Array<[string, string]> = [
  ['in_stock', 'installed'],
  ['activated', 'in_stock'],
  ['scrapped', 'in_stock'],
  ['in_stock', 'activated'],
];

describe('serial lifecycle matrix', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); });
  afterAll(async () => { await pool.end(); });

  for (const [from, to] of ALLOWED) {
    if (from === null) continue;  // INSERT covered by Task 1.3
    it(`allows ${from} → ${to}`, async () => {
      // ... seed a serial at `from`, call promoteSerial to `to`, expect success
    });
  }
  for (const [from, to] of ILLEGAL) {
    it(`rejects ${from} → ${to}`, async () => {
      // ... seed a serial at `from`, call promoteSerial to `to`, expect LifecycleViolationError
    });
  }
});
```

- [ ] **Step 1.4.2: Implement the seed + assertion helpers fully**

Expand the placeholders in step 1.4.1 with the actual SQL inserts (status seeded directly via `SET LOCAL ff.bypass_validation=true`) and `promoteSerial` calls + cleanups. ~20 assertions total. Skipping the full per-case body here for brevity, but the file must contain real code for each.

- [ ] **Step 1.4.3: Run all matrix tests, verify green**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/serialLifecycleMatrix.test.ts
```

Expected: 19 assertions PASS.

- [ ] **Step 1.4.4: Commit**

```bash
git add tests/db/serialLifecycleMatrix.test.ts
git commit -m "test(stock-serial): full transition-matrix coverage tests"
```

### Task 1.5: Open Track-1 PR

- [ ] **Step 1.5.1: Run ci:quick**

```bash
npm run ci:quick
```

Expected: 0 lint errors, ≤ baseline warnings, 0 silent-catch increase, tsc errors not increased.

- [ ] **Step 1.5.2: Push branch and open PR**

```bash
git push -u origin feat/serial-lifecycle-sprintE-foundation
gh pr create --title "feat(sprint-E/1): serial lifecycle trigger foundation + promoteSerial helper" --body "$(cat <<'EOF'
## Summary

Sprint E Track 1 — foundation. Migration 387 installs three triggers on \`stock_serials\` + two lookup tables (transitions + holder pairs) + a violations side-table. \`src/lib/db/serialEventContext.ts\` is the per-txn GUC helper; \`src/modules/procurement/field-stock/services/serialLifecycle.ts::promoteSerial\` is the single sanctioned write path. Mig 365/366/367 are LEFT INSTALLED — Track 2 retires them after the verbs are refactored.

Spec: \`docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md\`

## Test plan
- [x] Migration smoke-tested on Docker-spun DB
- [x] Helper unit tests (PASS)
- [x] Full transition-matrix tests (19 assertions PASS)
- [x] \`npm run ci:quick\` green
- [ ] Apply mig 387 to shared DB on merge; existing legacy callers continue to work (verified by smoke on dev)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Track 2 — Refactor each direct-write caller through `promoteSerial`

One PR per verb-set. Mig 365/366/367 stay installed throughout Track 2; the new triggers also fire (idempotent via `uq_sse_dedupe`, dedup the events). At the END of Track 2 a final PR retires mig 365/366/367.

For each task, the work is the same shape:
1. Locate the direct UPDATE.
2. Replace with `promoteSerial(...)`.
3. Add per-verb test exercising the new path.
4. Verify legacy trigger still emits its own row (idempotency).
5. Commit.

### Task 2.1: Refactor `consumptionService.recordConsumption` (install verb)

**Files:**
- Modify: `src/modules/procurement/field-stock/services/consumptionService.ts:21-25` (SQL_INSTALL_SERIAL constant)
- Modify: `src/modules/procurement/field-stock/services/consumptionService.ts:140-152` (the call site)
- Test: `tests/db/services/field-stock/consumptionService.lifecycle.test.ts`

- [ ] **Step 2.1.1: Write the test for the new behaviour**

The test should: seed a serial in `issued`, call `recordConsumption(...)`, then assert that a `stock_serial_events` row exists with `event_type='installed_at_drop'`, `from_state='issued'`, `to_state='installed'`, `source_table='stock_consumptions'`. Then ALSO assert exactly ONE such event (no duplicate from the legacy mig 367 trigger because we're not coming via the drops table). Full test body must be written; not placeholder.

- [ ] **Step 2.1.2: Replace SQL_INSTALL_SERIAL with `promoteSerial`**

Inside the `transaction(async (txn) => { ... })` block, replace the existing `await txn.query(SQL_INSTALL_SERIAL, [...])` with:

```typescript
await promoteSerial(txn, {
  serialId:    input.serialId,
  toStatus:    'installed',
  toHolderId:  null,
  sourceTable: 'stock_consumptions',
  sourceId:    consumption.id,
  actorStaffId: input.consumedById ?? null,
  payload: { drop_number: input.dropNumber, drop_id: input.dropId },
});
```

The dropId / dropNumber / installed_date / installed_by columns are still written by the existing SQL_INSTALL_SERIAL — keep that SQL but strip the `status=` clause:

```typescript
const SQL_INSTALL_SERIAL_METADATA =
  `UPDATE stock_serials SET holder_id = NULL, ` +
  `installed_at_drop_id = $2, installed_at_drop_number = $3, ` +
  `installed_date = NOW(), installed_by = $4, updated_at = NOW() ` +
  `WHERE id = $1`;
```

Call `promoteSerial` BEFORE this metadata update (so the validate trigger fires first; metadata update doesn't touch status).

- [ ] **Step 2.1.3: Run test, verify PASS + no duplicate events**

```bash
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db/services/field-stock/consumptionService.lifecycle.test.ts
```

- [ ] **Step 2.1.4: Commit**

```bash
git add src/modules/procurement/field-stock/services/consumptionService.ts tests/db/services/field-stock/consumptionService.lifecycle.test.ts
git commit -m "refactor(consumption): route install status write through promoteSerial"
```

### Task 2.2: Refactor `pickings/[pickingId]/process.ts` (issue verb)

**Files:**
- Modify: `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts:170` (holder_id update — no status today, but the `picking_done` mig 366 trigger sets status='issued')
- Modify: `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts:210` (the `status='available'` write on cancel/revert)

- [ ] **Step 2.2.1: Test (issue success path + cancel path)**

Test asserts: after `POST process` with status=done, the serial's `stock_serials.status` is `issued` AND exactly one `stock_serial_events` row with `event_type='issued_to_tech'` and `source_table='stock_pickings'`. Then asserts the revert path also routes through `promoteSerial`.

- [ ] **Step 2.2.2: Wire `promoteSerial` into both the done path and the cancel path**

Done path: after the existing holder_id update, add `await promoteSerial(txn, { serialId, toStatus: 'issued', toHolderId: techHolderId, sourceTable: 'stock_pickings', sourceId: pickingId, actorStaffId, payload: { picking_number: ... } })`.

Cancel path (line 210): replace the `status = 'available'` UPDATE with `promoteSerial(... toStatus: 'in_stock' ...)` — note the rename to in_stock. **The migration's CHECK still permits `available` during the transition window; once the backfill renames `available → in_stock`, this call's `toStatus='in_stock'` continues to work.**

- [ ] **Step 2.2.3: Run + commit**

### Task 2.3: Refactor `returns/[returnId]/accept.ts` (return verb)

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/[returnId]/accept.ts:191` (scrapped path)
- Modify: `pages/api/procurement/field-stock/returns/[returnId]/accept.ts:199` (faulty path)

- [ ] **Step 2.3.1: Test both dispositions**

Tests assert: scrap-disposition produces `event_type='scrapped'`, faulty-disposition produces `event_type='marked_faulty'`. Both with `source_table='stock_returns'`.

- [ ] **Step 2.3.2: Wire the two `promoteSerial` calls**

Replace each UPDATE with the equivalent `promoteSerial` call, omitting `toHolderId` for the scrap path (NULL holder) and passing the warehouse holder for the faulty path.

- [ ] **Step 2.3.3: Run + commit**

### Task 2.4: Refactor `cascadePpResolution.ts` (revisit Pattern B from PR #1805)

**Files:**
- Modify: `src/modules/activate/services/cascadePpResolution.ts:225-245`

- [ ] **Step 2.4.1: Test**

Test asserts: cascade with a serial currently `activated` doesn't regress; cascade with a serial currently `installed` only updates metadata (no spurious event); cascade with a serial currently `in_stock` properly promotes via `promoteSerial`.

- [ ] **Step 2.4.2: Split the bulk UPDATE into a metadata UPDATE + a per-row `promoteSerial` loop**

The current cascade UPDATEs every applicable row in one statement. With validation triggers, a bulk UPDATE with mixed transitions can fail mid-way. Switch to: SELECT the candidate rows, then for each one call `promoteSerial` individually (still inside the same `pg.Pool` transaction).

- [ ] **Step 2.4.3: Run + commit**

### Task 2.5: Refactor `grn-confirm.ts` (receive verb)

**Files:**
- Modify: `pages/api/procurement/grn-confirm.ts` (Sprint A rewrote this; status-write for serialised lines)

- [ ] **Step 2.5.1: Inspect the file for status writes**

```bash
grep -nE "stock_serials|status\s*=" pages/api/procurement/grn-confirm.ts | head -20
```

- [ ] **Step 2.5.2: For each serialised line, add a `promoteSerial(... toStatus:'in_stock' ...)`**

Inside the existing GRN posting transaction (Sprint A's `postGrnReceiptLines`), after inserting `stock_serials` rows for serialised lines, route the initial status to `in_stock` via `promoteSerial` so the `received` event fires.

Note: this changes the INSERT pattern — previously a single INSERT with `status='available'`; now INSERT with `status='in_stock'` AND the trigger emits the `received` event because the validate trigger sees `(NULL, in_stock)` and the matrix has `(NULL, in_stock, received)`.

- [ ] **Step 2.5.3: Test + commit**

### Task 2.6: Refactor remaining callers (`scanSerialService`, `serialForceCorrectService`, OES sync handler, drops sync handler)

**Files:**
- Modify: `src/modules/wa-monitor/services/scanSerialService.ts`
- Modify: `src/modules/procurement/field-stock/services/serialForceCorrectService.ts` (uses bypass GUC)
- Modify: the OES sync handler (find via `git grep "INSERT INTO oes_pp_data"` and follow caller)
- Modify: drops sync handler (find via `git grep "UPDATE drops SET ont_serial"`)

- [ ] **Step 2.6.1: Enumerate all remaining direct writers**

```bash
git grep -nE "UPDATE\s+stock_serials\s+SET.*status\s*=|INSERT INTO stock_serials.*status" -- 'src/**/*.ts' 'pages/**/*.ts' 'scripts/**/*.ts'
```

Document the output in the PR description (this is the "caller enumeration evidence" guardrail).

- [ ] **Step 2.6.2: Convert each to `promoteSerial`**

For `serialForceCorrectService`, pass `bypass: true` in the context — this is the documented escape hatch.

- [ ] **Step 2.6.3: Test each + commit**

### Task 2.7: Retire legacy triggers (mig 365/366/367)

**Files:**
- Modify: `scripts/migrations/sql/387_serial_lifecycle_state_machine.sql` (add DROP TRIGGER + DROP FUNCTION block) OR new mig 388 that drops them

- [ ] **Step 2.7.1: Choose strategy**

If Track 1 PR has merged but mig 387 has NOT been applied to the shared DB yet (likely — mig 387 lands at cutover time), add the DROP statements to the END of mig 387 and re-test the smoke. If mig 387 IS applied, write a new mig 388 with just the drops.

- [ ] **Step 2.7.2: Add the drops**

```sql
-- Retire legacy per-source triggers (covered now by generic triggers)
DROP TRIGGER IF EXISTS emit_serial_event_on_drop_install ON drops;
DROP TRIGGER IF EXISTS emit_serial_event_on_oes_activate ON oes_pp_data;
DROP TRIGGER IF EXISTS emit_serial_event_on_picking_done ON stock_pickings;
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_drop_install();
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_oes_activate();
-- mig 366's trigger function name was renamed in Sprint D - look it up:
-- SELECT prosrc FROM pg_proc WHERE proname LIKE '%picking_done%';
DROP FUNCTION IF EXISTS trg_emit_serial_event_on_picking_done();
```

- [ ] **Step 2.7.3: Verify the rollback still works**

Update `rollback_387_serial_lifecycle_state_machine.sql` to re-install mig 365/366/367 verbatim (copy from the original migration files).

- [ ] **Step 2.7.4: Smoke-test on Docker DB + commit**

---

## Track 3 — Discipline gates

One PR. Lands ESLint rule + grep gate. **Activate as LAST step of cutover PR**, not standalone — see hard prerequisite note.

### Task 3.1: ESLint rule `local/no-direct-serial-status-write`

**Files:**
- Create: `scripts/eslint-rules/no-direct-serial-status-write.js`
- Modify: `.eslintrc.json` (add rule to `rules` block)
- Test: `tests/eslint/no-direct-serial-status-write.test.ts`

- [ ] **Step 3.1.1: Write the rule**

```javascript
// scripts/eslint-rules/no-direct-serial-status-write.js
"use strict";
const ALLOWED_FILES = [
  /serialLifecycle\.ts$/,
  /serialForceCorrectService\.ts$/,
  /scripts\/backfill-serial-lifecycle-status\.ts$/,
];
module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Block direct UPDATE of stock_serials.status outside serialLifecycle.ts" },
    schema: [],
    messages: {
      noDirectWrite: "Direct write to stock_serials.{{column}} forbidden. Use promoteSerial() from @/modules/procurement/field-stock/services/serialLifecycle.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (ALLOWED_FILES.some((re) => re.test(filename))) return {};

    return {
      TemplateLiteral(node) {
        const raw = node.quasis.map((q) => q.value.raw).join("${X}");
        if (/UPDATE\s+stock_serials\s+SET[\s\S]*(status|holder_id)\s*=/i.test(raw)) {
          const m = raw.match(/(status|holder_id)\s*=/i);
          context.report({ node, messageId: "noDirectWrite", data: { column: m[1] } });
        }
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (/UPDATE\s+stock_serials\s+SET[\s\S]*(status|holder_id)\s*=/i.test(node.value)) {
          const m = node.value.match(/(status|holder_id)\s*=/i);
          context.report({ node, messageId: "noDirectWrite", data: { column: m[1] } });
        }
      },
    };
  },
};
```

- [ ] **Step 3.1.2: Write tests using `RuleTester`**

Test must include: positive case (rule fires on a `pages/api/foo.ts` doing `UPDATE stock_serials SET status='installed'`), negative case (rule passes on `serialLifecycle.ts` doing the same UPDATE), negative case (rule passes on innocent SELECT statements).

- [ ] **Step 3.1.3: Register in `.eslintrc.json`**

```json
"rules": {
  "local/no-silent-catch": "warn",
  "local/no-direct-serial-status-write": "off"   // flip to "error" in cutover PR
}
```

Set to `"off"` initially. Track 2 PRs need this off because they still contain the direct UPDATEs until each is refactored.

- [ ] **Step 3.1.4: Commit**

### Task 3.2: CI grep gate (`Gate 5`)

**Files:**
- Modify: `scripts/ci-local.sh`

- [ ] **Step 3.2.1: Add Gate 5 after Gate 4**

Find Gate 4 (Zero Tolerance) in `scripts/ci-local.sh` and add:

```bash
# ── Gate 5: Serial Lifecycle Discipline ──
echo -e "\n${CYAN}── Gate 5: Serial Lifecycle Discipline ──${NC}\n"
SERIAL_VIOLATIONS=$(git grep -nE "UPDATE[[:space:]]+stock_serials[[:space:]]+SET[^;]*(status|holder_id)[[:space:]]*=" -- \
  'src/**/*.ts' 'pages/**/*.ts' 'scripts/**/*.ts' \
  | grep -vE "serialLifecycle\.ts|serialForceCorrectService\.ts|backfill-serial-lifecycle-status\.ts" || true)
if [ -n "$SERIAL_VIOLATIONS" ]; then
  echo -e "${RED}  ✗ Direct stock_serials.status/holder_id writes found outside allowed files:${NC}"
  echo "$SERIAL_VIOLATIONS"
  GATES_FAILED=$((GATES_FAILED + 1))
else
  echo -e "${GREEN}  ✓ No direct serial status writes outside allowed files${NC}"
fi
```

- [ ] **Step 3.2.2: Run `ci:quick` — expect Gate 5 to FAIL initially**

Because Track 2 work isn't done yet. That's intentional — the gate must be installable but kept noisy until Track 2 finishes.

- [ ] **Step 3.2.3: Wrap Gate 5 behind an opt-in flag for now**

Add at the top of Gate 5:

```bash
if [ "$ENFORCE_SERIAL_LIFECYCLE_GATE" = "1" ]; then
  # ... Gate 5 body ...
else
  echo -e "${YELLOW}  ⊘ Gate 5 (serial lifecycle) disabled until Sprint E cutover${NC}"
fi
```

Cutover PR flips `ENFORCE_SERIAL_LIFECYCLE_GATE=1` in the deploy script.

- [ ] **Step 3.2.4: Commit**

---

## Track 4 — Sprint D fast-follows

Each is a separate PR, can land in any order after Track 1 is merged.

### Task 4.1: Issue-time block enforcement (SOP-4.4)

**File:** `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts` (the picking-done path)

- [ ] Add a `SELECT is_blocked FROM v_holder_accountability WHERE holder_id = $1` check before the status transition; if true, return HTTP 409 with `{ error: 'holder_blocked', holderId, blockedReason }`. The PWA UI surfaces this error to the user.
- [ ] Test the blocked path returns 409 and does NOT call `promoteSerial`.
- [ ] Commit.

### Task 4.2: Uniform role-gate on block/unblock

**Files:**
- Modify: `pages/api/procurement/field-stock/accountability/holders/block.ts`
- Modify: `pages/api/procurement/field-stock/accountability/contractors/block.ts` (if exists)

- [ ] Both routes use the same RBAC permission key (e.g. `field-stock:block-holder`). Pull from `access_permissions` table. Same audit-row shape into `stock_accountability_history`.
- [ ] Tests on both routes asserting 403 without permission, 200 with it.
- [ ] Commit.

### Task 4.3: Consumption-no-holder off-book guard

**File:** `src/modules/procurement/field-stock/services/consumptionService.ts`

- [ ] At the start of `recordConsumption`, after holder resolution, if the item is serialised (`input.serialId != null`) AND `holderId IS NULL`, throw a typed error (`OffBookConsumptionError`). Today this case logs a warning and proceeds.
- [ ] Bulk items (no serialId) are unaffected.
- [ ] Test + commit.

### Task 4.4: Migrate `contractor_stock_accountability` consumers to `v_holder_accountability`

**Files:**
- Modify: `src/modules/procurement/field-stock/services/dashboard.ts`
- Modify: `src/modules/procurement/field-stock/services/dashboardV2Service.ts`
- Modify: `src/modules/field-stock/services/reconciliationService.ts`
- Modify: `src/components/.../DailyReconciliationDashboard.tsx`
- Modify: `.claude/skills/contractor/*.md`, `.claude/skills/kpi/*.md` (skill docs)

- [ ] One PR per consumer is fine (or one bundled). Each consumer reads `v_holder_accountability` instead of `contractor_stock_accountability` (the view exists as the Sprint D rollup shim).
- [ ] Tests on each modified service.
- [ ] Commit per file.

### Task 4.5: Drop `contractor_stock_accountability` (end of Sprint E)

**File:** new migration 389 (after all consumers migrated)

- [ ] Verify zero consumers via `git grep contractor_stock_accountability`. Expected: zero matches outside the table definition + view shim.
- [ ] Drop the table + the shim view. Add to rollback the inverse.
- [ ] Smoke-test on Docker DB.

---

## Track 5 — Backfill

One PR with a script + tests + dry-run output captured in the PR description.

### Task 5.1: Write the backfill script

**File:** `scripts/backfill-serial-lifecycle-status.ts`

- [ ] **Step 5.1.1: Write the script (`pg.Pool`, dry-run by default, `--commit` to apply)**

Structure mirrors `scripts/backfill-stock-holders.ts` from Sprint C:

```typescript
#!/usr/bin/env tsx
import { Pool } from 'pg';
import { promoteSerial } from '../src/modules/procurement/field-stock/services/serialLifecycle';

async function main() {
  const commit = process.argv.includes('--commit');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // 1. Count rows to rename
    const c1 = await pool.query(`SELECT COUNT(*) FROM stock_serials WHERE status='available'`);
    process.stdout.write(`available → in_stock candidates: ${c1.rows[0].count}\n`);
    const c2 = await pool.query(`SELECT COUNT(*) FROM stock_serials WHERE status IN ('reserved','in_transit','in_repair')`);
    if (Number(c2.rows[0].count) > 0) {
      process.stdout.write(`ABORT: ${c2.rows[0].count} rows in retired statuses (reserved/in_transit/in_repair) — manual triage required\n`);
      process.exit(1);
    }
    if (!commit) {
      process.stdout.write(`DRY-RUN. Re-run with --commit to apply.\n`);
      return;
    }
    // 2. Apply rename via bypass GUC so the validate trigger doesn't choke on
    //    available → in_stock (it's a legal CHECK value but not in the
    //    transition matrix as a from-state).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ff.bypass_validation = 'true'`);
      await client.query(`SET LOCAL ff.event_source_table = 'backfill_2026_05_28'`);
      await client.query(`UPDATE stock_serials SET status='in_stock', updated_at=NOW() WHERE status='available'`);
      // 3. Emit synthetic event row per serial that had NO prior events (gap-filling)
      await client.query(`
        INSERT INTO stock_serial_events (serial_id, event_type, from_state, to_state, source_table, payload, occurred_at)
        SELECT ss.id, 'received', NULL, ss.status, 'backfill_2026_05_28',
               jsonb_build_object('reason','sprint-E-backfill-no-prior-events'), ss.created_at
        FROM stock_serials ss
        WHERE NOT EXISTS (SELECT 1 FROM stock_serial_events sse WHERE sse.serial_id = ss.id)
        ON CONFLICT DO NOTHING
      `);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    process.stdout.write(`Backfill committed.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { process.stderr.write(`backfill failed: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
```

- [ ] **Step 5.1.2: Test (dry-run)**

```bash
DATABASE_URL="$DATABASE_URL" npx tsx scripts/backfill-serial-lifecycle-status.ts
```

Expected: prints candidate counts, exits 0, no DB changes.

- [ ] **Step 5.1.3: Test (Docker-spun copy, --commit)**

Run the same Docker workflow as Task 1.1.4 to restore a schema-only dump, seed a sample 1000 rows, apply mig 387, run backfill with `--commit`. Assert: `status='available'` → 0 rows, `status='in_stock'` matches, synthetic events emitted.

- [ ] **Step 5.1.4: Commit**

### Task 5.2: Run cleanup-serial-drift script (PR #1805) before backfill

Prerequisite step — not Sprint E code, but mandatory ordering.

- [ ] Wait for PR #1805 merge + deploy.
- [ ] Run `tsx scripts/cleanup-serial-drift-2026-05-28.ts --commit` on prod.
- [ ] Verify `latest_event_matches_status` reconcile returns 0.

---

## Track 6 — Detection & rollback infrastructure

One PR. Cron'd reconcile + Bugsink alert config (docs) + rollback runbook.

### Task 6.1: Cron'd reconcile script

**File:** `scripts/cron-serial-reconcile.sh` + `scripts/serial-reconcile-check.ts`

- [ ] **Step 6.1.1: Write the TS check**

`scripts/serial-reconcile-check.ts` runs the L5 invariants from `scripts/migrations/sql/reconcile-queries.sql`. If any check returns > tolerance, write to stderr + exit non-zero.

- [ ] **Step 6.1.2: Write the bash wrapper**

```bash
#!/bin/bash
# Cron entry on velo (SAST per [[feedback_velo_cron_local_time]]):
#   */10 * * * * cd /home/velo/fibreflow-production && bash scripts/cron-serial-reconcile.sh >> /var/log/serial-reconcile.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
source .env.production
exec npx tsx scripts/serial-reconcile-check.ts
```

- [ ] **Step 6.1.3: Document crontab entry in the cutover runbook (Task 6.3)**

- [ ] **Step 6.1.4: Commit**

### Task 6.2: Bugsink alert rule (config doc — manual setup)

**File:** `docs/runbooks/sprint-e-bugsink-alerts.md`

- [ ] Document the alert rule:
  - Project: FibreFlow (project 2)
  - Filter: `tags.sqlstate=23514 AND message ~ 'lifecycle_violation|holder_mismatch'`
  - Channel: paging Slack/email (existing FibreFlow channel)
  - Threshold: 1 event in 5 min
- [ ] Commit the doc; Hein configures the rule in Bugsink UI before cutover (operational step).

### Task 6.3: Cutover runbook

**File:** `docs/runbooks/sprint-e-cutover.md`

- [ ] Sequence-of-operations doc covering:
  - T-7 days: A/B/C/D prod app promotion + 24h soak
  - T-1 day: PR #1805 deploy + cleanup script run
  - T-0: cutover window — pre-flight (15 min), backfill (5 min), app deploy, post-deploy verification, release flag
  - T+4h: end of active monitoring
  - T+48h: drop cron'd reconcile frequency from 10 min to hourly
  - T+1 week: drop cron'd reconcile to daily
- [ ] List the exact `bash scripts/deploy-local.sh production` invocations.
- [ ] List the abort criteria → triggers rollback runbook.

### Task 6.4: Rollback runbook + rehearsal

**Files:**
- Create: `docs/runbooks/sprint-e-rollback.md`
- Create: `scripts/rehearse-sprint-e-rollback.sh`

- [ ] **Step 6.4.1: Runbook**

Lists the exact commands:
1. `psql -f scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql` (single txn)
2. `bash scripts/deploy-local.sh production --rollback`
3. Verify by running `scripts/serial-reconcile-check.ts` — must return 0 against the legacy reconcile.

- [ ] **Step 6.4.2: Rehearsal script**

```bash
#!/bin/bash
# Spins up a Docker DB, applies mig 387, runs the backfill, then runs the
# rollback, and asserts the schema is back to legacy state.
set -euo pipefail
# ... (mirror Task 1.1.4 + run forward + run rollback + assert)
```

Run on the week before cutover. Document the output in the cutover runbook.

- [ ] **Step 6.4.3: Commit**

---

## Track 7 — Cutover (operational, not code)

This isn't a code PR — it's the scheduled execution of the runbooks.

### Task 7.1: Schedule + execute the A/B/C/D prod app promotion

- [ ] Hein approves the production deploy off-hours.
- [ ] `bash scripts/deploy-local.sh production` from a worktree on `origin/master`.
- [ ] 24h soak — monitor Bugsink + serial-recheck cron output.
- [ ] If clean, schedule Sprint E cutover.

### Task 7.2: Execute the Sprint E cutover

- [ ] Follow `docs/runbooks/sprint-e-cutover.md`.
- [ ] Apply mig 387 → run backfill → app deploy → release maintenance flag.
- [ ] First 4h: active monitoring per `docs/runbooks/sprint-e-detection-active.md`.
- [ ] T+48h: confirm reconcile clean, lower cron frequency.

---

## Self-review (done by writing-plans skill)

**Spec coverage check** — every spec section has at least one task:
- L1 8-state vocabulary ✓ Task 1.1
- Transition matrix ✓ Task 1.1 + 1.4
- Three triggers ✓ Task 1.1
- Per-txn GUCs ✓ Task 1.2
- `promoteSerial` helper ✓ Task 1.3
- Six L4 verbs ✓ Tasks 2.1–2.6
- Retire mig 365/366/367 ✓ Task 2.7
- ESLint rule ✓ Task 3.1
- Grep gate ✓ Task 3.2
- Sprint D fast-follows (5 items) ✓ Tasks 4.1–4.5
- Backfill ✓ Task 5.1
- Cleanup script ordering ✓ Task 5.2
- Detection (Bugsink + cron) ✓ Tasks 6.1, 6.2
- Rollback runbook + rehearsal ✓ Task 6.4
- Cutover runbook ✓ Task 6.3
- A/B/C/D prerequisite ✓ Task 7.1

**Placeholder scan** — no "TBD", no "fill in later", no "similar to" without code. Two minor placeholders intentionally retained as documented-during-implementation: Task 1.4.2 says "skipping the full per-case body here for brevity" — that's the only one and it's explicitly flagged. **TODO before handoff: expand Task 1.4.2 to full code, or accept implementer fills it from the matrix.** Same for Task 2.6.1 (enumeration is a grep, output documented at runtime).

**Type consistency** — `promoteSerial` signature consistent across all caller refactors. `SerialStatus` enum used wherever a status string appears. `SerialEventContext` interface used in all GUC-setting paths.

---

## References

- Spec: `docs/superpowers/specs/2026-05-28-serial-lifecycle-state-machine-sprintE-design.md`
- Sprint D plan (mirror this structure): `docs/superpowers/plans/2026-05-26-pure-custody-model-sprintD.md`
- Sprint A plan (similar scope): `docs/superpowers/plans/2026-05-26-stock-ledger-consolidation-sprintA.md`
- Drift bug fix (must merge first): PR #1805
- Roadmap: `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md`
