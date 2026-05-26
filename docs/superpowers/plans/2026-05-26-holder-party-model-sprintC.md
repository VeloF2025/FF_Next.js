# Holder / Party Model (Sprint C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `stock_holders` — a thin, typed custody-identity registry — with a resolver service, a dual-write hook keeping it live, and an idempotent backfill of the 5 existing holders, leaving sub-project D a clean single FK to build custody on.

**Architecture:** A new `stock_holders` table (migration 383) with typed nullable FKs (`staff_id`/`contractor_id`) + a CHECK that the populated FK matches `holder_type ∈ {staff, contractor, external_person}` — referential integrity the roadmap's polymorphic `ref_id` could not give. A `stockHolderService` exposes get-or-create resolvers built on a small injectable executor (mirrors Sprint A's `postGrnReceiptLines` testability). `getOrCreateTechnicianLocation` gains a best-effort dual-write so new technician locations register their staff holder. A dry-run/`--commit` backfill seeds the 5 existing holders.

**Tech Stack:** PostgreSQL (self-hosted Supabase, shared dev+prod), TypeScript, `pg.Pool` via `@/lib/db-pool`, Vitest, tsx CLI scripts.

**Spec:** `docs/superpowers/specs/2026-05-26-holder-party-model-sprintC-design.md`
**Worktree/branch:** `/home/hein/Workspace/FF_Next.js-ff-holder-party-model` on `feat/ff-holder-party-model` (off `origin/master` `2e11e938e`).

**Pre-flight (run once before Task 1):**
```bash
ln -sf /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-ff-holder-party-model/node_modules
cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npm ci   # only if the symlinked node_modules is empty (recurring wipe)
```
`PGPASSWORD`/connection for the shared DB are in `.claude/credentials.local.md` (host `100.96.203.105:5437`, user `postgres`, db `fibreflow`). Never hardcode them in committed files.

---

### Task 1: Migration 383 — `stock_holders` table + rollback

**Files:**
- Create: `scripts/migrations/sql/383_stock_holders.sql`
- Create: `scripts/migrations/sql/rollback_383_stock_holders.sql`

- [ ] **Step 1: Re-confirm the version is still free (shared DB; parallel sessions)**

Run:
```bash
export PGPASSWORD=<from .claude/credentials.local.md>
psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA -c "SELECT MAX(version) FROM migrations;"
gh pr list --state open --search "migration in:title" --limit 20
```
Expected: MAX = `382`, no open migration PRs. If MAX ≥ 383, bump the new file's number and the `INSERT INTO migrations` version to MAX+1 consistently.

- [ ] **Step 2: Write the migration**

`scripts/migrations/sql/383_stock_holders.sql`:
```sql
-- 383_stock_holders.sql
-- Sprint C: typed custody-identity registry (holder / party model).
-- See docs/superpowers/specs/2026-05-26-holder-party-model-sprintC-design.md
BEGIN;

CREATE TABLE IF NOT EXISTS stock_holders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_type   text NOT NULL,
  staff_id      uuid REFERENCES staff(id),
  contractor_id uuid REFERENCES contractors(id),
  name          text NOT NULL,
  phone         text,
  email         text,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_holders_type_chk CHECK (holder_type IN ('staff','contractor','external_person')),
  CONSTRAINT stock_holders_ref_chk CHECK (
       (holder_type = 'staff'           AND staff_id IS NOT NULL AND contractor_id IS NULL)
    OR (holder_type = 'contractor'      AND contractor_id IS NOT NULL AND staff_id IS NULL)
    OR (holder_type = 'external_person' AND staff_id IS NULL AND contractor_id IS NULL)
  )
);

-- One holder per person / org. Partial unique indexes double as ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS stock_holders_staff_uk
  ON stock_holders (staff_id) WHERE holder_type = 'staff';
CREATE UNIQUE INDEX IF NOT EXISTS stock_holders_contractor_uk
  ON stock_holders (contractor_id) WHERE holder_type = 'contractor';

INSERT INTO migrations (version, name, executed_at)
VALUES ('383', 'stock_holders', NOW());

COMMIT;
```

- [ ] **Step 3: Write the rollback**

