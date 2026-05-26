# Sprint D — Pure Custody Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track field stock against holders (people/contractor orgs) instead of synthetic technician-locations: a holder-keyed `stock_custody` balance posted through the single `field_stock_movements` ledger, live accountability views, and a holder-centric Accountability UI — retiring the 5 technician-locations.

**Architecture:** Mirror Sprint A's `postGrnReceiptLines` (executor-injected, unit-testable posting helper inside a `pg.Pool` transaction). Custody balances live in a new `stock_custody` table; every issue/consume/return writes a balancing `field_stock_movements` row with nullable holder endpoints. Accountability numbers come from a live `v_holder_accountability` view (no trigger-cached counters); block-state persists in a thin `stock_accountability` table. Legacy contractor-grain consumers stay alive behind a `v_contractor_accountability` rollup shim.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript, PostgreSQL (self-hosted Supabase), `pg.Pool` via `@/lib/db-pool`, vitest. Spec: `docs/superpowers/specs/2026-05-26-pure-custody-model-sprintD-design.md`.

**Worktree/branch:** `feat/ff-custody-model-sprintD` @ `/home/hein/Workspace/FF_Next.js-ff-custody-sprintD` (off `origin/master` `9e6047be4`). Each Task below = one stacked PR; `ci:quick` + `tsc --noEmit` before each push; review-team blind review with the RAW diff; merge only after APPROVED + CI green.

**Controller-owned (NOT delegated to implementer subagents):** applying migration 384 to the shared DB, the cutover script's `--commit` run, and the draft-picking cleanup (per `feedback_subagent_db_mutations_controller`).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `scripts/migrations/sql/384_pure_custody_model.sql` | tables, holder columns, CHECKs, 2 views, trigger cleanup | T1 |
| `scripts/migrations/sql/rollback_384_pure_custody_model.sql` | full reverse incl. trigger-body restore | T1 |
| `src/modules/procurement/field-stock/services/custodyService.ts` | executor-injected custody postings (issue/consume/return) + db-pool wrappers | T2 |
| `tests/services/stock/custodyService.test.ts` | fake-exec unit tests for the postings | T2 |
| `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts` | issue picking → custody (pg.Pool txn) | T3 |
| `src/modules/procurement/field-stock/services/consumptionService.ts` | consume → debit custody, clear serial holder | T4 |
| `pages/api/procurement/field-stock/returns/[returnId]/accept.ts` | return → debit custody, credit warehouse | T5 |
| `src/modules/procurement/field-stock/services/locationService.ts` | deprecate `getOrCreateTechnicianLocation` | T6 |
| `scripts/retire-technician-locations.ts` | cutover: deactivate 5 tech-locations + clean draft pickings | T6 |
| `pages/api/procurement/field-stock/accountability/holders/index.ts` | NEW holder-grain list (reads `v_holder_accountability`) | T7 |
| `pages/api/procurement/field-stock/accountability/holders/[holderId]/{index,block,unblock}.ts` | NEW holder detail + block/unblock (writes `stock_accountability`) | T7 |
| `pages/api/procurement/field-stock/accountability/index.ts` + `[contractorId]/index.ts` | repoint legacy reads to `v_contractor_accountability` shim | T7 |
| `src/modules/procurement/field-stock/hooks/useHolderAccountability.ts` | NEW client hook | T8 |
| `src/modules/procurement/field-stock/components/accountability/HolderAccountabilityList.tsx` | NEW holder-centric list | T8 |
| `pages/procurement/field-stock/index.tsx` | `AccountabilityTabContent` → holder list | T8 |

---

## Task 1: Migration 384 — schema foundation  *(controller applies; one PR)*

**Files:**
- Create: `scripts/migrations/sql/384_pure_custody_model.sql`
- Create: `scripts/migrations/sql/rollback_384_pure_custody_model.sql`

- [ ] **Step 1: Re-confirm the version + collision check**

Run:
```bash
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -tAc "SELECT MAX(version) FROM migrations;"
gh pr list --search 'migration in:title' --state open
```
Expected: max = `383`; no open migration PR claiming `384`. If `384` is taken, bump to the next free number consistently across both files (`feedback_migration_version_collision`).

- [ ] **Step 2: Write `384_pure_custody_model.sql`**

