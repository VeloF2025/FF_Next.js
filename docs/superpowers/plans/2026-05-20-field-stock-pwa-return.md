# Field-Stock PWA — Phase 3: Return Flow + Warehouse Inspect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a technician-side return wizard at `/my/stores/return` and a warehouse-side disposition+restock screen at `/my/stores/inspect` to the staff-portal PWA, building on the existing `stock_returns` backend.

**Architecture:** Three new pages under `/my/stores/`. Mirror Phase 2 (`src/modules/field-stock-pwa/`) component patterns: an orchestrator state machine, step components, shared SignaturePad / StepProgress / role gating. Two new flat API endpoints (`my-serials`, `serial-source`); the three existing return endpoints (`POST /returns`, `/inspect`, `/accept`) get hardened (role gate, idempotency, audit fields derived from `req.user`, transactional accept). One small migration (`358_returns_idempotency_key.sql`).

**Tech Stack:** Next.js 14 (Pages Router), React, Tailwind, Vitest, Postgres via `@neondatabase/serverless` shim (legacy — DO NOT migrate to `pg.Pool` in this PR; rest of returns/* uses the shim), IndexedDB (raw, no `idb` wrapper).

**Spec:** `docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md`

**Worktree / branch:** `/home/hein/Workspace/FF_Next.js-phase3-returns` on `feat/field-stock-pwa-return-flow`.

**Phase 2 reference files (read these before starting):**
- `src/modules/field-stock-pwa/components/IssueOrchestrator.tsx` — orchestrator pattern
- `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx` — scan UX
- `src/modules/field-stock-pwa/components/SignAndSubmitStep.tsx` — signature + submit
- `src/modules/field-stock-pwa/offline/queueIssue.ts` — IDB queue pattern
- `src/modules/field-stock-pwa/offline/useStockSync.ts` — drain pattern
- `src/modules/field-stock-pwa/lib/storesRoles.ts` — role gate
- `src/modules/field-stock-pwa/api/pickings.ts` — submit helper pattern

---

## Phase A — Foundations

### Task A.1: Schema probe — answer the 5 open verification items

**Files:** None created. This task outputs a markdown note appended to this plan file under "Schema probe results" near the bottom.

**Steps:**

- [ ] **Step 1: SSH to velo and gather schema facts**

Run these probes one-by-one and copy the output into your scratch notes:

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && source .env.local && psql "$DATABASE_URL" <<SQL
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = '"'"'stock_serials'"'"'::regclass AND contype = '"'"'c'"'"';
SQL'
```

Repeat for each of these probes:

```sql
-- (1) stock_serials.status valid values
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'stock_serials'::regclass AND contype = 'c';

-- (2) verify staff/users linkage (Phase 2 helper expects users.id → staff.user_id)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'staff' AND column_name IN ('id', 'user_id', 'role');

-- (3) candidate sources for "serials held by tech" — list relevant columns/views
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'stock_serial%' OR table_name = 'stock_pickings';

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'stock_serials';

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'stock_pickings';

-- (4) generate_return_number() exists
SELECT generate_return_number();

-- (5) stock_returns.idempotency_key does NOT already exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'stock_returns' AND column_name = 'idempotency_key';

-- (6) bonus: confirm the 'returns' table CHECK constraints match the spec's vocabulary
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'stock_return_lines'::regclass AND contype = 'c';
```

- [ ] **Step 2: Append findings to this plan**

Open `docs/superpowers/plans/2026-05-20-field-stock-pwa-return.md`. Find the "Schema probe results" section near the bottom. Replace its placeholder content with the actual output from Step 1.

The decisions to lock in based on probe results:
- The canonical "serials held by tech" source — likely `stock_serials WHERE assigned_to_staff_id = $1 AND status = 'assigned'`, but confirm the column name.
- Whether `stock_serials.status` CHECK already includes `available | assigned | consumed | scrapped | faulty` — if not, expand the migration in Task A.2 (one additional ALTER).

- [ ] **Step 3: Commit the plan update**

```bash
git add docs/superpowers/plans/2026-05-20-field-stock-pwa-return.md
git commit -m "docs(plan): record Phase 3 schema probe results"
```

---

### Task A.2: Migration 358 — `idempotency_key` on `stock_returns`

**Files:**
- Create: `scripts/migrations/sql/358_returns_idempotency_key.sql`
- Modify (only if Task A.1 finds it): expand to include `stock_serials.status` CHECK if values are missing

- [ ] **Step 1: Write the migration**

```sql
-- scripts/migrations/sql/358_returns_idempotency_key.sql
-- Phase 3 of field-stock PWA: client-generated idempotency key on stock_returns
-- so duplicate submissions from the offline queue dedupe server-side.
-- See spec: docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md

ALTER TABLE stock_returns
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_returns_idempotency
  ON stock_returns(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN stock_returns.idempotency_key IS
  'Client-generated UUID per submission. NULL for legacy / non-PWA returns. Partial unique index dedupes PWA submissions.';
```

- [ ] **Step 2: Apply to dev**

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && source .env.local && psql "$DATABASE_URL" -f -' < scripts/migrations/sql/358_returns_idempotency_key.sql
```

Expected: two `NOTICE` lines (column already exists / index already exists) on a re-run, or two creates on first run. Zero errors.

- [ ] **Step 3: Verify**

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && source .env.local && psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name=\"stock_returns\" AND column_name=\"idempotency_key\";"'
```

Expected: one row, `idempotency_key`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/358_returns_idempotency_key.sql
git commit -m "feat(field-stock-pwa): migration 358 — idempotency_key on stock_returns"
```

---

### Task A.3: Extend `storesRoles.ts` with `isReturnCreator` + `isReturnInspector`

**Files:**
- Modify: `src/modules/field-stock-pwa/lib/storesRoles.ts`
- Modify: `src/modules/field-stock-pwa/lib/__tests__/storesRoles.test.ts`

- [ ] **Step 1: Write the failing tests first**

Append the following describe blocks to `src/modules/field-stock-pwa/lib/__tests__/storesRoles.test.ts`:

```typescript
import { isReturnCreator, isReturnInspector } from '../storesRoles';

describe('isReturnCreator', () => {
  it('technician staff.role → true', () => {
    expect(isReturnCreator('technician', null)).toBe(true);
  });
  it('stores staff.role → true', () => {
    expect(isReturnCreator('stores', null)).toBe(true);
  });
  it('admin staff.role → true', () => {
    expect(isReturnCreator('admin', null)).toBe(true);
  });
  it('driver staff.role → false', () => {
    expect(isReturnCreator('driver', null)).toBe(false);
  });
  it('null role, super_admin authRole → true', () => {
    expect(isReturnCreator(null, 'super_admin')).toBe(true);
  });
  it('null role, system authRole → true', () => {
    expect(isReturnCreator(null, 'system')).toBe(true);
  });
  it('null role, no authRole → false', () => {
    expect(isReturnCreator(null, null)).toBe(false);
  });
});

describe('isReturnInspector', () => {
  it('stores staff.role → true', () => {
    expect(isReturnInspector('stores', null)).toBe(true);
  });
  it('admin staff.role → true', () => {
    expect(isReturnInspector('admin', null)).toBe(true);
  });
  it('technician staff.role → false (techs cannot inspect)', () => {
    expect(isReturnInspector('technician', null)).toBe(false);
  });
  it('null role, super_admin authRole → true', () => {
    expect(isReturnInspector(null, 'super_admin')).toBe(true);
  });
  it('null role, system authRole → true', () => {
    expect(isReturnInspector(null, 'system')).toBe(true);
  });
  it('null role, no authRole → false', () => {
    expect(isReturnInspector(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

```bash
npx vitest run src/modules/field-stock-pwa/lib/__tests__/storesRoles.test.ts
```

Expected: FAIL — `isReturnCreator is not a function`, `isReturnInspector is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/modules/field-stock-pwa/lib/storesRoles.ts`:

```typescript
// =============================================================================
// Return-flow helpers (Phase 3)
// =============================================================================

/**
 * Staff roles permitted to create a return via /my/stores/return.
 * Technicians create returns (their own stock); stores/admin can also create
 * one on a tech's behalf.
 */
export const RETURN_CREATOR_ROLES = ['technician', 'stores', 'admin'] as const;

/**
 * Staff roles permitted to inspect+accept a return via /my/stores/inspect/[id].
 * Excludes technician — only stores staff and admins can disposition serials.
 */
export const RETURN_INSPECTOR_ROLES = ['stores', 'admin'] as const;

/** Same authRole bypass as isStoresAuthorised. */
export function isReturnCreator(
  role: StaffRole | null,
  authRole?: string | null,
): boolean {
  if (authRole !== undefined && authRole !== null) {
    if ((STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole)) return true;
  }
  if (role === null) return false;
  return (RETURN_CREATOR_ROLES as ReadonlyArray<string>).includes(role);
}

export function isReturnInspector(
  role: StaffRole | null,
  authRole?: string | null,
): boolean {
  if (authRole !== undefined && authRole !== null) {
    if ((STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole)) return true;
  }
  if (role === null) return false;
  return (RETURN_INSPECTOR_ROLES as ReadonlyArray<string>).includes(role);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/modules/field-stock-pwa/lib/__tests__/storesRoles.test.ts
```

Expected: PASS — all old `isStoresAuthorised` tests + 13 new helper tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/field-stock-pwa/lib/storesRoles.ts \
       src/modules/field-stock-pwa/lib/__tests__/storesRoles.test.ts
git commit -m "feat(field-stock-pwa): isReturnCreator + isReturnInspector role gates"
```

---

### Task A.4: Vocabulary constants (`returnReasons`, `conditionOptions`, `dispositionOptions`)

**Files:**
- Create: `src/modules/field-stock-pwa/lib/returnReasons.ts`
- Create: `src/modules/field-stock-pwa/lib/conditionOptions.ts`
- Create: `src/modules/field-stock-pwa/lib/dispositionOptions.ts`
- Create: `src/modules/field-stock-pwa/lib/__tests__/returnVocabulary.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/field-stock-pwa/lib/__tests__/returnVocabulary.test.ts
import { describe, it, expect } from 'vitest';
import { RETURN_REASONS, type ReturnReason } from '../returnReasons';
import { CONDITION_OPTIONS, type ReturnCondition } from '../conditionOptions';
import { DISPOSITION_OPTIONS, type ReturnDisposition } from '../dispositionOptions';

describe('Return vocabulary constants', () => {
  it('RETURN_REASONS codes match stock_return_lines.return_reason CHECK', () => {
    const codes = RETURN_REASONS.map((r) => r.code);
    expect(codes).toEqual([
      'unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused',
    ]);
  });

  it('every RETURN_REASONS entry has a human label', () => {
    for (const r of RETURN_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('CONDITION_OPTIONS subset matches stock_return_lines.condition CHECK', () => {
    const codes = CONDITION_OPTIONS.map((c) => c.code);
    expect(codes).toEqual(['good', 'damaged', 'non_functional']);
  });

  it('DISPOSITION_OPTIONS subset matches stock_return_lines.disposition CHECK', () => {
    const codes = DISPOSITION_OPTIONS.map((d) => d.code);
    expect(codes).toEqual(['restock', 'repair', 'scrap']);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run src/modules/field-stock-pwa/lib/__tests__/returnVocabulary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three vocabulary files**

`src/modules/field-stock-pwa/lib/returnReasons.ts`:

```typescript
/**
 * Return-reason vocabulary for the Phase 3 PWA return flow.
 *
 * Codes MUST match the stock_return_lines.return_reason CHECK constraint
 * (migration 029). Changing labels is fine; changing codes requires a migration.
 */

export type ReturnReason =
  | 'unused'
  | 'job_cancelled'
  | 'wrong_item'
  | 'excess'
  | 'faulty'
  | 'customer_refused';

export interface ReturnReasonOption {
  code: ReturnReason;
  label: string;
}

export const RETURN_REASONS: ReturnReasonOption[] = [
  { code: 'unused',           label: 'Unused — end of job' },
  { code: 'job_cancelled',    label: 'Job cancelled' },
  { code: 'wrong_item',       label: 'Wrong item issued' },
  { code: 'excess',           label: 'Excess — over-issued' },
  { code: 'faulty',           label: 'Faulty / damaged in field' },
  { code: 'customer_refused', label: 'Customer refused install' },
];
```

`src/modules/field-stock-pwa/lib/conditionOptions.ts`:

```typescript
/**
 * Inspect-time condition vocabulary. Phase 3 UI exposes a 3-option subset of
 * the stock_return_lines.condition CHECK ('new', 'good', 'fair', 'poor',
 * 'damaged', 'non_functional'). Storemen don't need finer-grained options here.
 */

export type ReturnCondition = 'good' | 'damaged' | 'non_functional';

export interface ConditionOption {
  code: ReturnCondition;
  label: string;
  description: string;
}

export const CONDITION_OPTIONS: ConditionOption[] = [
  { code: 'good',           label: 'Good',           description: 'No visible damage, ready to re-issue' },
  { code: 'damaged',        label: 'Damaged',        description: 'Cosmetic or minor damage — repair candidate' },
  { code: 'non_functional', label: 'Non-functional', description: 'Does not power on or fails self-test' },
];
```

`src/modules/field-stock-pwa/lib/dispositionOptions.ts`:

```typescript
/**
 * Inspect-time disposition vocabulary. Phase 3 UI exposes a 3-option subset of
 * the stock_return_lines.disposition CHECK ('restock', 'repair', 'scrap',
 * 'supplier_return'). supplier_return is not yet wired up in the accept handler.
 */

export type ReturnDisposition = 'restock' | 'repair' | 'scrap';

export interface DispositionOption {
  code: ReturnDisposition;
  label: string;
  description: string;
  /** Resulting stock_serials.status applied by POST /accept. */
  resultingSerialStatus: 'available' | 'faulty' | 'scrapped';
}

export const DISPOSITION_OPTIONS: DispositionOption[] = [
  {
    code: 'restock',
    label: 'Restock',
    description: 'Return to warehouse stock as available',
    resultingSerialStatus: 'available',
  },
  {
    code: 'repair',
    label: 'Repair',
    description: 'Send to repair queue; serial marked faulty',
    resultingSerialStatus: 'faulty',
  },
  {
    code: 'scrap',
    label: 'Scrap',
    description: 'Write off; serial marked scrapped',
    resultingSerialStatus: 'scrapped',
  },
];
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/modules/field-stock-pwa/lib/__tests__/returnVocabulary.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/field-stock-pwa/lib/returnReasons.ts \
       src/modules/field-stock-pwa/lib/conditionOptions.ts \
       src/modules/field-stock-pwa/lib/dispositionOptions.ts \
       src/modules/field-stock-pwa/lib/__tests__/returnVocabulary.test.ts
git commit -m "feat(field-stock-pwa): return-flow vocabulary constants"
```

---

### Task A.5: Extend `types.ts` with PWA return-flow shapes

**Files:**
- Modify: `src/modules/field-stock-pwa/types.ts`

- [ ] **Step 1: Append the new types**

Append to `src/modules/field-stock-pwa/types.ts`:

```typescript
// =============================================================================
// Phase 3 — Return flow
// =============================================================================

import type { ReturnReason } from './lib/returnReasons';
import type { ReturnCondition } from './lib/conditionOptions';
import type { ReturnDisposition } from './lib/dispositionOptions';

/**
 * A serial currently held by the calling tech, returned by GET /my-serials.
 * Only serials with status='assigned' are returned; consumed/returned are filtered out.
 */
export interface PwaMyHeldSerial {
  serialId: string;             // stock_serials.id (UUID)
  serialNumber: string;         // stock_serials.serial_number (string)
  stockItemId: string;          // stock_items.id
  stockItemName: string;        // stock_items.name
  /** Source warehouse derived from the latest issue picking. */
  sourceLocationId: string;
  sourceLocationName: string;
}

export interface PwaReturnDraft {
  /** One reason for the whole batch — written as return_reason on every line. */
  reason: ReturnReason;
  /** Required iff reason==='other' — but spec uses a fixed CHECK list, no 'other'. */
  reasonNotes: string | null;
  serials: PwaMyHeldSerial[];
  signatureDataUrl: string | null;
  /** Derived from first scanned serial; also passed to API for server validation. */
  returnToLocationId: string;
  /** Originating issue picking — best-effort; only populated when all serials trace
   *  back to the same picking. Leave null when they don't. */
  originalPickingId: string | null;
  /** Free-text note from the tech (separate from per-line notes at inspect). */
  notes: string;
}

export interface PwaReturnResult {
  returnId: string;
  returnNumber: string;          // RET-YYYYMM-NNNNN
  status: 'pending' | 'inspected' | 'restocked';
}

export interface PwaLineDisposition {
  /** stock_return_lines.id (UUID) returned by the list call. */
  lineId: string;
  condition: ReturnCondition;
  disposition: ReturnDisposition;
  notes: string | null;
}

export interface PwaInspectAcceptDraft {
  returnId: string;
  inspectionNotes: string;
  lineDispositions: PwaLineDisposition[];
  signatureDataUrl: string | null;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: clean (or whatever pre-existing TS errors are baseline — verify no NEW errors from the additions).

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/types.ts
git commit -m "feat(field-stock-pwa): return-flow PWA type shapes"
```

---

## Phase B — Offline queue + PWA API helpers

### Task B.1: `queueReturn.ts` — IDB store for offline-queued returns

**Files:**
- Create: `src/modules/field-stock-pwa/offline/queueReturn.ts`
- Create: `src/modules/field-stock-pwa/offline/__tests__/queueReturn.test.ts`

**Reference:** mirror `src/modules/field-stock-pwa/offline/queueIssue.ts` line-for-line; only the type, DB version, and store name change.

- [ ] **Step 1: Bump shared DB version in `queueIssue.ts`**

Modify `src/modules/field-stock-pwa/offline/queueIssue.ts`:

```typescript
// Change line 34 from:
const DB_VERSION = 3;
// To:
const DB_VERSION = 4;
```

And in the `onupgradeneeded` block (around line 80), add an additive case for v3 → v4:

```typescript
// Insert after the v2 → v3 abandoned-issues store creation (around line 95):

// v3 → v4: ADDITIVE — pending-returns + abandoned-returns stores.
// Existing issue stores preserved unchanged.
if (!d.objectStoreNames.contains('pending-returns')) {
  d.createObjectStore('pending-returns', { keyPath: 'id' });
}
if (!d.objectStoreNames.contains('abandoned-returns')) {
  d.createObjectStore('abandoned-returns', { keyPath: 'id' });
}
```

Update the version-history comment block above (lines 17-27) with a v4 entry:

```typescript
//   v4 — Adds 'pending-returns' + 'abandoned-returns' stores for Phase 3
//        return flow. ADDITIVE: issue stores preserved unchanged.
```

- [ ] **Step 2: Write `queueReturn.ts`**

Create `src/modules/field-stock-pwa/offline/queueReturn.ts` by cloning `queueIssue.ts` with these substitutions:

| In queueIssue.ts | In queueReturn.ts |
|---|---|
| `PwaIssueDraft` | `PwaReturnDraft` |
| `STORE = 'pending-issues'` | `STORE = 'pending-returns'` |
| `ABANDONED_STORE = 'abandoned-issues'` | `ABANDONED_STORE = 'abandoned-returns'` |
| `QueuedIssue` interface | `QueuedReturn` interface (same fields) |
| `AbandonedIssue` interface | `AbandonedReturn` interface (same fields) |
| `enqueueIssue` / `listQueued` / `dropQueued` / `bumpAttempt` / `abandonIssue` / `listAbandoned` / `clearAbandoned` | `enqueueReturn` / `listQueuedReturns` / `dropQueuedReturn` / `bumpReturnAttempt` / `abandonReturn` / `listAbandonedReturns` / `clearAbandonedReturn` |

**Important:** do NOT call `openDb()` from a different module path — both `queueIssue.ts` and `queueReturn.ts` must call the same `openDb()` so they share one IDBDatabase handle on `field-stock-pwa-v1` (DB version 4). The simplest approach: extract `openDb`, `tx`, `promisifyRequest` into a new file `offline/db.ts`, then have both queue modules import them. **Do this refactor as Step 2a below.**

- [ ] **Step 2a: Extract shared IDB primitives**

Create `src/modules/field-stock-pwa/offline/db.ts`:

```typescript
/**
 * Shared IndexedDB primitives for the field-stock PWA offline queues.
 *
 * Both queueIssue.ts and queueReturn.ts route their reads/writes through here
 * so they share a single IDBDatabase handle on 'field-stock-pwa-v1'.
 *
 * Schema version history is documented at the bottom of this file.
 */

const DB_NAME = 'field-stock-pwa-v1';
const DB_VERSION = 4;

const STORES = {
  pendingIssues: 'pending-issues',
  abandonedIssues: 'abandoned-issues',
  pendingReturns: 'pending-returns',
  abandonedReturns: 'abandoned-returns',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];
export { STORES };

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable in this environment'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const d = req.result;
      // v1 → v2: purge v1 pending-issues that lacked location IDs.
      if (event.oldVersion < 2 && d.objectStoreNames.contains(STORES.pendingIssues)) {
        d.deleteObjectStore(STORES.pendingIssues);
      }
      if (!d.objectStoreNames.contains(STORES.pendingIssues)) {
        d.createObjectStore(STORES.pendingIssues, { keyPath: 'id' });
      }
      // v2 → v3: additive — abandoned-issues
      if (!d.objectStoreNames.contains(STORES.abandonedIssues)) {
        d.createObjectStore(STORES.abandonedIssues, { keyPath: 'id' });
      }
      // v3 → v4: additive — pending-returns + abandoned-returns (Phase 3)
      if (!d.objectStoreNames.contains(STORES.pendingReturns)) {
        d.createObjectStore(STORES.pendingReturns, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(STORES.abandonedReturns)) {
        d.createObjectStore(STORES.abandonedReturns, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onblocked = () =>
      reject(new Error('IDB open blocked — another tab holds an older version'));
  });
  return dbPromise;
}

export function tx<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result: T;
        Promise.resolve(fn(store))
          .then((r) => { result = r; })
          .catch(reject);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IDB tx failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IDB tx aborted'));
      })
  );
}