`scripts/migrations/sql/rollback_383_stock_holders.sql`:
```sql
-- rollback_383_stock_holders.sql
BEGIN;
DROP TABLE IF EXISTS stock_holders;   -- cascades its indexes
DELETE FROM migrations WHERE version = '383';
COMMIT;
```

- [ ] **Step 4: Apply to the shared DB**

> NOTE: this is the shared dev+prod Supabase DB. The change is purely additive (a new empty table) — zero risk to existing data — but surface it to Hein before running, per the deploy rules.

Run:
```bash
export PGPASSWORD=<pw>
psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -f scripts/migrations/sql/383_stock_holders.sql
```
Expected: `BEGIN … CREATE TABLE … CREATE INDEX … INSERT 0 1 … COMMIT` with no error.

- [ ] **Step 5: Verify table, indexes, and CHECK (the negative test)**

Run:
```bash
PSQL="psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA"
$PSQL -c "\d stock_holders" | grep -E "holder_type|staff_id|contractor_id|stock_holders_ref_chk|_uk"
# Negative test: a contractor holder carrying a staff_id must be rejected.
$PSQL -c "INSERT INTO stock_holders (holder_type, staff_id, contractor_id, name) VALUES ('contractor', gen_random_uuid(), gen_random_uuid(), 'bad');" 2>&1 | grep -i "stock_holders_ref_chk"
# Negative test: an external_person with a staff_id must be rejected.
$PSQL -c "INSERT INTO stock_holders (holder_type, staff_id, name) VALUES ('external_person', gen_random_uuid(), 'bad');" 2>&1 | grep -i "stock_holders_ref_chk"
```
Expected: the `\d` output shows both partial unique indexes + the ref CHECK; both bad INSERTs fail citing `stock_holders_ref_chk`. (The staff_id in the first uses a random uuid → it will fail the FK or the CHECK; if it errors on the FK first, repeat using `holder_type='contractor', staff_id=(SELECT id FROM staff LIMIT 1), contractor_id=(SELECT id FROM contractors LIMIT 1)` to force the CHECK path.)

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && git add scripts/migrations/sql/383_stock_holders.sql scripts/migrations/sql/rollback_383_stock_holders.sql && git commit -m "feat(stock): migration 383 — stock_holders custody-identity registry"
```

---

### Task 2: `stockHolderService` — types, resolvers, dual-write helper

**Files:**
- Create: `src/modules/procurement/field-stock/services/stockHolderService.ts`
- Test: `tests/services/stock/stockHolderService.test.ts`

Design notes:
- `name` is **required** on every get-or-create (the column is NOT NULL and every call site has it — dual-write passes `technicianName`, backfill passes `assigned_to_name`). The spec's `name?` was illustrative; the plan tightens it.
- Core functions take an injectable `HolderExecutor` (mirrors Sprint A `postGrnReceiptLines(txn, …)`), so tests assert emitted SQL + params with a fake — no live DB.
- Public wrappers bind the core to the `@/lib/db-pool` singleton.

- [ ] **Step 1: Write the failing tests**

`tests/services/stock/stockHolderService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import {
  upsertStaffHolderWith,
  upsertContractorHolderWith,
  getOrCreateExternalHolderWith,
  syncTechnicianHolderWith,
  rowToHolder,
  type HolderExecutor,
} from '@/modules/procurement/field-stock/services/stockHolderService';

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'h1', holder_type: 'staff', staff_id: 's1', contractor_id: null,
  name: 'Tech One', phone: '0810000000', email: null, is_active: true,
  created_at: new Date('2026-05-26T00:00:00Z'), updated_at: new Date('2026-05-26T00:00:00Z'),
  ...over,
});

// Records calls; queryOne returns queued responses (FIFO), default null.
function fakeExec(queueQueryOne: Array<unknown> = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const q = [...queueQueryOne];
  const exec: HolderExecutor & { calls: typeof calls } = {
    calls,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return (q.length ? q.shift() : null) as never;
    }),
  };
  return exec;
}

describe('rowToHolder', () => {
  it('maps snake_case db columns to a camelCase StockHolder', () => {
    const h = rowToHolder(dbRow());
    expect(h).toMatchObject({ id: 'h1', holderType: 'staff', staffId: 's1', name: 'Tech One', isActive: true });
  });
});