```sql
-- 384_pure_custody_model.sql
-- Sprint D: pure custody model. Holder-keyed balance + ledger holder endpoints +
-- live accountability views + obsolete-trigger cleanup.
-- See docs/superpowers/specs/2026-05-26-pure-custody-model-sprintD-design.md
BEGIN;

-- 1. Holder-keyed custody balance (mirrors stock_quants shape + ON CONFLICT key)
CREATE TABLE IF NOT EXISTS stock_custody (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id          uuid NOT NULL REFERENCES stock_holders(id),
  stock_item_id      uuid NOT NULL REFERENCES stock_items(id),
  lot_number         varchar(100),
  quantity           numeric(12,3) NOT NULL DEFAULT 0,
  reserved_quantity  numeric(12,3) DEFAULT 0,
  unit_cost          numeric(12,2),
  total_value        numeric(14,2),
  last_movement_date timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_custody_unique
  ON stock_custody (holder_id, stock_item_id, COALESCE(lot_number, ''));
CREATE INDEX IF NOT EXISTS idx_stock_custody_holder ON stock_custody (holder_id);
CREATE INDEX IF NOT EXISTS idx_stock_custody_item   ON stock_custody (stock_item_id);

-- 2. Persistent accountability decisions only (numbers come from the view)
CREATE TABLE IF NOT EXISTS stock_accountability (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id                uuid NOT NULL UNIQUE REFERENCES stock_holders(id),
  is_blocked               boolean NOT NULL DEFAULT false,
  blocked_reason           text,
  blocked_at               timestamptz,
  blocked_by               varchar(255),
  pending_recovery_amount  numeric(14,2) DEFAULT 0,
  recovered_amount         numeric(14,2) DEFAULT 0,
  last_reconciliation_date timestamptz,
  last_reconciliation_by   varchar(255),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_accountability_blocked ON stock_accountability (is_blocked);

-- 3. Holder endpoints on the single ledger (back-compatible: existing 496 rows have holder cols NULL)
ALTER TABLE field_stock_movements
  ADD COLUMN IF NOT EXISTS from_holder_id uuid REFERENCES stock_holders(id),
  ADD COLUMN IF NOT EXISTS to_holder_id   uuid REFERENCES stock_holders(id);
ALTER TABLE field_stock_movements
  ADD CONSTRAINT field_stock_movements_from_endpoint_chk
    CHECK (from_location_id IS NULL OR from_holder_id IS NULL),
  ADD CONSTRAINT field_stock_movements_to_endpoint_chk
    CHECK (to_location_id IS NULL OR to_holder_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_fsm_from_holder ON field_stock_movements (from_holder_id) WHERE from_holder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_to_holder   ON field_stock_movements (to_holder_id)   WHERE to_holder_id   IS NOT NULL;

-- 4. Holder on serials + the issue/consume documents
ALTER TABLE stock_serials      ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
ALTER TABLE stock_pickings     ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
ALTER TABLE stock_consumptions ADD COLUMN IF NOT EXISTS holder_id uuid REFERENCES stock_holders(id);
CREATE INDEX IF NOT EXISTS idx_stock_serials_holder ON stock_serials (holder_id) WHERE holder_id IS NOT NULL;

-- 5. Live holder accountability view
CREATE OR REPLACE VIEW v_holder_accountability AS
SELECT
  h.id AS holder_id, h.holder_type, h.staff_id, h.contractor_id, h.name, h.is_active,
  COALESCE(iss.cnt, 0)  AS issued_count,    COALESCE(iss.val, 0)  AS issued_value,
  COALESCE(con.cnt, 0)  AS consumed_count,  COALESCE(con.val, 0)  AS consumed_value,
  COALESCE(ret.cnt, 0)  AS returned_count,  COALESCE(ret.val, 0)  AS returned_value,
  COALESCE(held.qty, 0) AS held_count,      COALESCE(held.val, 0) AS held_value,
  COALESCE(iss.cnt,0) - COALESCE(con.cnt,0) - COALESCE(ret.cnt,0) - COALESCE(held.qty,0) AS unaccounted_count,
  COALESCE(sa.is_blocked, false) AS is_blocked,
  sa.blocked_reason, sa.blocked_at, sa.blocked_by,
  COALESCE(sa.pending_recovery_amount, 0) AS pending_recovery_amount,
  COALESCE(sa.recovered_amount, 0)        AS recovered_amount,
  sa.last_reconciliation_date, sa.last_reconciliation_by
FROM stock_holders h
LEFT JOIN stock_accountability sa ON sa.holder_id = h.id
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE to_holder_id   = h.id AND movement_type='issue')       iss ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE from_holder_id = h.id AND movement_type='consumption') con ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val FROM field_stock_movements
                   WHERE from_holder_id = h.id AND movement_type='return')      ret ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) qty, SUM(total_value) val FROM stock_custody
                   WHERE holder_id = h.id)                                      held ON true;

-- 6. Contractor rollup shim (keeps legacy contractor-grain consumers alive)
CREATE OR REPLACE VIEW v_contractor_accountability AS
SELECT
  h.contractor_id,
  SUM(va.issued_count)            AS total_issued_count,
  SUM(va.consumed_count)          AS total_consumed_count,
  SUM(va.returned_count)          AS total_returned_count,
  SUM(va.held_count)              AS current_held_count,
  SUM(va.held_value)              AS current_held_value,
  SUM(va.unaccounted_count)       AS unaccounted_count,
  bool_or(va.is_blocked)          AS is_blocked,
  SUM(va.pending_recovery_amount) AS pending_recovery_amount
FROM v_holder_accountability va
JOIN stock_holders h ON h.id = va.holder_id
WHERE h.contractor_id IS NOT NULL
GROUP BY h.contractor_id;

-- 7. Trigger cleanup (verified safe — R3 in the spec)
--   (a) drop the fully-obsolete mig-029 accountability trigger + function
DROP TRIGGER IF EXISTS trg_update_accountability_on_issue ON stock_pickings;
DROP FUNCTION IF EXISTS update_accountability_on_issue();
--   (b) re-create the mig-366 picking-done trigger fn WITHOUT the contractor_stock_accountability
--       counter block; keep serial-event emission + serial status update verbatim.
CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done()
RETURNS TRIGGER AS $$
DECLARE
  v_serial_id  UUID;
  v_event_type VARCHAR(50);
  v_to_state   VARCHAR(50);
BEGIN
  BEGIN
    IF NEW.picking_type = 'transfer' THEN
      v_event_type := 'transferred'; v_to_state := 'in_transit';
    ELSE
      v_event_type := 'issued';      v_to_state := 'issued';
    END IF;

    FOR v_serial_id IN
      SELECT unnest(spl.serial_ids) FROM stock_picking_lines spl
      WHERE spl.picking_id = NEW.id AND spl.serial_ids IS NOT NULL
        AND array_length(spl.serial_ids, 1) > 0
    LOOP
      INSERT INTO stock_serial_events
        (serial_id, event_type, from_state, to_state, source_table, source_id, actor_staff_id, payload, occurred_at)
      SELECT v_serial_id, v_event_type, ss.status, v_to_state, 'stock_pickings', NEW.id, NEW.technician_id,
             jsonb_build_object('picking_type', NEW.picking_type),
             COALESCE(NEW.signed_at, NEW.effective_date, NEW.approved_at, NOW())
      FROM stock_serials ss WHERE ss.id = v_serial_id
      ON CONFLICT (serial_id, source_table, source_id, event_type) WHERE source_id IS NOT NULL DO NOTHING;

      UPDATE stock_serials SET status = v_to_state, updated_at = NOW()
      WHERE id = v_serial_id AND status NOT IN ('faulty','scrapped','in_repair','returned');
    END LOOP;
    -- NOTE: contractor_stock_accountability counter block REMOVED (Sprint D — live view supersedes it).
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trg_emit_serial_event_on_picking_done: % — %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO migrations (version, name, executed_at)
VALUES ('384', 'pure_custody_model', NOW());

COMMIT;
```