export function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

/** Test-only: close and delete the DB so each test starts clean. */
export async function __resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
    req.onblocked = () =>
      reject(new Error('IDB delete blocked — close other handles first'));
  });
}
```

Then refactor `queueIssue.ts` to import `openDb, tx, promisifyRequest, STORES, __resetDbForTests` from `./db` and remove its own copies. Replace string literals `'pending-issues'` / `'abandoned-issues'` with `STORES.pendingIssues` / `STORES.abandonedIssues`.

- [ ] **Step 2b: Write `queueReturn.ts`**

```typescript
/**
 * IndexedDB queue for /my/stores/return submissions.
 * Mirrors queueIssue.ts; shares IDB primitives via ./db.ts.
 */

import { tx, promisifyRequest, STORES } from './db';
import type { PwaReturnDraft } from '../types';

export interface QueuedReturn {
  id: string;
  draft: PwaReturnDraft;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

export interface AbandonedReturn {
  id: string;
  draft: PwaReturnDraft;
  enqueuedAt: number;
  abandonedAt: number;
  attempts: number;
  lastError: string;
}

export async function enqueueReturn(draft: PwaReturnDraft): Promise<string> {
  const id = crypto.randomUUID();
  const entry: QueuedReturn = { id, draft, enqueuedAt: Date.now(), attempts: 0 };
  await tx(STORES.pendingReturns, 'readwrite', (s) => promisifyRequest(s.put(entry)));
  return id;
}

export async function listQueuedReturns(): Promise<QueuedReturn[]> {
  return tx(STORES.pendingReturns, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<QueuedReturn[]>);
    return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  });
}