describe('upsertStaffHolderWith', () => {
  it('emits an idempotent ON CONFLICT upsert keyed on the partial staff index', async () => {
    const exec = fakeExec([dbRow()]);
    const h = await upsertStaffHolderWith(exec, 's1', 'Tech One', '0810000000');
    const sql = exec.calls.map((c) => c.text).join('\n');
    expect(sql).toMatch(/INSERT INTO stock_holders/i);
    expect(sql).toMatch(/ON CONFLICT \(staff_id\) WHERE holder_type = 'staff'/i);
    expect(sql).toMatch(/DO UPDATE SET/i);
    expect(exec.calls[0].params).toEqual(['s1', 'Tech One', '0810000000']);
    expect(h.staffId).toBe('s1');
  });
});

describe('upsertContractorHolderWith', () => {
  it('emits an idempotent ON CONFLICT upsert keyed on the partial contractor index', async () => {
    const exec = fakeExec([dbRow({ holder_type: 'contractor', staff_id: null, contractor_id: 'c1', name: 'Acme' })]);
    const h = await upsertContractorHolderWith(exec, 'c1', 'Acme');
    const sql = exec.calls.map((c) => c.text).join('\n');
    expect(sql).toMatch(/ON CONFLICT \(contractor_id\) WHERE holder_type = 'contractor'/i);
    expect(exec.calls[0].params).toEqual(['c1', 'Acme']);
    expect(h.contractorId).toBe('c1');
  });
});

describe('getOrCreateExternalHolderWith', () => {
  it('returns the existing external holder without inserting (dedup on name+phone)', async () => {
    const exec = fakeExec([dbRow({ holder_type: 'external_person', staff_id: null, name: 'Freelancer', phone: '0820000000' })]);
    const h = await getOrCreateExternalHolderWith(exec, 'Freelancer', '0820000000');
    const texts = exec.calls.map((c) => c.text);
    expect(texts.some((t) => /SELECT .* FROM stock_holders/i.test(t) && /lower\(name\)/i.test(t))).toBe(true);
    expect(texts.some((t) => /INSERT INTO stock_holders/i.test(t))).toBe(false); // found → no insert
    expect(h.name).toBe('Freelancer');
  });

  it('inserts a new external holder when none matches', async () => {
    const exec = fakeExec([null, dbRow({ holder_type: 'external_person', staff_id: null, name: 'New Ext', phone: null })]);
    const h = await getOrCreateExternalHolderWith(exec, 'New Ext');
    const texts = exec.calls.map((c) => c.text);
    expect(texts.some((t) => /INSERT INTO stock_holders/i.test(t) && /'external_person'/i.test(t))).toBe(true);
    expect(h.name).toBe('New Ext');
  });
});