- [ ] **Step 3: Write `rollback_384_pure_custody_model.sql`**

```sql
-- rollback_384_pure_custody_model.sql
BEGIN;
DROP VIEW IF EXISTS v_contractor_accountability;
DROP VIEW IF EXISTS v_holder_accountability;
ALTER TABLE field_stock_movements
  DROP CONSTRAINT IF EXISTS field_stock_movements_from_endpoint_chk,
  DROP CONSTRAINT IF EXISTS field_stock_movements_to_endpoint_chk;
ALTER TABLE field_stock_movements DROP COLUMN IF EXISTS from_holder_id, DROP COLUMN IF EXISTS to_holder_id;
ALTER TABLE stock_serials      DROP COLUMN IF EXISTS holder_id;
ALTER TABLE stock_pickings     DROP COLUMN IF EXISTS holder_id;
ALTER TABLE stock_consumptions DROP COLUMN IF EXISTS holder_id;
DROP TABLE IF EXISTS stock_accountability;
DROP TABLE IF EXISTS stock_custody;
-- Restore the mig-366 trigger body (with the contractor counter block) — copy verbatim
-- from scripts/migrations/sql/366_fix_picking_trigger_done_at.sql, then:
-- CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done() ... (366 body) ...
-- (mig-029 trg_update_accountability_on_issue intentionally NOT restored — superseded.)
DELETE FROM migrations WHERE version = '384';
COMMIT;
```
> When writing the rollback, paste the full 366 function body in place of the comment so the rollback is runnable (no placeholder at execution time).

- [ ] **Step 4: Apply the migration (CONTROLLER ONLY)**

The controller (not an implementer subagent) applies it to the shared DB:
```bash
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -f scripts/migrations/sql/384_pure_custody_model.sql
```
Expected: `INSERT 0 1` into migrations; no error.

- [ ] **Step 5: Verify schema + back-compat + negative CHECK**

```bash
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -P pager=off -c "\d stock_custody" -c "\d stock_accountability" \
  -c "SELECT count(*) FROM field_stock_movements WHERE from_holder_id IS NULL;"   -- expect 496 (all existing pass)
# negative test: both endpoints on one side must be rejected
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -c "
INSERT INTO field_stock_movements (stock_item_id, movement_type, from_location_id, from_holder_id, quantity)
SELECT (SELECT id FROM stock_items LIMIT 1),'issue',
       (SELECT id FROM stock_locations LIMIT 1),(SELECT id FROM stock_holders LIMIT 1),1;"
```
Expected: `\d` shows both tables; the count is 496; the negative INSERT FAILS with `field_stock_movements_from_endpoint_chk`.

- [ ] **Step 6: Verify the views return rows + trigger cleanup**

```bash
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -P pager=off \
  -c "SELECT holder_id, name, issued_count, held_count, unaccounted_count, is_blocked FROM v_holder_accountability ORDER BY name;" \
  -c "SELECT count(*) FROM v_contractor_accountability;" \
  -c "SELECT tgname FROM pg_trigger WHERE tgrelid='stock_pickings'::regclass AND NOT tgisinternal;"
```
Expected: 5 holder rows (all zero counts, not blocked); contractor view runs; trigger list shows `trg_emit_serial_event_on_picking_done` but NOT `trg_update_accountability_on_issue`.

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ff-custody-sprintD && git add scripts/migrations/sql/384_pure_custody_model.sql scripts/migrations/sql/rollback_384_pure_custody_model.sql && git commit -m "feat(stock): migration 384 — pure custody model schema"
```

---

## Task 2: `custodyService` — executor-injected postings + unit tests  *(one PR)*

Mirrors `src/services/procurement/postGrnReceipt.ts` exactly (executor-injected core, inside the caller's transaction). Tests mirror `tests/services/procurement/postGrnReceipt.test.ts` (fake txn, SQL-regex + params assertions).

**Files:**
- Create: `src/modules/procurement/field-stock/services/custodyService.ts`
- Test: `tests/services/stock/custodyService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  postIssueToHolderWith, postConsumeFromHolderWith, postReturnFromHolderWith,
  type CustodyLine,
} from '@/modules/procurement/field-stock/services/custodyService';