export async function dropQueuedReturn(id: string): Promise<void> {
  await tx(STORES.pendingReturns, 'readwrite', (s) => promisifyRequest(s.delete(id)));
}

export async function bumpReturnAttempt(id: string, error: string): Promise<void> {
  await tx(STORES.pendingReturns, 'readwrite', async (s) => {
    const row = await promisifyRequest(
      s.get(id) as IDBRequest<QueuedReturn | undefined>
    );
    if (!row) return;
    await promisifyRequest(
      s.put({ ...row, attempts: row.attempts + 1, lastError: error })
    );
  });
}

export async function abandonReturn(item: QueuedReturn): Promise<void> {
  const abandoned: AbandonedReturn = {
    id: item.id,
    draft: item.draft,
    enqueuedAt: item.enqueuedAt,
    abandonedAt: Date.now(),
    attempts: item.attempts,
    lastError: item.lastError ?? 'Unknown error',
  };
  await tx(STORES.abandonedReturns, 'readwrite', (s) =>
    promisifyRequest(s.put(abandoned))
  );
  await tx(STORES.pendingReturns, 'readwrite', (s) =>
    promisifyRequest(s.delete(item.id))
  );
}

export async function listAbandonedReturns(): Promise<AbandonedReturn[]> {
  return tx(STORES.abandonedReturns, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<AbandonedReturn[]>);
    return all.sort((a, b) => b.abandonedAt - a.abandonedAt);
  });
}

export async function clearAbandonedReturn(id: string): Promise<void> {
  await tx(STORES.abandonedReturns, 'readwrite', (s) =>
    promisifyRequest(s.delete(id))
  );
}
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/field-stock-pwa/offline/__tests__/queueReturn.test.ts` mirroring `__tests__/queueIssue.test.ts`. Cover:
- enqueueReturn assigns a UUID and returns it
- listQueuedReturns returns enqueued items sorted oldest-first
- dropQueuedReturn removes the item
- bumpReturnAttempt increments + sets lastError without losing other fields
- abandonReturn moves the item to abandoned-returns store
- listAbandonedReturns returns newest-first
- clearAbandonedReturn removes from abandoned-returns
- Cross-store isolation: enqueueing a return does NOT touch pending-issues

Use `fake-indexeddb` if it's already a dev dep; otherwise vitest's `happy-dom` env + the IDB shim already used by `queueIssue.test.ts`. **Check `queueIssue.test.ts` for the exact setup and copy it.**

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/modules/field-stock-pwa/offline/__tests__/queueReturn.test.ts \
              src/modules/field-stock-pwa/offline/__tests__/queueIssue.test.ts
```

Expected: both test files pass. The issue tests must still pass — proves the refactor to `db.ts` is backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add src/modules/field-stock-pwa/offline/db.ts \
       src/modules/field-stock-pwa/offline/queueIssue.ts \
       src/modules/field-stock-pwa/offline/queueReturn.ts \
       src/modules/field-stock-pwa/offline/__tests__/queueReturn.test.ts
git commit -m "feat(field-stock-pwa): offline queueReturn + shared IDB primitives"
```

---

### Task B.2: Extend `useStockSync` to drain `pending-returns`

**Files:**
- Modify: `src/modules/field-stock-pwa/offline/useStockSync.ts`

- [ ] **Step 1: Read the existing implementation**

Open `src/modules/field-stock-pwa/offline/useStockSync.ts`. Understand:
- `drain()` calls `submitIssue(item.draft)` then `dropQueued(item.id)`
- Returns `{ pendingCount, abandonedCount, syncing, drain, dismissAbandoned }`

Extension goal: track and drain both pending-issues AND pending-returns from the same hook so `StoresHub` can show a combined badge. Keep the existing API stable so Phase 2 callers don't break.

- [ ] **Step 2: Modify the hook**

Replace `useStockSync.ts`'s state + drain with this combined shape. Keep the existing `pendingCount` and `abandonedCount` names (they now sum issues + returns); add `pendingReturnsCount` / `abandonedReturnsCount` for callers that want the breakdown.

```typescript
import { submitIssue, submitReturn, ApiError } from '../api';   // submitReturn added in Task B.3
import {
  abandonIssue, bumpAttempt, clearAbandoned,
  dropQueued, listAbandoned, listQueued,
} from './queueIssue';
import {
  abandonReturn, bumpReturnAttempt, clearAbandonedReturn,
  dropQueuedReturn, listAbandonedReturns, listQueuedReturns,
} from './queueReturn';