describe('syncTechnicianHolderWith (best-effort)', () => {
  it('upserts the staff holder when the executor works', async () => {
    const exec = fakeExec([dbRow()]);
    await syncTechnicianHolderWith(exec, 's1', 'Tech One', '0810000000');
    expect(exec.calls.some((c) => /INSERT INTO stock_holders/i.test(c.text))).toBe(true);
  });

  it('never throws when the upsert fails (location creation must not break)', async () => {
    const exec: HolderExecutor = {
      query: vi.fn(async () => { throw new Error('db down'); }),
      queryOne: vi.fn(async () => { throw new Error('db down'); }),
    };
    await expect(syncTechnicianHolderWith(exec, 's1', 'Tech One')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npx vitest run tests/services/stock/stockHolderService.test.ts`
Expected: FAIL — cannot resolve `@/modules/procurement/field-stock/services/stockHolderService` (module not yet created).

- [ ] **Step 3: Implement the service**

`src/modules/procurement/field-stock/services/stockHolderService.ts`:
```ts
/**
 * Stock Holder Service — typed custody-identity registry (Sprint C).
 *
 * holder_type ∈ {staff, contractor, external_person}. SMME is NOT a holder type
 * (it is a future contractor attribute); teams never hold. See the design spec.
 *
 * Core functions take an injectable HolderExecutor so the emitted SQL is
 * unit-testable without a live DB (mirrors postGrnReceiptLines). Public wrappers
 * bind the core to the pg.Pool singleton in @/lib/db-pool.
 */
import { query, queryOne, transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export type HolderType = 'staff' | 'contractor' | 'external_person';

export interface StockHolder {
  id: string;
  holderType: HolderType;
  staffId: string | null;
  contractorId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal query surface; satisfied by @/lib/db-pool and by a transaction client. */
export interface HolderExecutor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
}

const HOLDER_COLS =
  'id, holder_type, staff_id, contractor_id, name, phone, email, is_active, created_at, updated_at';

export function rowToHolder(r: Record<string, unknown>): StockHolder {
  return {
    id: String(r.id),
    holderType: r.holder_type as HolderType,
    staffId: (r.staff_id as string) ?? null,
    contractorId: (r.contractor_id as string) ?? null,
    name: String(r.name),
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

const STAFF_UPSERT = `
  INSERT INTO stock_holders (holder_type, staff_id, name, phone)
  VALUES ('staff', $1, $2, $3)
  ON CONFLICT (staff_id) WHERE holder_type = 'staff'
  DO UPDATE SET name = EXCLUDED.name,
                phone = COALESCE(EXCLUDED.phone, stock_holders.phone),
                updated_at = now()
  RETURNING ${HOLDER_COLS}`;

const CONTRACTOR_UPSERT = `
  INSERT INTO stock_holders (holder_type, contractor_id, name)
  VALUES ('contractor', $1, $2)
  ON CONFLICT (contractor_id) WHERE holder_type = 'contractor'
  DO UPDATE SET name = EXCLUDED.name, updated_at = now()
  RETURNING ${HOLDER_COLS}`;

const EXTERNAL_FIND = `
  SELECT ${HOLDER_COLS} FROM stock_holders
  WHERE holder_type = 'external_person'
    AND lower(name) = lower($1)
    AND coalesce(phone, '') = coalesce($2, '')
  LIMIT 1`;

const EXTERNAL_INSERT = `
  INSERT INTO stock_holders (holder_type, name, phone, email)
  VALUES ('external_person', $1, $2, $3)
  RETURNING ${HOLDER_COLS}`;

const BY_ID = `SELECT ${HOLDER_COLS} FROM stock_holders WHERE id = $1`;

// ---- core (executor-injected; unit-tested) --------------------------------

export async function upsertStaffHolderWith(
  exec: HolderExecutor, staffId: string, name: string, phone?: string,
): Promise<StockHolder> {
  const row = await exec.queryOne(STAFF_UPSERT, [staffId, name, phone ?? null]);
  return rowToHolder(row as Record<string, unknown>);
}

export async function upsertContractorHolderWith(
  exec: HolderExecutor, contractorId: string, name: string,
): Promise<StockHolder> {
  const row = await exec.queryOne(CONTRACTOR_UPSERT, [contractorId, name]);
  return rowToHolder(row as Record<string, unknown>);
}

export async function getOrCreateExternalHolderWith(
  exec: HolderExecutor, name: string, phone?: string, email?: string,
): Promise<StockHolder> {
  const found = await exec.queryOne(EXTERNAL_FIND, [name, phone ?? null]);
  if (found) return rowToHolder(found as Record<string, unknown>);
  const created = await exec.queryOne(EXTERNAL_INSERT, [name, phone ?? null, email ?? null]);
  return rowToHolder(created as Record<string, unknown>);
}

/** Best-effort: a holder-sync failure must never break the caller (location creation). */
export async function syncTechnicianHolderWith(
  exec: HolderExecutor, staffId: string, name: string, phone?: string,
): Promise<void> {
  try {
    await upsertStaffHolderWith(exec, staffId, name, phone);
  } catch (error) {
    log.error('technician holder sync failed (non-fatal)', { error, staffId }, 'stockHolderService');
  }
}

// ---- public wrappers (bound to the pg.Pool singleton) ---------------------

const poolExec: HolderExecutor = { query, queryOne };

export const getOrCreateStaffHolder = (staffId: string, name: string, phone?: string) =>
  upsertStaffHolderWith(poolExec, staffId, name, phone);

export const getOrCreateContractorHolder = (contractorId: string, name: string) =>
  upsertContractorHolderWith(poolExec, contractorId, name);

export const getOrCreateExternalHolder = (name: string, phone?: string, email?: string) =>
  transaction((txn) => getOrCreateExternalHolderWith(txn as HolderExecutor, name, phone, email));

export const syncTechnicianHolder = (staffId: string, name: string, phone?: string) =>
  syncTechnicianHolderWith(poolExec, staffId, name, phone);

export async function getHolderById(id: string): Promise<StockHolder | null> {
  const row = await queryOne(BY_ID, [id]);
  return row ? rowToHolder(row as Record<string, unknown>) : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/services/stock/stockHolderService.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && git add src/modules/procurement/field-stock/services/stockHolderService.ts tests/services/stock/stockHolderService.test.ts && git commit -m "feat(stock): stock_holders resolver service with idempotent get-or-create"
```

---

### Task 3: Dual-write hook in `getOrCreateTechnicianLocation`

**Files:**
- Modify: `src/modules/procurement/field-stock/services/locationService.ts` (imports + `getOrCreateTechnicianLocation`, ~`416-466`)

Rationale: keep the registry live between C and D. The best-effort logic + its tests already live in `stockHolderService` (Task 2) — here we only wire the call in, so `locationService` grows by ~3 lines (it is a legacy 552-line file; a split is out of scope for C).

- [ ] **Step 1: Add the import**

At the top of `locationService.ts`, after the existing `import { query } from './db';` line, add:
```ts
import { syncTechnicianHolder } from './stockHolderService';
```

- [ ] **Step 2: Wire the dual-write into both return paths**

Replace the body of `getOrCreateTechnicianLocation` so both the existing-location and newly-created-location paths sync the holder before returning. The current function (lines ~421-462) returns early in the `existing.length > 0` branch and returns the `createLocation(...)` result directly — refactor to a single `location` variable:

```ts
  try {
    // Check if location exists
    const existing = await sql`
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
      FROM stock_locations
      WHERE location_type = 'technician'
        AND assigned_to_id = ${technicianId}
      LIMIT 1
    `;

    const location =
      existing.length > 0
        ? (existing[0] as StockLocation)
        : await createLocation({
            code: `TECH-${technicianId.slice(0, 8).toUpperCase()}`,
            name: `${technicianName}'s Van Stock`,
            locationType: 'technician',
            assignedToId: technicianId,
            assignedToName: technicianName,
            assignedToPhone: technicianPhone,
            isVirtual: true,
          });

    // Sprint C dual-write: keep the stock_holders registry live. Best-effort —
    // a holder-sync failure must never break technician-location provisioning.
    await syncTechnicianHolder(technicianId, technicianName, technicianPhone);

    return location;
  } catch (error) {
    log.error('Failed to get or create technician location', { error }, 'locationService');
    throw error;
  }
```

- [ ] **Step 3: Type-check**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npx tsc --noEmit`
Expected: no new errors referencing `locationService.ts` or `stockHolderService.ts`. (Note `feedback_worktree_lsp_false_positives`: trust `tsc`, not the editor.)

- [ ] **Step 4: Run the existing locationService tests (regression)**

Run: `npx vitest run src/modules/procurement/field-stock/__tests__/locationService.test.ts`
Expected: PASS (the existing `checkLocationDeletable` suite is unaffected).

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && git add src/modules/procurement/field-stock/services/locationService.ts && git commit -m "feat(stock): dual-write staff holder when minting a technician location"
```

---

### Task 4: Backfill script — seed the 5 existing holders

**Files:**
- Create: `src/modules/procurement/field-stock/services/holderBackfillMapping.ts` (pure, **db-free**)
- Create: `scripts/backfill-stock-holders.ts`
- Test: `tests/services/stock/holderBackfillMapping.test.ts`

Design: the only DB-independent logic is selecting which technician locations are eligible (must have an `assigned_to_id` that is a real `staff` row). It lives in a **db-free** `src/` module (`holderBackfillMapping.ts`) so it (a) resolves under the `@/` → `src/` alias for clean testing and (b) carries no `@/lib/db-pool` import that would bind `DATABASE_URL` before the script's `dotenv.config()`. The CLI script imports the pure mapper statically and dynamic-imports the db-bound pieces after dotenv: query (JOIN staff) → for each eligible row `getOrCreateStaffHolder` → log; dry-run unless `--commit`. (Mirrors Sprint A: testable logic in `src/`, thin CLI in `scripts/`.)

- [ ] **Step 1: Write the failing test for the pure mapper**

`tests/services/stock/holderBackfillMapping.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { eligibleHolderInput, type TechLocationRow } from '@/modules/procurement/field-stock/services/holderBackfillMapping';

const row = (over: Partial<TechLocationRow> = {}): TechLocationRow => ({
  assigned_to_id: 's1', assigned_to_name: 'Tech One', assigned_to_phone: '0810000000', staff_exists: true, ...over,
});

describe('eligibleHolderInput', () => {
  it('maps a technician location backed by a real staff row', () => {
    expect(eligibleHolderInput(row())).toEqual({ staffId: 's1', name: 'Tech One', phone: '0810000000' });
  });
  it('skips a row with no assigned_to_id', () => {
    expect(eligibleHolderInput(row({ assigned_to_id: null }))).toBeNull();
  });
  it('skips a row whose assigned_to_id is not a staff member', () => {
    expect(eligibleHolderInput(row({ staff_exists: false }))).toBeNull();
  });
  it('falls back to a placeholder name only when the staff name is blank', () => {
    expect(eligibleHolderInput(row({ assigned_to_name: null }))?.name).toBe('Unknown (s1)');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/services/stock/holderBackfillMapping.test.ts`
Expected: FAIL — module not found / export missing.

- [ ] **Step 3: Implement the pure mapper module (db-free)**

`src/modules/procurement/field-stock/services/holderBackfillMapping.ts`:
```ts
/**
 * Pure mapping for the stock_holders backfill (Sprint C). NO db imports — this
 * module is imported by a tsx CLI that calls dotenv.config() before touching the
 * pool, so it must not transitively pull @/lib/db-pool.
 */
export interface TechLocationRow {
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  assigned_to_phone: string | null;
  staff_exists: boolean;
}

export interface HolderInput { staffId: string; name: string; phone?: string }

/** Decide whether a technician location yields a staff holder, and how. */
export function eligibleHolderInput(row: TechLocationRow): HolderInput | null {
  if (!row.assigned_to_id || !row.staff_exists) return null;
  const name = row.assigned_to_name?.trim() || `Unknown (${row.assigned_to_id})`;
  return {
    staffId: row.assigned_to_id,
    name,
    phone: row.assigned_to_phone ?? undefined,
  };
}
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `npx vitest run tests/services/stock/holderBackfillMapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the CLI script**

`scripts/backfill-stock-holders.ts`:
```ts
/**
 * Backfill stock_holders from the existing technician locations (Sprint C).
 *
 * Each stock_locations row with location_type='technician' whose assigned_to_id
 * is a real staff member becomes one holder_type='staff' holder. Idempotent via
 * the partial unique index. Dry-run by default; pass --commit to write.
 *
 * tsx conventions (per Sprint A): dotenv first, then DYNAMIC import of anything
 * pulling @/lib/db-pool (db.ts binds DATABASE_URL at import); use process.stdout
 * (not @/lib/logger — silent under Node; console.* is lint-banned); exit(0) at end.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { eligibleHolderInput, type TechLocationRow } from '@/modules/procurement/field-stock/services/holderBackfillMapping';

const TECH_LOCATIONS_SQL = `
  SELECT sl.assigned_to_id, sl.assigned_to_name, sl.assigned_to_phone,
         (s.id IS NOT NULL) AS staff_exists
  FROM stock_locations sl
  LEFT JOIN staff s ON s.id = sl.assigned_to_id
  WHERE sl.location_type = 'technician'`;

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const out = (m: string) => process.stdout.write(m + '\n');

  const { query } = await import('@/lib/db-pool');
  const { getOrCreateStaffHolder } = await import(
    '@/modules/procurement/field-stock/services/stockHolderService'
  );

  const rows = (await query(TECH_LOCATIONS_SQL)) as unknown as TechLocationRow[];
  out(`Found ${rows.length} technician location(s). Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const input = eligibleHolderInput(r);
    if (!input) {
      skipped++;
      out(`  SKIP  assigned_to_id=${r.assigned_to_id ?? 'NULL'} (no staff match)`);
      continue;
    }
    if (commit) {
      const h = await getOrCreateStaffHolder(input.staffId, input.name, input.phone);
      out(`  OK    staff_id=${input.staffId} -> holder ${h.id} (${h.name})`);
    } else {
      out(`  WOULD staff_id=${input.staffId} (${input.name})`);
    }
    created++;
  }

  out(`Done. eligible=${created} skipped=${skipped} ${commit ? '(written)' : '(dry-run, no writes)'}`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Type-check the script + mapper**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npx tsc --noEmit`
Expected: no new errors in `holderBackfillMapping.ts` or `backfill-stock-holders.ts`. (The CLI itself is exercised end-to-end in Task 5.)

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && git add src/modules/procurement/field-stock/services/holderBackfillMapping.ts scripts/backfill-stock-holders.ts tests/services/stock/holderBackfillMapping.test.ts && git commit -m "feat(stock): backfill script seeding stock_holders from technician locations"
```

---

### Task 5: Run the backfill + full validation gate

**Files:** none (verification only)

- [ ] **Step 1: Dry-run the backfill**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npx tsx scripts/backfill-stock-holders.ts`
Expected: `Found 5 technician location(s). Mode: DRY-RUN`, 5 `WOULD …` lines (Lindani Malembe, Byron Viviers, Marchael Meyer, Cecelia Serekoeng, Adriaan Paulse), `eligible=5 skipped=0 (dry-run, no writes)`. Confirm `SELECT count(*) FROM stock_holders` is still 0.

- [ ] **Step 2: Commit the backfill (writes 5 rows to the shared DB)**

> Surface to Hein first — this writes 5 rows to the shared dev+prod DB (additive, low risk).

Run: `npx tsx scripts/backfill-stock-holders.ts --commit`
Expected: 5 `OK … -> holder <uuid>` lines; `eligible=5 skipped=0 (written)`.

- [ ] **Step 3: Verify the gate — exactly 5 staff holders, deduped**

Run:
```bash
PSQL="psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA"
$PSQL -c "SELECT holder_type, count(*) FROM stock_holders GROUP BY 1;"
$PSQL -c "SELECT count(*) AS dupes FROM (SELECT staff_id FROM stock_holders WHERE holder_type='staff' GROUP BY staff_id HAVING count(*)>1) d;"
```
Expected: one row `staff|5`; `dupes = 0`.

- [ ] **Step 4: Idempotency — re-run --commit is a no-op**

Run: `npx tsx scripts/backfill-stock-holders.ts --commit` then re-check `SELECT count(*) FROM stock_holders;`
Expected: still exactly 5 (the ON CONFLICT upsert updated, did not insert); count unchanged.

- [ ] **Step 5: Full lint + type gate**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-holder-party-model && npx tsc --noEmit && npm run ci:quick`
Expected: `tsc` clean; `ci:quick` passes (0 errors; warnings within the 185 ratchet; Gate 4 clean). Per `feedback_vitest_skips_tsc`, both must pass — vitest green alone is insufficient.

- [ ] **Step 6: Run the new unit tests together (final green)**

Run: `npx vitest run tests/services/stock/stockHolderService.test.ts tests/services/stock/holderBackfillMapping.test.ts`
Expected: all PASS (11 tests total).

---

## Self-review (completed during planning)

- **Spec coverage:** schema+CHECK+indexes (Task 1) ✓; resolver `getOrCreate{Staff,Contractor,External}Holder` + `getHolderById` (Task 2) ✓; typed FKs not polymorphic ref_id (Task 1 schema) ✓; dual-write hook (Task 3) ✓; idempotent dry-run/`--commit` backfill of the 5 (Tasks 4–5) ✓; out-of-scope items (blocked, accountability, serials, SMME column, UI) are not touched ✓; every validation gate maps to a Task-5 step ✓.
- **Type consistency:** `HolderExecutor`, `StockHolder`, `HolderType`, `rowToHolder`, `upsert*With`, `getOrCreate*Holder`, `syncTechnicianHolder(With)`, `eligibleHolderInput`/`TechLocationRow`/`HolderInput` are named identically across tasks and tests.
- **Placeholders:** none — every code/SQL/command step is complete.

## Post-implementation (not part of this plan's tasks)

PR via `gh`; review with **review-team** (raw diff); re-run the migration-collision check immediately before opening the PR (`feedback_parallel_session_migration_coordination`); CI on the self-hosted runner; merge only after blind-review APPROVED + CI green; deploy to dev via `bash scripts/deploy-local.sh dev`.