function fakeTxn() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls, client: {} as never,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async () => null),
  };
}
const line = (o: Partial<CustodyLine> = {}): CustodyLine =>
  ({ stockItemId: 'item-1', quantity: 3, lotNumber: null, unitCost: 100, ...o });

describe('custodyService', () => {
  it('issue: debits source quant, credits holder custody, posts an issue movement (location->holder)', async () => {
    const txn = fakeTxn();
    const total = await postIssueToHolderWith(txn as never, {
      lines: [line()], sourceLocationId: 'loc-dc', toHolderId: 'holder-1', reference: 'PICK-1',
    });
    expect(total).toBe(3);
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_quants[\s\S]*quantity = stock_quants.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO stock_custody[\s\S]*ON CONFLICT[\s\S]*quantity = stock_custody.quantity \+ /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'issue'[\s\S]*to_holder_id/i);
    expect(txn.calls.some((c) => c.params.includes('holder-1'))).toBe(true);
  });

  it('consume: debits holder custody and posts a consumption movement (from_holder, no to side)', async () => {
    const txn = fakeTxn();
    await postConsumeFromHolderWith(txn as never, {
      stockItemId: 'item-1', quantity: 1, lotNumber: null, unitCost: 100, fromHolderId: 'holder-1', reference: 'DR-9',
    });
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_custody[\s\S]*quantity = stock_custody.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'consumption'[\s\S]*from_holder_id/i);
  });

  it('return: debits holder custody, credits warehouse quant, posts a return movement (holder->location)', async () => {
    const txn = fakeTxn();
    const total = await postReturnFromHolderWith(txn as never, {
      lines: [line({ quantity: 2 })], fromHolderId: 'holder-1', toLocationId: 'loc-wh', reference: 'RET-3',
    });
    expect(total).toBe(2);
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_custody[\s\S]*quantity = stock_custody.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO stock_quants[\s\S]*ON CONFLICT[\s\S]*quantity = stock_quants.quantity \+ /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'return'[\s\S]*from_holder_id[\s\S]*to_location_id/i);
  });

  it('issue: skips lines with empty stockItemId or <=0 qty (no writes)', async () => {
    const txn = fakeTxn();
    const total = await postIssueToHolderWith(txn as never, {
      lines: [line({ stockItemId: '' }), line({ quantity: 0 })], sourceLocationId: 'loc-dc', toHolderId: 'h',
    });
    expect(total).toBe(0);
    expect(txn.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-custody-sprintD && npx vitest run tests/services/stock/custodyService.test.ts`
Expected: FAIL — `custodyService` module not found.

- [ ] **Step 3: Write `custodyService.ts`**

```ts
/**
 * Custody Service — holder-keyed stock postings (Sprint D).
 *
 * Mirrors postGrnReceiptLines: executor-injected core posts INSIDE the caller's
 * pg.Pool transaction. Every posting credits/debits stock_custody (holder balance)
 * and writes a balancing field_stock_movements row with holder endpoints, so the
 * single double-entry ledger from Sprint A stays intact.
 */
import type { TxnClient } from '@/lib/db-pool';

export interface CustodyLine {
  stockItemId: string;
  quantity: number;
  lotNumber: string | null;
  unitCost: number | null;
}

interface IssueArgs   { lines: CustodyLine[]; sourceLocationId: string; toHolderId: string; reference?: string; performedBy?: string; }
interface ConsumeArgs { stockItemId: string; quantity: number; lotNumber: string | null; unitCost: number | null; fromHolderId: string; reference?: string; performedBy?: string; }
interface ReturnArgs  { lines: CustodyLine[]; fromHolderId: string; toLocationId: string; reference?: string; performedBy?: string; }

const CUSTODY_CREDIT = `
  INSERT INTO stock_custody (id, holder_id, stock_item_id, lot_number, quantity, unit_cost, total_value, last_movement_date, created_at, updated_at)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, COALESCE($5,0)*$4, NOW(), NOW(), NOW())
  ON CONFLICT (holder_id, stock_item_id, COALESCE(lot_number,''))
  DO UPDATE SET quantity = stock_custody.quantity + EXCLUDED.quantity,
                total_value = COALESCE(stock_custody.total_value,0) + EXCLUDED.total_value,
                last_movement_date = NOW(), updated_at = NOW()`;

const CUSTODY_DEBIT = `
  UPDATE stock_custody
     SET quantity = stock_custody.quantity - $4,
         total_value = GREATEST(COALESCE(stock_custody.total_value,0) - COALESCE($5,0)*$4, 0),
         last_movement_date = NOW(), updated_at = NOW()
   WHERE holder_id = $1 AND stock_item_id = $2 AND COALESCE(lot_number,'') = COALESCE($3,'')`;

const QUANT_DEBIT = `
  UPDATE stock_quants SET quantity = stock_quants.quantity - $4, updated_at = NOW()
   WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number,'') = COALESCE($3,'')`;

const QUANT_CREDIT = `
  INSERT INTO stock_quants (id, stock_item_id, location_id, lot_number, quantity, created_at, updated_at)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
  ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))
  DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity, updated_at = NOW()`;

const MOVE = (cols: string, vals: string) =>
  `INSERT INTO field_stock_movements (id, stock_item_id, movement_type, ${cols}, quantity, unit_cost, total_cost, reference, performed_by, performed_at, created_at)
   VALUES (gen_random_uuid(), $1, $2, ${vals}, $5, $6, COALESCE($6,0)*$5, $7, $8, NOW(), NOW())`;

/** Issue: debit source location quant -> credit holder custody; ledger 'issue' (location -> holder). */
export async function postIssueToHolderWith(txn: TxnClient, a: IssueArgs): Promise<number> {
  let total = 0;
  for (const l of a.lines) {
    if (!l.stockItemId || Number(l.quantity) <= 0) continue;
    await txn.query(QUANT_DEBIT, [l.stockItemId, a.sourceLocationId, l.lotNumber, l.quantity]);
    await txn.query(CUSTODY_CREDIT, [a.toHolderId, l.stockItemId, l.lotNumber, l.quantity, l.unitCost]);
    await txn.query(MOVE('from_location_id, to_holder_id', '$3, $4'),
      [l.stockItemId, 'issue', a.sourceLocationId, a.toHolderId, l.quantity, l.unitCost, a.reference ?? null, a.performedBy ?? null]);
    total += Number(l.quantity);
  }
  return total;
}

/** Consume: debit holder custody; ledger 'consumption' (from_holder, no to side). */
export async function postConsumeFromHolderWith(txn: TxnClient, a: ConsumeArgs): Promise<void> {
  if (!a.stockItemId || Number(a.quantity) <= 0) return;
  await txn.query(CUSTODY_DEBIT, [a.fromHolderId, a.stockItemId, a.lotNumber, a.quantity, a.unitCost]);
  await txn.query(MOVE('from_holder_id', '$3'),
    [a.stockItemId, 'consumption', a.fromHolderId, a.quantity, a.unitCost, a.reference ?? null, a.performedBy ?? null]
      // MOVE expects $4 for the 2nd endpoint placeholder; for one-sided we reuse positional params:
      .slice(0, 3).concat([a.quantity, a.unitCost, a.reference ?? null, a.performedBy ?? null]));
}

/** Return: debit holder custody -> credit warehouse quant; ledger 'return' (holder -> location). */
export async function postReturnFromHolderWith(txn: TxnClient, a: ReturnArgs): Promise<number> {
  let total = 0;
  for (const l of a.lines) {
    if (!l.stockItemId || Number(l.quantity) <= 0) continue;
    await txn.query(CUSTODY_DEBIT, [a.fromHolderId, l.stockItemId, l.lotNumber, l.quantity, l.unitCost]);
    await txn.query(QUANT_CREDIT, [l.stockItemId, a.toLocationId, l.lotNumber, l.quantity]);
    await txn.query(MOVE('from_holder_id, to_location_id', '$3, $4'),
      [l.stockItemId, 'return', a.fromHolderId, a.toLocationId, l.quantity, l.unitCost, a.reference ?? null, a.performedBy ?? null]);
    total += Number(l.quantity);
  }
  return total;
}
```
> **Implementer note:** the `MOVE` placeholder indexing must stay consistent — the two-endpoint variant binds `$3,$4` to the endpoints and `$5,$6,$7,$8` to qty/cost/reference/performedBy; the one-sided `consumption` variant uses `$3` for the single endpoint and shifts qty/cost/reference/performedBy to `$4..$7`. Define `MOVE` with the exact placeholder count per call site (write two literal SQL constants rather than the `.slice().concat()` shim shown above if it reads cleaner — keep the file < 300 lines, no `console.log`, errors via thrown Error). Verify against the test's regexes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-ff-custody-sprintD && npx vitest run tests/services/stock/custodyService.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit` clean for the new file.

- [ ] **Step 5: Commit**

```bash
git add src/modules/procurement/field-stock/services/custodyService.ts tests/services/stock/custodyService.test.ts && git commit -m "feat(stock): custodyService — holder-keyed postings + unit tests"
```

---

## Task 3: Rewire issue path (`process.ts`) to custody  *(one PR)*

**Files:**
- Modify: `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts` (current: bare `neon` + manual `BEGIN/COMMIT`; quant debit/credit at ~L130–160; serial update at ~L168–177; `stock_movements` insert at ~L181)

- [ ] **Step 1: Read the current handler** and confirm the exact lines: the per-line quant decrement (source) + increment (destination), the `stock_serials` update for `picking_type='issue'`, and the `stock_movements` insert.

- [ ] **Step 2: Convert to a `pg.Pool` transaction**

Replace the bare `neon` + `BEGIN/COMMIT` with `import { transaction } from '@/lib/db-pool'` and wrap the per-line work in `await transaction(async (txn) => { ... })`. Keep the `status='processing'` guard and the final `status='done'` update inside the transaction.

- [ ] **Step 3: For `picking_type='issue'`, post to custody instead of crediting a destination location**

Resolve the recipient holder ONCE per picking (prefer `stock_pickings.holder_id`; else resolve from `technician_id` via `getOrCreateStaffHolder(staffId, name)`, or `contractor_id` via `getOrCreateContractorHolder`). Then per line call:
```ts
import { postIssueToHolderWith, type CustodyLine } from '@/modules/procurement/field-stock/services/custodyService';
// inside the transaction, for picking_type === 'issue':
await postIssueToHolderWith(txn, {
  lines: lines.map((l): CustodyLine => ({ stockItemId: l.stock_item_id, quantity: Number(l.planned_quantity), lotNumber: l.lot_number ?? null, unitCost: l.unit_cost ?? null })),
  sourceLocationId: picking.source_location_id,
  toHolderId,
  reference: picking.picking_number,
  performedBy: picking.signed_by ?? picking.requested_by ?? null,
});
```
Do NOT also upsert a destination `stock_quants` row for issue pickings (custody replaces it). For non-issue picking types (`transfer`/`scrap` location→location), keep the existing quant debit/credit behavior unchanged.

- [ ] **Step 4: Update serials for issue pickings**

Change the serial update so issued serials carry the holder and leave the location:
```sql
UPDATE stock_serials
   SET holder_id = $1, current_location_id = NULL, status = 'issued', updated_at = NOW()
 WHERE id = ANY($2)
```
(bind `toHolderId`, `serialIds`). Keep the existing `stock_movements` audit insert (`Step 5` below) — do NOT remove it.

- [ ] **Step 5: Keep the `stock_movements` audit insert** (it feeds `stock/index.ts` movement history). Leave that statement intact, now inside the `transaction` block.

- [ ] **Step 6: Set `stock_pickings.holder_id` at confirm (or process)** — if not already set, write the resolved `toHolderId` to `stock_pickings.holder_id` in the same transaction.

- [ ] **Step 7: Manual end-to-end verification (controller, against a seed)**

Seed one warehouse quant for a test item, create+confirm an `issue` picking to a known holder, hit `/process`, then:
```bash
PGPASSWORD=$PGPASSWORD psql "$DATABASE_URL_DIRECT" -c "
SELECT (SELECT quantity FROM stock_custody WHERE holder_id=:h AND stock_item_id=:i) held,
       (SELECT count(*) FROM field_stock_movements WHERE to_holder_id=:h AND movement_type='issue') moves,
       (SELECT status||':'||COALESCE(holder_id::text,'-') FROM stock_serials WHERE id=:s) serial;"
```
Expected: `held` = issued qty; `moves` ≥ 1; serial = `issued:<holder>`. Roll back the seed afterward.

- [ ] **Step 8: Lint/type + commit**

Run: `npm run ci:quick && npx tsc --noEmit` (expect clean). Then:
```bash
git add pages/api/procurement/field-stock/pickings/[pickingId]/process.ts && git commit -m "feat(stock): issue picking posts to holder custody via field_stock_movements"
```

---

## Task 4: Rewire consumption to debit custody  *(one PR)*

**Files:**
- Modify: `src/modules/procurement/field-stock/services/consumptionService.ts` (`recordConsumption`); it currently inserts `stock_consumptions`, writes `field_stock_movements(consumption, from_location_id)`, decrements `stock_quants`, and calls `markSerialInstalled`.

- [ ] **Step 1: Read `recordConsumption`** and confirm the `field_stock_movements` insert + `stock_quants` decrement + `markSerialInstalled` call sites; confirm `RecordConsumptionInput` and whether it carries a holder.

- [ ] **Step 2: Add `holderId` to the input + persist it** on the `stock_consumptions` insert (`holder_id` column added in T1). Resolve the holder from the picking/technician when not supplied.

- [ ] **Step 3: Replace the location-based deduction with a custody debit**

Wrap the writes in a `transaction((txn) => ...)` and replace the `stock_quants` decrement + the manual `field_stock_movements(consumption, from_location_id)` insert with:
```ts
import { postConsumeFromHolderWith } from '@/modules/procurement/field-stock/services/custodyService';
await postConsumeFromHolderWith(txn, {
  stockItemId, quantity, lotNumber: lotNumber ?? null, unitCost: unitCost ?? null,
  fromHolderId: holderId, reference: dropNumber ?? null, performedBy: consumedByName ?? null,
});
```

- [ ] **Step 4: Clear the serial holder on install**

In `markSerialInstalled` (serial-tracked consumption), also set `holder_id = NULL` alongside `status='installed', installed_at_drop_id=...`:
```sql
UPDATE stock_serials
   SET status='installed', holder_id=NULL, installed_at_drop_id=$2, installed_at_drop_number=$3,
       installed_date=NOW(), updated_at=NOW()
 WHERE id=$1
```

- [ ] **Step 5: Test (fake-exec unit test for the new branch + type check)**

Add a unit test asserting `recordConsumption` (with a holder) emits a `custody` debit + a `consumption` movement with `from_holder_id`, and that the serial update clears `holder_id`. Run `npx vitest run` for the file + `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/procurement/field-stock/services/consumptionService.ts tests/ && git commit -m "feat(stock): consumption debits holder custody; clears serial holder on install"
```

---

## Task 5: Rewire return acceptance to custody  *(one PR)*

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/[returnId]/accept.ts` (serial reset to warehouse at ~L156; `stock_movements` TODO at ~L179)

- [ ] **Step 1: Read the accept handler** and confirm where it sets serial `current_location_id=warehouse, status='available'` and where stock is credited back.

- [ ] **Step 2: Wrap in a `pg.Pool` transaction and post the return via custody**

```ts
import { postReturnFromHolderWith } from '@/modules/procurement/field-stock/services/custodyService';
await postReturnFromHolderWith(txn, {
  lines: returnLines.map((l) => ({ stockItemId: l.stock_item_id, quantity: Number(l.quantity), lotNumber: l.lot_number ?? null, unitCost: l.unit_cost ?? null })),
  fromHolderId: returningHolderId,           // resolve from the return's holder/technician
  toLocationId: destinationWarehouseId,
  reference: returnNumber,
});
```
This debits the holder's custody, credits the warehouse `stock_quants`, and posts a `return` movement (holder→location).

- [ ] **Step 3: Clear the serial holder on return**

```sql
UPDATE stock_serials
   SET status='available', holder_id=NULL, current_location_id=$1, updated_at=NOW()
 WHERE id = ANY($2)
```

- [ ] **Step 4: Lint/type + commit**

Run `npm run ci:quick && npx tsc --noEmit`. Then:
```bash
git add pages/api/procurement/field-stock/returns/[returnId]/accept.ts && git commit -m "feat(stock): return acceptance debits custody, credits warehouse"
```

---

## Task 6: Retire technician-locations + deprecate the creator  *(one PR; cutover controller-owned)*

**Files:**
- Modify: `src/modules/procurement/field-stock/services/locationService.ts` (`getOrCreateTechnicianLocation` at L417; dual-write at L463)
- Create: `scripts/retire-technician-locations.ts`

- [ ] **Step 1: Stop minting technician locations**

Change `getOrCreateTechnicianLocation(technicianId, name, phone)` to resolve/return the **holder** (via `getOrCreateStaffHolder`) and no longer create a `location_type='technician'` `stock_locations` row. Update its return type + the (few) callers to consume a holder. If a caller still needs a location object shape during transition, return a minimal adapter and mark `@deprecated` with a comment pointing at custody. Keep the dual-write intent (holder is now authoritative, not supplementary).

- [ ] **Step 2: Write the cutover script** `scripts/retire-technician-locations.ts` (tsx; dry-run default / `--commit`; per `feedback_tsx_scripts_neon_and_logger`: `dotenv.config()` first, then dynamic-import `../src/lib/db-pool`, use `process.stdout`, `process.exit(0)`; RELATIVE imports, not `@/`).

Logic: for each `stock_locations` row with `location_type='technician'`: assert 0 quants/serials/movements reference it (log + skip any that do — do not deactivate a location holding stock), then `UPDATE stock_locations SET is_active=false`. Also report the ≤3 draft pickings referencing tech-locations for the controller to clean. Row-level audit log per `feedback_run_backfills_through_verification_first`.

- [ ] **Step 3: Dry-run, then controller `--commit`**

```bash
npx tsx scripts/retire-technician-locations.ts            # dry-run
npx tsx scripts/retire-technician-locations.ts --commit   # CONTROLLER ONLY
```
Expected dry-run: lists 5 tech-locations, all with 0 stock; lists the draft pickings. After `--commit`: 5 rows `is_active=false`.

- [ ] **Step 4: Clean the draft pickings (CONTROLLER)** — inspect the ≤3 drafts; delete if test data, else leave (they are non-`done`). Document the decision in the PR description.

- [ ] **Step 5: Lint/type + commit**

Run `npm run ci:quick && npx tsc --noEmit`. Then:
```bash
git add src/modules/procurement/field-stock/services/locationService.ts scripts/retire-technician-locations.ts && git commit -m "feat(stock): retire technician-locations; holder is the custody identity"
```

---

## Task 7: Accountability API → holder grain  *(one PR)*

**Files:**
- Create: `pages/api/procurement/field-stock/accountability/holders/index.ts` (GET list from `v_holder_accountability`)
- Create: `pages/api/procurement/field-stock/accountability/holders/[holderId]/index.ts` (GET detail)
- Create: `pages/api/procurement/field-stock/accountability/holders/[holderId]/block.ts` + `unblock.ts` (write `stock_accountability`)
- Modify: `pages/api/procurement/field-stock/accountability/index.ts` + `[contractorId]/index.ts` (repoint reads to `v_contractor_accountability` so legacy stays alive)

- [ ] **Step 1: Holder list route** — `GET /api/procurement/field-stock/accountability/holders`, reading `v_holder_accountability` (filters: `isBlocked`, `hasUnaccounted`), via `pg.Pool` (`@/lib/db-pool`), returning through `apiResponse.success`. Follow the existing `accountability/index.ts` response shape.

- [ ] **Step 2: Holder detail route** — `GET .../holders/[holderId]`, joining `v_holder_accountability` + the holder's `stock_custody` lines + held serials (`stock_serials WHERE holder_id=$1`).

- [ ] **Step 3: Block/unblock routes** — `POST .../holders/[holderId]/block` upserts `stock_accountability(holder_id, is_blocked=true, blocked_reason, blocked_at=NOW(), blocked_by)`; `unblock` sets `is_blocked=false`. Use `INSERT ... ON CONFLICT (holder_id) DO UPDATE`. (Block stays display-only — do NOT add an issue-time gate, per the spec's Decision 4.)

- [ ] **Step 4: Keep legacy contractor routes working** — change the SELECT in `accountability/index.ts` and `[contractorId]/index.ts` from the empty `contractor_stock_accountability` table to `v_contractor_accountability` (same column names: `total_issued_count`, `current_held_value`, `unaccounted_count`, `is_blocked`, `pending_recovery_amount`). Block/unblock/reconcile on the contractor routes may stay as-is (write the dormant table) or be marked deprecated — do not break them.

- [ ] **Step 5: Test + verify** — `npx tsc --noEmit` clean; hit the holder list route locally (`PORT=3004 npm run dev`) and confirm it returns the 5 holders; block one and confirm `stock_accountability` persisted. Per `feedback_verify_before_confirm`, verify via the running API, not code-read.

- [ ] **Step 6: Commit**

```bash
git add pages/api/procurement/field-stock/accountability && git commit -m "feat(stock): holder-grain accountability API; contractor routes on rollup shim"
```

---

## Task 8: Accountability UI → holder-centric  *(one PR)*

**Files:**
- Create: `src/modules/procurement/field-stock/hooks/useHolderAccountability.ts`
- Create: `src/modules/procurement/field-stock/components/accountability/HolderAccountabilityList.tsx`
- Modify: `pages/procurement/field-stock/index.tsx` (`AccountabilityTabContent` renders the holder list)

- [ ] **Step 1: Client hook** — `useHolderAccountability()` fetching `/api/procurement/field-stock/accountability/holders`, mirroring `useContractorAccountability` (same query/loading/error shape). Keep `useContractorAccountability` for any remaining contractor view.

- [ ] **Step 2: Holder list component** — `HolderAccountabilityList` (mirror `ContractorAccountabilityList`): columns name / held_value / unaccounted_count / is_blocked + block/unblock actions hitting the holder routes. Component < 200 lines (`feedback_file_size_limit_strict`). Keep the existing tab/nav shell (`feedback_module_nav`).

- [ ] **Step 3: Wire the tab** — point `AccountabilityTabContent` in `pages/procurement/field-stock/index.tsx` at `HolderAccountabilityList` + `useHolderAccountability`.

- [ ] **Step 4: Browser verification (MANDATORY)** — per `feedback_browser_playwright`, use `mcp__playwriter__execute`: open the field-stock page → Accountability tab → confirm the 5 holders render, block/unblock round-trips, no console errors. Screenshot for the PR.

- [ ] **Step 5: Lint/type + commit**

Run `npm run ci:quick && npx tsc --noEmit`. Then:
```bash
git add src/modules/procurement/field-stock pages/procurement/field-stock/index.tsx && git commit -m "feat(stock): holder-centric Accountability tab"
```

- [ ] **Step 6: Fast-follow notes** — add a short note in the PR body listing the deferred consumers to migrate later (`dashboard.ts`, `dashboardV2Service`, `reconciliationService`+`DailyReconciliationDashboard`, `/contractor`+`/kpi` skill docs) and the eventual `contractor_stock_accountability` table drop.

---

## Self-Review

**Spec coverage:**
- stock_custody balance → T1 (table) + T2/T3/T4/T5 (postings). ✓
- field_stock_movements holder endpoints + CHECK → T1. ✓
- stock_accountability + v_holder_accountability + v_contractor_accountability → T1; consumed in T7. ✓
- serials holder_id (issue/consume/return set/clear) → T1 (column) + T3/T4/T5. ✓
- pickings/consumptions holder_id → T1 + T3/T4. ✓
- trigger cleanup (R3) → T1 Step 2(7) + rollback restore. ✓
- retire 5 tech-locations + deprecate creator + draft-picking cleanup → T6. ✓
- accountability API + UI holder-grain + contractor shim → T7/T8. ✓
- validation gates (nets-to-zero, serial invariant, CHECK negative test, double-entry, unit tests, ci/tsc, browser) → distributed across T1 Step 5–6, T2, T3 Step 7, T4 Step 5, T7 Step 5, T8 Step 4. ✓
- fast-follows named (secondary consumers, table drop, issue-time enforcement seam) → T8 Step 6 + spec Out-of-scope. ✓

**Placeholder scan:** the `MOVE` `.slice().concat()` shim in T2 Step 3 is explicitly flagged with an implementer note to write literal SQL per call site; the rollback's 366-body restore is flagged to paste verbatim at execution — both are instructions, not unfilled gaps. No `TBD`/`TODO`-as-work-item.

**Type consistency:** `CustodyLine`/`postIssueToHolderWith`/`postConsumeFromHolderWith`/`postReturnFromHolderWith` names match across T2 (definition + tests) and their call sites in T3/T4/T5. `toHolderId`/`fromHolderId` arg names consistent. View column names (`total_issued_count`, `current_held_value`, `unaccounted_count`, `is_blocked`, `pending_recovery_amount`) match between T1's `v_contractor_accountability` and T7 Step 4's legacy-route expectations.

---

## Execution guardrails (recap)

- One PR per Task; `ci:quick` + `tsc --noEmit` before each push; review-team blind review with the RAW diff; merge only after APPROVED + CI (self-hosted runner) green.
- Migration apply, cutover `--commit`, and draft-picking deletion are **controller-owned**.
- After the final merge, run `/handoff` (`feedback_handoff_after_sprint_merge`) and update `project_stock_locations_custody_roadmap` (D shipped → roadmap complete).