export interface UseStockSyncResult {
  /** Total of pending-issues + pending-returns. */
  pendingCount: number;
  pendingIssuesCount: number;
  pendingReturnsCount: number;
  /** Total of abandoned-issues + abandoned-returns. */
  abandonedCount: number;
  abandonedIssuesCount: number;
  abandonedReturnsCount: number;
  syncing: boolean;
  drain: () => Promise<void>;
  /** Dismiss either an abandoned issue or an abandoned return by id.
   *  Tries both stores — caller doesn't need to know which queue the id belongs to. */
  dismissAbandoned: (id: string) => Promise<void>;
}
```

The `drain()` body now:
1. Drains pending-issues using `submitIssue` / `dropQueued` / `bumpAttempt` / `abandonIssue` (existing logic).
2. Then drains pending-returns using `submitReturn` / `dropQueuedReturn` / `bumpReturnAttempt` / `abandonReturn` (mirror logic).
3. Both passes use the same `MAX_ATTEMPTS=5` + same transient-vs-permanent classification.
4. `pendingReflush` covers both passes — if either re-enqueues during drain, the do-while runs again.

`dismissAbandoned(id)`:
1. Try `clearAbandoned(id)` (issues).
2. Then try `clearAbandonedReturn(id)` (returns). At least one must succeed; ignore the "not found" branch for the other.
3. Refresh both abandoned counts.

- [ ] **Step 3: Update the unit tests for useStockSync if any exist**

Check `src/modules/field-stock-pwa/offline/__tests__/useStockSync.test.ts` exists (it should, per the file listing). Adjust assertions for the new returned shape — the issue-only behaviour MUST still pass.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/modules/field-stock-pwa/offline/__tests__/useStockSync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/field-stock-pwa/offline/useStockSync.ts \
       src/modules/field-stock-pwa/offline/__tests__/useStockSync.test.ts
git commit -m "feat(field-stock-pwa): drain pending-returns from useStockSync"
```

---

### Task B.3: PWA-side API client — `submitReturn` + `submitInspectAndAccept`

**Files:**
- Create: `src/modules/field-stock-pwa/api/returns.ts`
- Modify: `src/modules/field-stock-pwa/api/index.ts` (re-export)

- [ ] **Step 1: Write the client**

Create `src/modules/field-stock-pwa/api/returns.ts`:

```typescript
/**
 * Returns API client for the field-stock PWA.
 *
 * Translates PwaReturnDraft → POST /api/procurement/field-stock/returns body.
 * Two-step inspect+accept exposed as a single call submitInspectAndAccept().
 */

import { request } from './request';
import type {
  PwaReturnDraft,
  PwaReturnResult,
  PwaInspectAcceptDraft,
} from '../types';

interface ReturnsApiResponseLine {
  id: string;
  stock_item_id: string;
  serial_id: string | null;
  serial_number: string | null;
  quantity: number;
  condition: string | null;
  return_reason: string | null;
  disposition: string | null;
  notes: string | null;
}

interface ReturnsApiResponse {
  id: string;
  return_number: string;
  status: string;
  lines: ReturnsApiResponseLine[];
}

/** Idempotent — server dedupes on idempotency_key. */
export async function submitReturn(
  draft: PwaReturnDraft,
  idempotencyKey: string,
): Promise<PwaReturnResult> {
  const body = {
    idempotencyKey,
    returnToLocationId: draft.returnToLocationId,
    originalPickingId: draft.originalPickingId ?? undefined,
    notes: draft.notes || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    lines: draft.serials.map((s) => ({
      stockItemId: s.stockItemId,
      serialId: s.serialId,
      serialNumber: s.serialNumber,
      quantity: 1,
      returnReason: draft.reason,
    })),
  };

  const r = await request<ReturnsApiResponse>(
    '/api/procurement/field-stock/returns',
    { method: 'POST', body: JSON.stringify(body) }
  );

  return {
    returnId: r.id,
    returnNumber: r.return_number,
    status: r.status as PwaReturnResult['status'],
  };
}

/**
 * Single client action that drives the storeman's disposition flow:
 *  1. POST /returns/:id/inspect — applies per-line condition/disposition
 *  2. POST /returns/:id/accept — restocks (updates serials + quants)
 *
 * If accept fails after inspect succeeded, the return is in 'inspected' status
 * and the caller must retry accept only (not inspect).
 */
export async function submitInspectAndAccept(
  draft: PwaInspectAcceptDraft,
): Promise<PwaReturnResult> {
  const inspectBody = {
    inspectionNotes: draft.inspectionNotes || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    lineDispositions: Object.fromEntries(
      draft.lineDispositions.map((ld) => [
        ld.lineId,
        {
          condition: ld.condition,
          disposition: ld.disposition,
          notes: ld.notes ?? undefined,
        },
      ])
    ),
  };

  await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(draft.returnId)}/inspect`,
    { method: 'POST', body: JSON.stringify(inspectBody) }
  );

  const accepted = await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(draft.returnId)}/accept`,
    { method: 'POST', body: JSON.stringify({}) }
  );

  return {
    returnId: accepted.id,
    returnNumber: accepted.return_number,
    status: accepted.status as PwaReturnResult['status'],
  };
}

/** Retry-accept only (used when previous accept failed but inspect succeeded). */
export async function retryAccept(returnId: string): Promise<PwaReturnResult> {
  const accepted = await request<ReturnsApiResponse>(
    `/api/procurement/field-stock/returns/${encodeURIComponent(returnId)}/accept`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  return {
    returnId: accepted.id,
    returnNumber: accepted.return_number,
    status: accepted.status as PwaReturnResult['status'],
  };
}
```

- [ ] **Step 2: Re-export from `api/index.ts`**

Modify `src/modules/field-stock-pwa/api/index.ts` — add:

```typescript
export { submitReturn, submitInspectAndAccept, retryAccept } from './returns';
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/modules/field-stock-pwa/api/returns.ts \
       src/modules/field-stock-pwa/api/index.ts
git commit -m "feat(field-stock-pwa): submitReturn + submitInspectAndAccept clients"
```

---

### Task B.4: GET `/api/procurement/field-stock/my-serials` endpoint

**Files:**
- Create: `pages/api/procurement/field-stock/my-serials.ts`
- Create: `tests/api/procurement/field-stock/my-serials.test.ts`

- [ ] **Step 1: Verify the "currently held by tech" SQL (from schema probe A.1)**

The query shape — adjust column names if Task A.1 found different ones. Likely shape:

```sql
SELECT
  ss.id AS serial_id,
  ss.serial_number,
  ss.stock_item_id,
  si.name AS stock_item_name,
  -- Derive source warehouse: most recent issue-picking line that included this serial.
  -- stock_picking_lines.serial_ids is uuid[] — match via ANY().
  (
    SELECT sp.source_location_id
    FROM stock_pickings sp
    JOIN stock_picking_lines spl ON spl.picking_id = sp.id
    WHERE ss.id = ANY(spl.serial_ids)
      AND sp.picking_type = 'issue'
      AND sp.status = 'done'
    ORDER BY sp.created_at DESC
    LIMIT 1
  ) AS source_location_id,
  (
    SELECT sl.name
    FROM stock_pickings sp
    JOIN stock_picking_lines spl ON spl.picking_id = sp.id
    JOIN stock_locations sl ON sl.id = sp.source_location_id
    WHERE ss.id = ANY(spl.serial_ids)
      AND sp.picking_type = 'issue'
      AND sp.status = 'done'
    ORDER BY sp.created_at DESC
    LIMIT 1
  ) AS source_location_name
FROM stock_serials ss
JOIN stock_items si ON si.id = ss.stock_item_id
WHERE ss.assigned_to_staff_id = $1            -- staff.id, NOT users.id
  AND ss.status = 'assigned'
ORDER BY ss.serial_number;
```

If `stock_serials.assigned_to_staff_id` doesn't exist (schema probe will say), use the alternative: serials whose latest issue-picking targeted this staff and which haven't been consumed/returned/restocked.

- [ ] **Step 2: Implement the endpoint**

```typescript
// pages/api/procurement/field-stock/my-serials.ts
/**
 * GET /api/procurement/field-stock/my-serials
 * Returns the calling tech's currently-held serials (status='assigned').
 * Used by the Phase 3 return wizard to populate the scan step.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res, 'User session required');
  }

  try {
    // Phase 2 helper pattern: users.id → staff.id
    const staffRows = await sql`
      SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
    `;
    const staffRow = staffRows[0];
    if (!staffRow) {
      log.warn('my-serials: no staff row for user', { userId });
      return apiResponse.success(res, []);
    }
    const staffId = staffRow.id as string;

    const rows = await sql`
      SELECT
        ss.id            AS serial_id,
        ss.serial_number AS serial_number,
        ss.stock_item_id AS stock_item_id,
        si.name          AS stock_item_name,
        (
          SELECT sp.source_location_id
          FROM stock_pickings sp
          JOIN stock_picking_lines spl ON spl.picking_id = sp.id
          WHERE ss.id = ANY(spl.serial_ids)
            AND sp.picking_type = 'issue'
            AND sp.status = 'done'
          ORDER BY sp.created_at DESC
          LIMIT 1
        ) AS source_location_id,
        (
          SELECT sl.name
          FROM stock_pickings sp
          JOIN stock_picking_lines spl ON spl.picking_id = sp.id
          JOIN stock_locations sl ON sl.id = sp.source_location_id
          WHERE ss.id = ANY(spl.serial_ids)
            AND sp.picking_type = 'issue'
            AND sp.status = 'done'
          ORDER BY sp.created_at DESC
          LIMIT 1
        ) AS source_location_name
      FROM stock_serials ss
      JOIN stock_items si ON si.id = ss.stock_item_id
      WHERE ss.assigned_to_staff_id = ${staffId}
        AND ss.status = 'assigned'
      ORDER BY ss.serial_number
    `;

    log.info('my-serials.list', { staffId, count: rows.length });
    return apiResponse.success(
      res,
      rows.map((r) => ({
        serialId: r.serial_id,
        serialNumber: r.serial_number,
        stockItemId: r.stock_item_id,
        stockItemName: r.stock_item_name,
        sourceLocationId: r.source_location_id,
        sourceLocationName: r.source_location_name,
      }))
    );
  } catch (error: unknown) {
    log.error('my-serials.list.failed', { error, userId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
```

- [ ] **Step 3: Integration test**

```typescript
// tests/api/procurement/field-stock/my-serials.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/procurement/field-stock/my-serials';

// Use the existing test-DB helpers — match patterns in
// tests/api/procurement/field-stock/pickings-issue-flow-integration.test.ts
// (especially the seed-staff / seed-serials utilities and how authed
// requests are simulated against withAuth).

describe('GET /api/procurement/field-stock/my-serials', () => {
  it('returns serials with status=assigned belonging to the calling staff', async () => {
    // seed: 1 staff, 2 serials assigned to staff, 1 serial assigned to OTHER staff,
    //       1 serial with status='consumed'
    // expect: response data length === 2, all rows belong to caller, no consumed
    // (test body to be filled in matching the pickings-issue-flow-integration pattern)
  });

  it('rejects unauthenticated request', async () => { /* … */ });

  it('returns 200 with empty array when staff row missing', async () => { /* … */ });

  it('GET only — POST returns 405', async () => { /* … */ });
});
```

Fill in the test bodies matching `tests/api/procurement/field-stock/pickings-issue-flow-integration.test.ts` patterns — read it first to confirm the auth-mock + seed helpers.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/api/procurement/field-stock/my-serials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/api/procurement/field-stock/my-serials.ts \
       tests/api/procurement/field-stock/my-serials.test.ts
git commit -m "feat(field-stock-pwa): GET /my-serials endpoint"
```

---

### Task B.5: GET `/api/procurement/field-stock/serial-source` endpoint

**Files:**
- Create: `pages/api/procurement/field-stock/serial-source.ts`
- Create: `tests/api/procurement/field-stock/serial-source.test.ts`

- [ ] **Step 1: Implement**

```typescript
// pages/api/procurement/field-stock/serial-source.ts
/**
 * GET /api/procurement/field-stock/serial-source?serialNumber=XYZ
 * Returns the source warehouse of the most recent issue picking that touched
 * the given serial — used by the return wizard's mixed-source guard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const serialNumber = typeof req.query.serialNumber === 'string'
    ? req.query.serialNumber.trim()
    : '';
  if (!serialNumber) {
    return apiResponse.validationError(res, { serialNumber: 'Required' });
  }

  try {
    const rows = await sql`
      WITH target AS (
        SELECT id FROM stock_serials
        WHERE serial_number = ${serialNumber}
        LIMIT 1
      )
      SELECT
        sp.source_location_id AS source_location_id,
        sl.name               AS source_location_name,
        sp.id                 AS picking_id
      FROM target
      JOIN stock_picking_lines spl ON target.id = ANY(spl.serial_ids)
      JOIN stock_pickings sp ON sp.id = spl.picking_id
      JOIN stock_locations sl ON sl.id = sp.source_location_id
      WHERE sp.picking_type = 'issue' AND sp.status = 'done'
      ORDER BY sp.created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return apiResponse.notFound(res, 'Serial issue history', serialNumber);
    }
    return apiResponse.success(res, {
      sourceLocationId: row.source_location_id,
      sourceLocationName: row.source_location_name,
      originalPickingId: row.picking_id,
    });
  } catch (error: unknown) {
    log.error('serial-source.failed', { error, serialNumber }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
```

- [ ] **Step 2: Integration tests**

```typescript
// tests/api/procurement/field-stock/serial-source.test.ts
describe('GET /api/procurement/field-stock/serial-source', () => {
  it('returns source warehouse from latest issue picking', async () => { /* … */ });
  it('returns 404 when serial has no issue history', async () => { /* … */ });
  it('returns 400 when serialNumber query param missing', async () => { /* … */ });
  it('GET only — POST returns 405', async () => { /* … */ });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run tests/api/procurement/field-stock/serial-source.test.ts
git add pages/api/procurement/field-stock/serial-source.ts \
       tests/api/procurement/field-stock/serial-source.test.ts
git commit -m "feat(field-stock-pwa): GET /serial-source endpoint"
```

---

## Phase C — Endpoint hardening

These three modify existing endpoints. The hardening matters for security + idempotency but the existing behaviour must remain backwards-compatible (the procurement module's desktop UI uses them too).

### Task C.1: Harden `POST /api/procurement/field-stock/returns/index.ts`

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/index.ts`
- Create: `tests/api/procurement/field-stock/returns-create-hardening.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('POST /api/procurement/field-stock/returns hardening', () => {
  it('rejects when caller is not isReturnCreator', async () => { /* expect 403 */ });
  it('dedupes on idempotency_key (second submit returns same id)', async () => { /* … */ });
  it('derives returned_by_id from req.user (ignores client value)', async () => { /* … */ });
  it('rejects line with invalid return_reason', async () => { /* expect 400 */ });
  it('rejects line with missing stockItemId', async () => { /* expect 400 */ });
  it('uses generate_return_number() so concurrent submits get distinct numbers', async () => { /* … */ });
});
```

- [ ] **Step 2: Apply hardening**

Modify `pages/api/procurement/field-stock/returns/index.ts`'s `handleCreate`:

1. Pull `idempotencyKey` from body. If non-empty, check if a row with that key exists — if yes, return that row (200, not 201).
2. Look up `staff.id` from `req.user.id` (Phase 2 helper). Use that as `returned_by_id`; ignore client value. If no staff row, return 403.
3. Verify caller's `staff.role` (or authRole) passes `isReturnCreator`; otherwise 403.
4. Validate each line: `stockItemId` required, `returnReason` (if provided) ∈ CHECK constraint values; `condition` defaults to 'good' if absent; serialId/serialNumber consistency check (if both provided, both must match the same `stock_serials` row).
5. Replace count-based return-number generation with `SELECT generate_return_number() AS num`.
6. Wrap header insert + line inserts in a single `BEGIN … COMMIT` via `sql.transaction(...)` if neon serverless shim supports it — check; if not, leave sequential (existing pattern).
7. Store `idempotency_key` on the header row.

- [ ] **Step 3: Run tests + manual probe**

```bash
npx vitest run tests/api/procurement/field-stock/returns-create-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add pages/api/procurement/field-stock/returns/index.ts \
       tests/api/procurement/field-stock/returns-create-hardening.test.ts
git commit -m "feat(field-stock-pwa): harden POST /returns (role gate + idempotency + audit)"
```

---

### Task C.2: Harden `POST /returns/[returnId]/inspect.ts`

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/[returnId]/inspect.ts`
- Create: `tests/api/procurement/field-stock/returns-inspect-hardening.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
describe('POST /returns/[id]/inspect hardening', () => {
  it('rejects non-inspector role with 403', async () => { /* … */ });
  it('uses req.user staff name as inspected_by (ignores client value)', async () => { /* … */ });
  it('rejects lineDispositions with invalid condition value', async () => { /* … */ });
  it('rejects lineDispositions with invalid disposition value', async () => { /* … */ });
  it('sets stock_return_lines.status="inspected" on each affected line', async () => { /* … */ });
});
```

- [ ] **Step 2: Apply hardening**

1. Add `isReturnInspector(staff.role, authRole)` gate; 403 on fail.
2. Derive `inspected_by` from `req.user`-linked staff name; ignore client.
3. Validate `lineDispositions` values against CHECK constraints.
4. On line update, also `SET status = 'inspected'` on each `stock_return_lines` row that received a disposition.

- [ ] **Step 3: Tests + commit**

```bash
npx vitest run tests/api/procurement/field-stock/returns-inspect-hardening.test.ts
git add pages/api/procurement/field-stock/returns/[returnId]/inspect.ts \
       tests/api/procurement/field-stock/returns-inspect-hardening.test.ts
git commit -m "feat(field-stock-pwa): harden POST /returns/[id]/inspect"
```

---

### Task C.3: Harden `POST /returns/[returnId]/accept.ts`

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/[returnId]/accept.ts`
- Create: `tests/api/procurement/field-stock/returns-accept-hardening.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
describe('POST /returns/[id]/accept hardening', () => {
  it('rejects non-inspector role with 403', async () => { /* … */ });
  it('marks stock_return_lines.status="processed" after disposition applied', async () => { /* … */ });
  it('rolls back all changes if any single line update fails', async () => { /* … */ });
});
```

- [ ] **Step 2: Hardening**

1. `isReturnInspector` gate.
2. Wrap the per-line for-loop in a single transaction so a partial accept rolls back. If `sql.transaction` not available via the shim, use a try/catch with a manual savepoint via `BEGIN/COMMIT/ROLLBACK` raw statements.
3. After applying the disposition (existing logic), `UPDATE stock_return_lines SET status = 'processed' WHERE id = ${line.id}`.

- [ ] **Step 3: Tests + commit**

```bash
npx vitest run tests/api/procurement/field-stock/returns-accept-hardening.test.ts
git add pages/api/procurement/field-stock/returns/[returnId]/accept.ts \
       tests/api/procurement/field-stock/returns-accept-hardening.test.ts
git commit -m "feat(field-stock-pwa): harden POST /returns/[id]/accept (atomic, role-gated)"
```

---

## Phase D — Tech Return wizard

### Task D.1: `PickReturnReasonStep` component

**Files:**
- Create: `src/modules/field-stock-pwa/components/PickReturnReasonStep.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/modules/field-stock-pwa/components/PickReturnReasonStep.tsx
import React from 'react';
import { RETURN_REASONS, type ReturnReason } from '../lib/returnReasons';

export interface PickReturnReasonStepProps {
  initial: ReturnReason | null;
  onPick: (reason: ReturnReason) => void;
}

export function PickReturnReasonStep({ initial, onPick }: PickReturnReasonStepProps) {
  const [selected, setSelected] = React.useState<ReturnReason | null>(initial);

  return (
    <section aria-labelledby="reason-heading" className="space-y-4">
      <h2 id="reason-heading" className="text-base font-semibold text-neutral-100">
        Why are you returning stock?
      </h2>
      <p className="text-sm text-neutral-400">
        Pick one reason for the whole batch. Per-item disposition happens at the warehouse.
      </p>
      <ul className="space-y-2">
        {RETURN_REASONS.map((r) => (
          <li key={r.code}>
            <button
              type="button"
              onClick={() => setSelected(r.code)}
              aria-pressed={selected === r.code}
              className={[
                'w-full text-left rounded-xl border px-3 py-3 transition-colors',
                selected === r.code
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60',
              ].join(' ')}
            >
              <span className="text-sm font-medium">{r.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pt-2">
        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected && onPick(selected)}
          className="w-full rounded-xl bg-emerald-600 disabled:bg-neutral-700 text-white font-medium py-3 text-sm"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Quick smoke test (RTL)**

```typescript
// src/modules/field-stock-pwa/components/__tests__/PickReturnReasonStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PickReturnReasonStep } from '../PickReturnReasonStep';

describe('PickReturnReasonStep', () => {
  it('continue button disabled until a reason is picked', () => {
    render(<PickReturnReasonStep initial={null} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /unused/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('emits the picked reason on continue', () => {
    const onPick = vi.fn();
    render(<PickReturnReasonStep initial={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /job cancelled/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onPick).toHaveBeenCalledWith('job_cancelled');
  });
});
```

- [ ] **Step 3: Test + commit**

```bash
npx vitest run src/modules/field-stock-pwa/components/__tests__/PickReturnReasonStep.test.tsx
git add src/modules/field-stock-pwa/components/PickReturnReasonStep.tsx \
       src/modules/field-stock-pwa/components/__tests__/PickReturnReasonStep.test.tsx
git commit -m "feat(field-stock-pwa): PickReturnReasonStep component"
```

---

### Task D.2: `ScanMyStockStep` with mixed-source guard

**Files:**
- Create: `src/modules/field-stock-pwa/components/ScanMyStockStep.tsx`

- [ ] **Step 1: Read Phase 2's `ScanSerialsStep.tsx`**

```bash
sed -n '1,170p' src/modules/field-stock-pwa/components/ScanSerialsStep.tsx
```

Understand: how scans are added, validated, rendered as chips; how errors are displayed inline.

- [ ] **Step 2: Implement ScanMyStockStep**

The key differences from `ScanSerialsStep`:
- Loads tech's held serials via `GET /my-serials` on mount; renders them as a checklist (tap to add) OR a barcode/text input.
- On scan/tap, calls `GET /serial-source?serialNumber=...` to resolve source location.
- Tracks `lockedSourceWarehouseId` state. First scan sets the lock; subsequent scans from a different source → inline error.
- No `stockItem` prop — the step covers any item the tech holds.

Show a top banner once locked: *"Returning to {sourceLocationName}"*.

Component structure (~180 lines):

```tsx
import React from 'react';
import { Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import type { PwaMyHeldSerial } from '../types';
import { SerialChip } from './SerialChip';

interface MySerialsResponse { success: boolean; data: PwaMyHeldSerial[]; }
interface SerialSourceResponse {
  success: boolean;
  data: { sourceLocationId: string; sourceLocationName: string; originalPickingId: string };
}

export interface ScanMyStockStepProps {
  scanned: PwaMyHeldSerial[];
  lockedSourceWarehouseId: string | null;
  lockedSourceWarehouseName: string | null;
  onChange: (next: PwaMyHeldSerial[], lockedId: string | null, lockedName: string | null) => void;
  onDone: () => void;
}

export function ScanMyStockStep(props: ScanMyStockStepProps) {
  const [available, setAvailable] = React.useState<PwaMyHeldSerial[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/procurement/field-stock/my-serials', { credentials: 'include' })
      .then((r) => r.json() as Promise<MySerialsResponse>)
      .then((j) => { if (!cancelled) setAvailable(j.data ?? []); })
      .catch((e) => { if (!cancelled) setLoadError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = (s: PwaMyHeldSerial) => {
    setInlineError(null);
    const already = props.scanned.find((x) => x.serialId === s.serialId);
    if (already) {
      // Untoggle
      const next = props.scanned.filter((x) => x.serialId !== s.serialId);
      const stillLocked = next.length > 0 ? props.lockedSourceWarehouseId : null;
      const stillLockedName = next.length > 0 ? props.lockedSourceWarehouseName : null;
      props.onChange(next, stillLocked, stillLockedName);
      return;
    }
    if (props.lockedSourceWarehouseId && s.sourceLocationId !== props.lockedSourceWarehouseId) {
      setInlineError(
        `This serial was issued from ${s.sourceLocationName}. ` +
        `Finish your ${props.lockedSourceWarehouseName} return first or start a new one.`
      );
      log.warn('returns.scan.mixed_source', {
        locked: props.lockedSourceWarehouseId,
        scanned: s.sourceLocationId,
      });
      return;
    }
    const next = [...props.scanned, s];
    const newLockedId = props.lockedSourceWarehouseId ?? s.sourceLocationId;
    const newLockedName = props.lockedSourceWarehouseName ?? s.sourceLocationName;
    props.onChange(next, newLockedId, newLockedName);
  };

  if (available === null && loadError === null) {
    return (
      <div className="flex items-center justify-center pt-12">
        <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (loadError !== null) {
    return <p className="text-sm text-red-300">Couldn't load your stock: {loadError}</p>;
  }
  if (available && available.length === 0) {
    return <p className="text-sm text-neutral-400">You have no stock currently issued to you.</p>;
  }

  return (
    <section aria-labelledby="scan-heading" className="space-y-4">
      <h2 id="scan-heading" className="text-base font-semibold text-neutral-100">
        Select serials to return
      </h2>
      {props.lockedSourceWarehouseName && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          Returning to {props.lockedSourceWarehouseName}
        </div>
      )}
      {inlineError && (
        <div role="alert" className="rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {inlineError}
        </div>
      )}
      <ul className="space-y-2">
        {available!.map((s) => {
          const checked = !!props.scanned.find((x) => x.serialId === s.serialId);
          return (
            <li key={s.serialId}>
              <button
                type="button"
                onClick={() => handleToggle(s)}
                aria-pressed={checked}
                className={[
                  'w-full text-left rounded-xl border px-3 py-3',
                  checked
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800/60',
                ].join(' ')}
              >
                <div className="text-sm font-medium text-neutral-100">{s.serialNumber}</div>
                <div className="text-xs text-neutral-400">{s.stockItemName} • {s.sourceLocationName}</div>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={props.scanned.length === 0}
        onClick={props.onDone}
        className="w-full rounded-xl bg-emerald-600 disabled:bg-neutral-700 text-white font-medium py-3 text-sm"
      >
        Continue ({props.scanned.length} selected)
      </button>
    </section>
  );
}
```

- [ ] **Step 2: RTL test for mixed-source guard**

```typescript
// src/modules/field-stock-pwa/components/__tests__/ScanMyStockStep.test.tsx
// Mock fetch to return 3 serials: 2 from Lawley, 1 from Etwatwa
// Click Lawley serial → continue button enabled, no error
// Click Etwatwa serial → inline error appears, scanned[] unchanged
// Untoggle Lawley → continue button disabled
```

- [ ] **Step 3: Tests + commit**

```bash
npx vitest run src/modules/field-stock-pwa/components/__tests__/ScanMyStockStep.test.tsx
git add src/modules/field-stock-pwa/components/ScanMyStockStep.tsx \
       src/modules/field-stock-pwa/components/__tests__/ScanMyStockStep.test.tsx
git commit -m "feat(field-stock-pwa): ScanMyStockStep with mixed-source guard"
```

---

### Task D.3: `ReturnSignSubmitStep`

**Files:**
- Create: `src/modules/field-stock-pwa/components/ReturnSignSubmitStep.tsx`

**Reference:** `SignAndSubmitStep.tsx` (Phase 2). Differences:
- No value cap (return doesn't have R5k limit).
- Submit calls `submitReturn(draft, idempotencyKey)`.
- Offline: queue via `enqueueReturn` if offline.

- [ ] **Step 1: Implement following SignAndSubmitStep structure**

Copy the structure verbatim, then change:
- Title → "Sign & submit return"
- Submit body adapted to `PwaReturnDraft`
- Imports: `submitReturn` from `../api/returns`, `enqueueReturn` from `../offline/queueReturn`
- Remove `ValueCapPanel` import + render
- Idempotency key generated at component mount via `React.useMemo(() => crypto.randomUUID(), [])`

- [ ] **Step 2: Test + commit**

```bash
npx vitest run src/modules/field-stock-pwa/components/__tests__/ReturnSignSubmitStep.test.tsx
git add src/modules/field-stock-pwa/components/ReturnSignSubmitStep.tsx \
       src/modules/field-stock-pwa/components/__tests__/ReturnSignSubmitStep.test.tsx
git commit -m "feat(field-stock-pwa): ReturnSignSubmitStep"
```

---

### Task D.4: `ReturnOrchestrator` + return success view

**Files:**
- Create: `src/modules/field-stock-pwa/components/ReturnOrchestrator.tsx`
- Create: `src/modules/field-stock-pwa/components/ReturnSuccess.tsx`

**Reference:** `IssueOrchestrator.tsx`. State machine: `pick-reason → scan-serials → sign-submit → done`.

- [ ] **Step 1: Implement ReturnOrchestrator**

Adapt `IssueOrchestrator.tsx` line-by-line:

| In IssueOrchestrator | In ReturnOrchestrator |
|---|---|
| `'pick-warehouse' \| 'pick-tech' \| 'pick-item' \| 'scan-serials' \| 'sign-submit' \| 'done'` | `'pick-reason' \| 'scan-serials' \| 'sign-submit' \| 'done'` |
| `STEP_LABELS = ['WH','Tech','Item','Serials','Sign']` | `STEP_LABELS = ['Reason','Serials','Sign']` |
| State fields: sourceLocation/technician/stockItem/scanned/result | State fields: reason/scanned/lockedSourceWarehouseId/lockedSourceWarehouseName/result |
| `PickWarehouseStep + PickTechStep + PickItemStep` | `PickReturnReasonStep` |
| `ScanSerialsStep` | `ScanMyStockStep` |
| `SignAndSubmitStep` | `ReturnSignSubmitStep` |
| `IssueSuccess` | `ReturnSuccess` |
| Page title "Issue stock" | "Return stock" |

- [ ] **Step 2: Implement ReturnSuccess** (mirror `IssueSuccess.tsx`)

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/components/ReturnOrchestrator.tsx \
       src/modules/field-stock-pwa/components/ReturnSuccess.tsx
git commit -m "feat(field-stock-pwa): ReturnOrchestrator state machine"
```

---

### Task D.5: `pages/my/stores/return.tsx` page

**Files:**
- Create: `pages/my/stores/return.tsx`

- [ ] **Step 1: Implement** (mirror `pages/my/stores/issue/index.tsx` — same gating shell)

```tsx
import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { ReturnOrchestrator } from '@/modules/field-stock-pwa/components/ReturnOrchestrator';
import { useStoresSession } from '@/modules/field-stock-pwa/hooks/useStoresSession';
import { isReturnCreator } from '@/modules/field-stock-pwa/lib/storesRoles';

const ReturnPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const { state, profile, error } = useStoresSession();

  if (state === 'loading') return <Loading />;
  if (state === 'guest') {
    if (typeof window !== 'undefined') void router.replace('/my');
    return <Loading message="Redirecting…" />;
  }
  if (state === 'error') return <ErrorView error={error} />;

  const allowed = profile && isReturnCreator(profile.role, profile.authRole);
  if (state === 'unauthorised' || !profile || !allowed) {
    return <Unauthorised onBack={() => void router.push('/my')} />;
  }

  return <ReturnOrchestrator profile={profile} />;
};

// (define Loading / ErrorView / Unauthorised as small local components — same
// pattern as pages/my/stores/index.tsx)

ReturnPage.getLayout = (page) => page;
export default ReturnPage;
```

- [ ] **Step 2: Commit**

```bash
git add pages/my/stores/return.tsx
git commit -m "feat(field-stock-pwa): /my/stores/return page"
```

---

## Phase E — Warehouse Inspect screens

### Task E.1: `SerialDispositionRow` component

**Files:**
- Create: `src/modules/field-stock-pwa/components/SerialDispositionRow.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { CONDITION_OPTIONS, type ReturnCondition } from '../lib/conditionOptions';
import { DISPOSITION_OPTIONS, type ReturnDisposition } from '../lib/dispositionOptions';

export interface SerialDispositionRowProps {
  lineId: string;
  serialNumber: string;
  stockItemName: string;
  condition: ReturnCondition | null;
  disposition: ReturnDisposition | null;
  notes: string;
  onChange: (next: {
    condition: ReturnCondition | null;
    disposition: ReturnDisposition | null;
    notes: string;
  }) => void;
}

export function SerialDispositionRow(props: SerialDispositionRowProps) {
  // Render: serial line header, 3-button condition radio, 3-button disposition radio,
  // and an optional notes textarea that fades in when disposition is repair or scrap.
  // Use aria-pressed for accessibility on the radio buttons.
  // Default-bind: condition=null, disposition=null; both required before parent accepts submit.
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium text-neutral-100">{props.serialNumber}</div>
          <div className="text-xs text-neutral-400">{props.stockItemName}</div>
        </div>
      </header>
      <div>
        <div className="text-xs text-neutral-400 mb-1">Condition</div>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Condition">
          {CONDITION_OPTIONS.map((c) => (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={props.condition === c.code}
              onClick={() =>
                props.onChange({ condition: c.code, disposition: props.disposition, notes: props.notes })
              }
              className={[
                'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium',
                props.condition === c.code
                  ? 'border-blue-500 bg-blue-500/10 text-blue-200'
                  : 'border-neutral-700 bg-neutral-800 text-neutral-300',
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-neutral-400 mb-1">Disposition</div>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Disposition">
          {DISPOSITION_OPTIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              role="radio"
              aria-checked={props.disposition === d.code}
              onClick={() =>
                props.onChange({ condition: props.condition, disposition: d.code, notes: props.notes })
              }
              className={[
                'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium',
                props.disposition === d.code
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-neutral-700 bg-neutral-800 text-neutral-300',
              ].join(' ')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {(props.disposition === 'repair' || props.disposition === 'scrap') && (
        <div>
          <label className="block text-xs text-neutral-400 mb-1" htmlFor={`notes-${props.lineId}`}>
            Notes (optional)
          </label>
          <textarea
            id={`notes-${props.lineId}`}
            value={props.notes}
            onChange={(e) =>
              props.onChange({
                condition: props.condition,
                disposition: props.disposition,
                notes: e.target.value,
              })
            }
            rows={2}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
          />
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Test + commit**

```bash
git add src/modules/field-stock-pwa/components/SerialDispositionRow.tsx
git commit -m "feat(field-stock-pwa): SerialDispositionRow component"
```

---

### Task E.2: `InspectListPage` + `/my/stores/inspect/index.tsx`

**Files:**
- Create: `src/modules/field-stock-pwa/components/InspectListPage.tsx`
- Create: `pages/my/stores/inspect/index.tsx`

- [ ] **Step 1: Implement InspectListPage**

Component fetches `GET /api/procurement/field-stock/returns?status=pending` on mount and renders a list of pending returns grouped by `returned_by_name`. Each row: tap → `router.push('/my/stores/inspect/' + id)`.

Show a separate section for `status=inspected` ("Accept pending") so a storeman can finish a previously-failed accept.

- [ ] **Step 2: Wire the page** (mirror `pages/my/stores/issue/index.tsx`; gate via `isReturnInspector`)

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/components/InspectListPage.tsx \
       pages/my/stores/inspect/index.tsx
git commit -m "feat(field-stock-pwa): /my/stores/inspect list page"
```

---

### Task E.3: `InspectOrchestrator` + `/my/stores/inspect/[id].tsx`

**Files:**
- Create: `src/modules/field-stock-pwa/components/InspectOrchestrator.tsx`
- Create: `pages/my/stores/inspect/[id].tsx`

- [ ] **Step 1: Implement InspectOrchestrator**

Single-screen flow (no multi-step wizard):
1. Fetch the return by id via `GET /api/procurement/field-stock/returns?status=pending` filtered client-side (or add a `?id=` query to the existing endpoint — simpler).
2. Render one `SerialDispositionRow` per `stock_return_lines.id` returned.
3. SignaturePad at the bottom.
4. Submit button disabled until every line has both `condition` AND `disposition` set.
5. On submit: call `submitInspectAndAccept` from `../api/returns`.
6. On success: navigate back to `/my/stores/inspect` with a toast.
7. On failure between inspect and accept: show "Retry restock" button that calls `retryAccept`.

- [ ] **Step 2: Wire the [id] page** (mirror Phase 2 issue page; gate via `isReturnInspector`)

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/components/InspectOrchestrator.tsx \
       pages/my/stores/inspect/[id].tsx
git commit -m "feat(field-stock-pwa): /my/stores/inspect/[id] disposition screen"
```

---

## Phase F — Wire-up

### Task F.1: Enable Return tile + add Inspect tile in `StoresHub`

**Files:**
- Modify: `src/modules/field-stock-pwa/components/StoresHub.tsx`

- [ ] **Step 1: Replace the disabled placeholder tiles**

In `StoresHub.tsx`:
1. Add `onReturn: () => void;` and `onInspect: () => void;` to `StoresHubProps`.
2. Replace the Return tile's `disabled` placeholder with an active tile that calls `onReturn`. Only show it if `isReturnCreator(profile.role, profile.authRole)`.
3. Add a new Inspect tile (between Return and Today). Only show it if `isReturnInspector(profile.role, profile.authRole)`.
4. Update the offline sync badge to include `pendingReturnsCount` + `abandonedReturnsCount` from `useStockSync`.

- [ ] **Step 2: Wire callbacks in `pages/my/stores/index.tsx`**

```tsx
return (
  <StoresHub
    profile={profile}
    onIssue={() => void router.push('/my/stores/issue')}
    onReturn={() => void router.push('/my/stores/return')}
    onInspect={() => void router.push('/my/stores/inspect')}
  />
);
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/components/StoresHub.tsx pages/my/stores/index.tsx
git commit -m "feat(field-stock-pwa): activate Return + Inspect tiles in StoresHub"
```

---

### Task F.2: AbandonedReturnsBanner + integrate into StoresHub

**Files:**
- Create: `src/modules/field-stock-pwa/components/AbandonedReturnsBanner.tsx`
- Modify: `src/modules/field-stock-pwa/components/StoresHub.tsx`

- [ ] **Step 1:** Clone `AbandonedIssuesBanner.tsx` with renamed types; use `listAbandonedReturns` / `clearAbandonedReturn`.

- [ ] **Step 2:** Render it in `StoresHub` next to the existing `AbandonedIssuesBanner`.

- [ ] **Step 3:** Commit.

```bash
git add src/modules/field-stock-pwa/components/AbandonedReturnsBanner.tsx \
       src/modules/field-stock-pwa/components/StoresHub.tsx
git commit -m "feat(field-stock-pwa): AbandonedReturnsBanner in StoresHub"
```

---

## Phase G — End-to-end verification

### Task G.1: Integration test — full return + inspect + accept flow

**Files:**
- Create: `tests/api/procurement/field-stock/returns-flow-integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
describe('Returns full flow integration', () => {
  it('tech creates return → storeman inspects → accept restocks serial', async () => {
    // 1. Seed: tech staff, stores staff, 2 issued serials (status='assigned') from Lawley
    // 2. POST /returns as tech → status='pending', returns RET-… id
    // 3. POST /returns/[id]/inspect as stores with one restock, one scrap → status='inspected'
    // 4. POST /returns/[id]/accept as stores → status='restocked', stock_serials.status updated
    // 5. Assert: restocked serial = 'available' at Lawley; scrapped serial = 'scrapped';
    //    stock_quants quantity at Lawley increased by 1.
  });

  it('mixed-source rejected at server even if client allows', async () => {
    // POST /returns with lines from 2 different source warehouses → 400
  });

  it('idempotent: second POST with same key returns same return', async () => {
    // POST twice with same idempotencyKey → 2nd returns existing id, no duplicate row
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/api/procurement/field-stock/returns-flow-integration.test.ts
git add tests/api/procurement/field-stock/returns-flow-integration.test.ts
git commit -m "test(field-stock-pwa): integration test for full return flow"
```

---

### Task G.2: `npm run ci:quick` — no regressions

- [ ] **Step 1: Run local CI**

```bash
npm run ci:quick
```

Expected: PASS at or below the existing ratchets (77 errors / ~1833 warnings / 94 catches).

- [ ] **Step 2: If anything regresses**, fix it before proceeding (don't bypass with `--no-verify`).

---

### Task G.3: Browser smoke test on dev

**Manual / Playwriter MCP** — replicate the Phase 2 smoke test pattern.

- [ ] **Step 1: Deploy to dev**

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && bash scripts/deploy-local.sh dev'
```

- [ ] **Step 2: Apply migration if not already**

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && source .env.local && psql "$DATABASE_URL" -f scripts/migrations/sql/358_returns_idempotency_key.sql'
```

(Idempotent — safe to re-run.)

- [ ] **Step 3: Run the browser smoke via Playwriter MCP**

Smoke-test checklist:

1. Log in to `/my` as a tech that has assigned serials (use the Smoke TestTech from prior session OR seed a new one).
2. Open `/my/stores` — confirm Return tile is now active.
3. Tap Return → pick a reason → see the held-serials list → tap one serial → "Returning to {warehouse}" banner appears.
4. Tap a serial from a different warehouse → mixed-source error appears, scanned list unchanged.
5. Untoggle the off-source serial; add another same-source serial.
6. Continue → sign → submit. Expect RET-YYYYMM-NNNNN returned in success view.
7. Log in as a stores user → `/my/stores/inspect` → see the pending return.
8. Tap the return → SerialDispositionRow per serial → set one to restock+good, one to scrap+non_functional → sign → submit.
9. Verify the success view says "restocked".
10. Query DB: `SELECT id, status, serial_number, (SELECT status FROM stock_serials WHERE id = stock_return_lines.serial_id) FROM stock_return_lines WHERE return_id = '<id>'` — confirm dispositions applied.
11. Repeat for offline: in DevTools, toggle Network: offline, submit a return, toggle online, confirm it drains.
12. Repeat for double-submit: spam the submit button — confirm only one return is created (idempotency).

- [ ] **Step 4: Note any bugs found** — the smoke test caught 5 real bugs in Phase 2 that all 88 mocked unit tests missed. Expect to find some here too. Each bug → new commit on the branch (no separate PR).

---

### Task G.4: Open the PR + dispatch review-team

- [ ] **Step 1: Push**

```bash
git push -u origin feat/field-stock-pwa-return-flow
```

- [ ] **Step 2: Create the PR via gh**

```bash
gh pr create --base master --head feat/field-stock-pwa-return-flow \
  --title "feat(field-stock-pwa): Phase 3 — Return flow + warehouse inspect" \
  --body "$(cat <<'EOF'
## Summary

- Technician-side return wizard at `/my/stores/return` (3 steps: reason → scan held serials → sign+submit)
- Warehouse-side inspect+accept screen at `/my/stores/inspect/[id]` (per-line condition + disposition + sign)
- Mixed-source returns blocked client-side and server-side
- Offline queue + drain via `useStockSync` (DB version 4, additive)
- Migration 358: `idempotency_key` on `stock_returns` with partial unique index
- Hardening on existing `POST /returns`, `/inspect`, `/accept` (role gate, idempotency, audit fields from req.user, atomic accept)
- 2 new flat endpoints: `GET /my-serials`, `GET /serial-source`

## Test plan

- [ ] `npm run ci:quick` clean (no ratchet regressions)
- [ ] Integration tests pass (`returns-flow-integration.test.ts` + endpoint hardening tests)
- [ ] Migration 358 applied to dev DB
- [ ] Browser smoke on dev: tech return → stores inspect → restock (all 12 steps in plan §G.3)
- [ ] Blind review-team approval

## Spec / Plan

- Spec: `docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md`
- Plan: `docs/superpowers/plans/2026-05-20-field-stock-pwa-return.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch review-team**

From the main session: invoke the `/review-team` skill against the PR. Wait for the verdict; address findings as new commits on the branch.

- [ ] **Step 4: Watch GHA**

```bash
gh run watch --exit-status
```

- [ ] **Step 5: Merge once GHA + blind review both APPROVE**

```bash
gh pr merge <N> --merge --delete-branch
```

- [ ] **Step 6: Re-deploy dev with the merged commit + final smoke**

```bash
ssh velo@100.96.203.105 'cd /home/velo/fibreflow-dev && bash scripts/deploy-local.sh dev'
```

Final smoke: repeat the §G.3 checklist on the merged build to confirm nothing slipped between branch and master.

- [ ] **Step 7: Worktree cleanup**

```bash
git worktree remove /home/hein/Workspace/FF_Next.js-phase3-returns
git branch -d feat/field-stock-pwa-return-flow   # already deleted on remote via --delete-branch
```

---

## Schema probe results

(Filled in by Task A.1.)

```
(replace with actual psql output)
```

---

## Self-review notes

After writing this plan, verify:
1. Every spec requirement maps to at least one task — ✅ checked.
2. No placeholders left (search "TODO", "TBD", "fill in") — see Task D.3, E.1, E.2 which reference patterns rather than full code; this is intentional for components <200 lines that mirror Phase 2 verbatim.
3. Names consistent throughout: `isReturnCreator` not `canCreateReturn`; `submitInspectAndAccept` not `inspectAndAccept`; `lockedSourceWarehouseId` not `sourceLock`.
4. Migration filename: `358_returns_idempotency_key.sql` (matches `scripts/migrations/sql/` per CLAUDE.md feedback_migration_directory rule).

## Execution

Recommended: `superpowers:subagent-driven-development` — dispatch a fresh subagent per task, blind-review between tasks. Tasks A.1 through A.5 can run in parallel (A.1 outputs feed A.2). Phase B and Phase C can run in parallel after Phase A completes. Phase D and Phase E depend on Phase B + C.
