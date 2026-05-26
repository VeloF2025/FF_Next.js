# Stock Ledger Consolidation (Sprint A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FibreFlow's `stock_quants` the authoritative, location-aware stock balance — seeded from live Odoo inventory, posted atomically on GRN confirm, and reconcilable against Odoo on demand.

**Architecture:** Reuse the existing `OdooClient` to pull `stock.quant`; map products via `stock_items.odoo_product_id` and locations via a populated `odoo_location_mappings` table; write opening `stock_quants` + `field_stock_movements` postings in a single `pg.Pool` transaction. Rewrite `grn-confirm.ts` off the Neon shim onto the same transactional posting path. `qty_available` stays an untouched legacy cache; `v_stock_on_hand` becomes the read/reconciliation surface.

**Tech Stack:** TypeScript, Next.js Pages API, `pg.Pool` via `@/lib/db-pool`, Odoo JSON-RPC via `src/services/odoo/odooClient.ts`, Vitest 0.34, `tsx` for scripts, Postgres (self-hosted Supabase).

---

## Spec & grounding

- **Spec:** `docs/superpowers/specs/2026-05-26-stock-ledger-consolidation-sprintA-design.md`
- **Verified live (2026-05-26):** Odoo holds 1,370,112 units / 140 products / 16 internal locations; FibreFlow `stock_quants` = 0 rows; `stock_items.odoo_product_id` populated 280/298; `odoo_location_mappings` empty; `stock_locations.odoo_location_id` column does **not** exist; `field_stock_movements.movement_type` CHECK includes `receipt`; `idx_stock_quants_unique = (stock_item_id, location_id, COALESCE(lot_number,''))`; `migrations` MAX(version)=380, file `381_create_garstfontein_dc.sql` exists → next version **382**.

## Deviations from spec (grounded during planning — all refinements, same outcome)

1. **Product mapping key:** use `stock_items.odoo_product_id` (primary; 280/298) with `item_code = product.name` as fallback. The spec named `item_code`; `odoo_product_id` is the robust existing key.
2. **Location mapping mechanism:** populate the existing `odoo_location_mappings` table (the root-cause fix for the historical 1-location collapse) rather than an ad-hoc in-script map. A pure name→code function provides the deterministic mapping; integer Odoo location IDs are resolved at runtime.
3. **`stock_levels` table:** confirmed to exist (Odoo-mirror cache, read by `src/components/procurement/soh/SOHSpiderView.tsx`). Left untouched/out of scope; `stock_quants` is canonical.

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `scripts/migrations/sql/382_stock_ledger_consolidation.sql` | `vendor` CHECK value, `VENDORS` virtual location, `v_stock_on_hand` view | Create |
| `scripts/migrations/sql/rollback_382_stock_ledger_consolidation.sql` | Reverse 382 | Create |
| `src/services/odoo/stockLocationMap.ts` | Pure Odoo-location-name → FF-warehouse-code map | Create |
| `tests/services/odoo/stockLocationMap.test.ts` | Tests for the map | Create |
| `src/services/odoo/entities/stockQuantSeed.ts` | Build + commit the Odoo→`stock_quants` opening seed | Create |
| `tests/services/odoo/stockQuantSeed.test.ts` | Tests for `buildSeedPlan` | Create |
| `scripts/seed-stock-quants-from-odoo.ts` | CLI: dry-run/commit wrapper for the seed | Create |
| `src/services/procurement/postGrnReceipt.ts` | Transactional posting of one GRN's accepted lines to quants + movements + qty_available | Create |
| `tests/services/procurement/postGrnReceipt.test.ts` | Tests for the posting helper | Create |
| `pages/api/procurement/grn-confirm.ts` | Rewrite onto `transaction()` + `postGrnReceipt` | Modify |
| `tests/api/procurement/grn-confirm.test.ts` | Handler test (mocked db-pool) | Create |
| `src/services/odoo/entities/stockQuantReconcile.ts` | Pure diff: Odoo vs `stock_quants` per (item, location) | Create |
| `tests/services/odoo/stockQuantReconcile.test.ts` | Tests for the diff | Create |
| `scripts/reconcile-stock-quants-vs-odoo.ts` | CLI: print FibreFlow-vs-Odoo drift | Create |

**Branch:** `feat/ff-stock-ledger-consolidation` (worktree `FF_Next.js-stock-ledger-sprintA`). All work via PR; never master.

**Commands reference:**
- Run one test file: `npx vitest run <path>`
- Type check: `npx tsc --noEmit`
- Lint gate before PR: `npm run ci:quick`
- DB password for manual checks: use `$PGPASSWORD` env (never inline in committed files).

---

### Task 1: Migration — vendor location type, VENDORS virtual location, v_stock_on_hand view

**Files:**
- Create: `scripts/migrations/sql/382_stock_ledger_consolidation.sql`
- Create: `scripts/migrations/sql/rollback_382_stock_ledger_consolidation.sql`

- [ ] **Step 1: Pre-flight — confirm version 382 is free and no parallel migration PR**

Run:
```bash
PGPASSWORD=$PGPASSWORD psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA -c "SELECT MAX(version::int) FROM migrations;"
ls scripts/migrations/sql/ | grep -E '^(38[0-9])' | sort -V
gh pr list --search 'migration in:title' --state open
```
Expected: MAX = 380; highest file ≤ 381; no open PR claiming version 382. If 382 is taken, bump to the next free integer and rename both files.

- [ ] **Step 2: Write the forward migration**

```sql
-- 382_stock_ledger_consolidation.sql
-- Sprint A: location-aware stock ledger groundwork.
BEGIN;

-- 1. Allow a 'vendor' location_type (from-side of receipts).
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_location_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_location_type_check
  CHECK (location_type IN ('warehouse','site_store','transit','technician','customer','scrap','adjustment','vendor'));

-- 2. Virtual VENDORS location (from-side of supplier receipts + opening seed).
INSERT INTO stock_locations (id, code, name, location_type, is_virtual, created_at, updated_at)
SELECT gen_random_uuid(), 'VENDORS', 'Vendors (external)', 'vendor', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE code = 'VENDORS');

-- 3. Read model: location-aware on-hand from the canonical quants.
CREATE OR REPLACE VIEW v_stock_on_hand AS
SELECT stock_item_id,
       location_id,
       SUM(quantity)                AS on_hand,
       SUM(COALESCE(reserved_quantity,0)) AS reserved
FROM stock_quants
GROUP BY stock_item_id, location_id;

-- 4. Record the migration.
INSERT INTO migrations (version, name, executed_at)
VALUES ('382', 'stock_ledger_consolidation', NOW());

COMMIT;
```

- [ ] **Step 3: Write the rollback migration**

```sql
-- rollback_382_stock_ledger_consolidation.sql
BEGIN;
DROP VIEW IF EXISTS v_stock_on_hand;
DELETE FROM stock_locations WHERE code = 'VENDORS';
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_location_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_location_type_check
  CHECK (location_type IN ('warehouse','site_store','transit','technician','customer','scrap','adjustment'));
DELETE FROM migrations WHERE version = '382';
COMMIT;
```

- [ ] **Step 4: Apply against the live DB and verify**

Run:
```bash
PGPASSWORD=$PGPASSWORD psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -f scripts/migrations/sql/382_stock_ledger_consolidation.sql
PGPASSWORD=$PGPASSWORD psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA -c "SELECT code,location_type,is_virtual FROM stock_locations WHERE code='VENDORS'; SELECT count(*) FROM v_stock_on_hand;"
```
Expected: `VENDORS|vendor|t`; `v_stock_on_hand` returns `0` (quants empty pre-seed). No constraint errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/382_stock_ledger_consolidation.sql scripts/migrations/sql/rollback_382_stock_ledger_consolidation.sql
git commit -m "feat(stock): migration 382 — vendor location type, VENDORS, v_stock_on_hand"
```

---

### Task 2: Odoo location-name → FF warehouse-code map (pure)

**Files:**
- Create: `src/services/odoo/stockLocationMap.ts`
- Test: `tests/services/odoo/stockLocationMap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/services/odoo/stockLocationMap.test.ts
import { describe, it, expect } from 'vitest';
import { odooLocationToFfCode } from '@/services/odoo/stockLocationMap';

describe('odooLocationToFfCode', () => {
  it('maps known site tokens to FF warehouse codes', () => {
    expect(odooLocationToFfCode('VF/Law/Stock')).toBe('WH-Law');
    expect(odooLocationToFfCode('Moh/Stock')).toBe('WH-Moh');
    expect(odooLocationToFfCode('MamP1/Stock')).toBe('WH-MamP1');
    expect(odooLocationToFfCode('Tem1/Stock')).toBe('WH-Tem1');
    expect(odooLocationToFfCode('ETW/Stock')).toBe('WH-ETW');
    expect(odooLocationToFfCode('TAV/Stock')).toBe('WH-TAV');
  });
  it('returns null for unmapped / non-physical locations', () => {
    expect(odooLocationToFfCode('Partners/Customers')).toBeNull();
    expect(odooLocationToFfCode('Virtual Locations/Vendors')).toBeNull();
    expect(odooLocationToFfCode('WH/Stock/Transit')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/odoo/stockLocationMap.test.ts`
Expected: FAIL — cannot find module `@/services/odoo/stockLocationMap`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/odoo/stockLocationMap.ts
/**
 * Deterministic map from an Odoo stock.location complete_name to a FibreFlow
 * stock_locations.code. Matching is on the site token immediately before
 * "/Stock" (Odoo names look like "VF/Law/Stock" or "Moh/Stock").
 *
 * Integer Odoo location IDs are resolved at runtime by the seed (and persisted
 * into odoo_location_mappings); this function only encodes the stable token→code
 * relationship so it is pure and unit-testable.
 */
const TOKEN_TO_CODE: Record<string, string> = {
  Law: 'WH-Law',
  Moh: 'WH-Moh',
  MamP1: 'WH-MamP1',
  Tem1: 'WH-Tem1',
  Tem2: 'WH-Tem2',
  Tem3: 'WH-Tem3',
  ETW: 'WH-ETW',
  GR: 'WH-GR',
  IP: 'WH-IP',
  TAV: 'WH-TAV',
  TBL: 'WH-TBL',
  // NOTE: 'WH' (Odoo "WH/Stock") is intentionally NOT auto-mapped — it is
  // ambiguous between WH-WH and WH-MAIN and must be resolved in the dry-run
  // review (see spec §6). Add it here once confirmed.
};

export function odooLocationToFfCode(completeName: string): string | null {
  const parts = completeName.split('/').map((p) => p.trim());
  const stockIdx = parts.lastIndexOf('Stock');
  // Require the name to END at ".../Stock" (a leaf stock location), not a
  // sub-location like ".../Stock/Transit".
  if (stockIdx === -1 || stockIdx !== parts.length - 1) return null;
  const token = parts[stockIdx - 1];
  if (!token) return null;
  return TOKEN_TO_CODE[token] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/odoo/stockLocationMap.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/odoo/stockLocationMap.ts tests/services/odoo/stockLocationMap.test.ts
git commit -m "feat(stock): pure Odoo-location to FF-warehouse-code map"
```

---

### Task 3: Seed plan builder (pure) — group quants, resolve mappings, report gaps

**Files:**
- Create: `src/services/odoo/entities/stockQuantSeed.ts`
- Test: `tests/services/odoo/stockQuantSeed.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/services/odoo/stockQuantSeed.test.ts
import { describe, it, expect } from 'vitest';
import { buildSeedPlan } from '@/services/odoo/entities/stockQuantSeed';
import type { OdooStockQuant } from '@/services/odoo/odooClient';

const quant = (pid: number, pname: string, lid: number, lname: string, qty: number): OdooStockQuant =>
  ({ id: pid * 100 + lid, product_id: [pid, pname], location_id: [lid, lname], quantity: qty, reserved_quantity: 0 } as OdooStockQuant);

describe('buildSeedPlan', () => {
  const productMap = new Map<number, string>([[243, 'item-cab'], [249, 'item-cab9']]);
  const locationMap = new Map<number, string>([[8, 'loc-law'], [9, 'loc-moh']]);

  it('aggregates quants per (product, location) into seed rows', () => {
    const plan = buildSeedPlan(
      [quant(243, 'CAB-144F', 8, 'VF/Law/Stock', 16000), quant(243, 'CAB-144F', 8, 'VF/Law/Stock', 4000)],
      productMap, locationMap,
    );
    expect(plan.rows).toEqual([{ stockItemId: 'item-cab', locationId: 'loc-law', quantity: 20000 }]);
    expect(plan.gaps).toEqual([]);
  });

  it('reports a product gap when odoo product is unmapped (no double-write)', () => {
    const plan = buildSeedPlan([quant(999, 'Vendor Labour', 8, 'VF/Law/Stock', 5)], productMap, locationMap);
    expect(plan.rows).toEqual([]);
    expect(plan.gaps).toEqual([{ kind: 'product', odooId: 999, name: 'Vendor Labour', quantity: 5, location: 'VF/Law/Stock' }]);
  });

  it('reports a location gap when odoo location is unmapped', () => {
    const plan = buildSeedPlan([quant(243, 'CAB-144F', 77, 'Partners/Customers', 5)], productMap, locationMap);
    expect(plan.rows).toEqual([]);
    expect(plan.gaps).toEqual([{ kind: 'location', odooId: 77, name: 'Partners/Customers', quantity: 5, product: 'CAB-144F' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/odoo/stockQuantSeed.test.ts`
Expected: FAIL — `buildSeedPlan` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation (pure part only)**

```typescript
// src/services/odoo/entities/stockQuantSeed.ts
import type { OdooStockQuant } from '../odooClient';

export interface SeedRow { stockItemId: string; locationId: string; quantity: number; }
export type SeedGap =
  | { kind: 'product'; odooId: number; name: string; quantity: number; location: string }
  | { kind: 'location'; odooId: number; name: string; quantity: number; product: string };
export interface SeedPlan { rows: SeedRow[]; gaps: SeedGap[]; }

/**
 * Pure: turn raw Odoo quants into the proposed (item, location, qty) seed set.
 * productMap: odoo product_id -> FF stock_items.id
 * locationMap: odoo location_id -> FF stock_locations.id
 * Unmapped products/locations become gaps (reported, never silently dropped).
 */
export function buildSeedPlan(
  quants: OdooStockQuant[],
  productMap: Map<number, string>,
  locationMap: Map<number, string>,
): SeedPlan {
  const agg = new Map<string, SeedRow>();
  const gaps: SeedGap[] = [];

  for (const q of quants) {
    const [pid, pname] = q.product_id;
    const [lid, lname] = q.location_id;
    const stockItemId = productMap.get(pid);
    if (!stockItemId) {
      gaps.push({ kind: 'product', odooId: pid, name: pname, quantity: q.quantity, location: lname });
      continue;
    }
    const locationId = locationMap.get(lid);
    if (!locationId) {
      gaps.push({ kind: 'location', odooId: lid, name: lname, quantity: q.quantity, product: pname });
      continue;
    }
    const key = `${stockItemId}|${locationId}`;
    const existing = agg.get(key);
    if (existing) existing.quantity += q.quantity;
    else agg.set(key, { stockItemId, locationId, quantity: q.quantity });
  }
  return { rows: [...agg.values()], gaps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/odoo/stockQuantSeed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/odoo/entities/stockQuantSeed.ts tests/services/odoo/stockQuantSeed.test.ts
git commit -m "feat(stock): pure seed-plan builder (Odoo quants -> stock_quants rows + gaps)"
```

---

### Task 4: Seed runner + CLI (dry-run report, transactional commit, audit log)

**Files:**
- Modify: `src/services/odoo/entities/stockQuantSeed.ts` (add the DB-touching runner)
- Create: `scripts/seed-stock-quants-from-odoo.ts`

> No new unit test for the runner (it is thin orchestration over the tested `buildSeedPlan` + the tested `transaction()` helper). It is validated by the **dry-run** in Task 8.

- [ ] **Step 1: Add the runner to `stockQuantSeed.ts`**

Append to `src/services/odoo/entities/stockQuantSeed.ts`:

```typescript
import { transaction, query } from '@/lib/db-pool';
import type { OdooClient } from '../odooClient';
import { odooLocationToFfCode } from '../stockLocationMap';

interface SeedRunResult { dryRun: boolean; rows: SeedRow[]; gaps: SeedGap[]; committed: number; }

/** Build the product map: odoo product_id -> FF stock_items.id (primary key: odoo_product_id). */
async function loadProductMap(): Promise<Map<number, string>> {
  const rows = await query<{ id: string; odoo_product_id: number }>(
    'SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL',
  );
  return new Map(rows.map((r) => [Number(r.odoo_product_id), String(r.id)]));
}

/**
 * Build the location map: odoo location_id -> FF stock_locations.id, and persist
 * it into odoo_location_mappings. Resolution: Odoo complete_name -> FF code
 * (pure map) -> stock_locations.id.
 */
async function loadAndPersistLocationMap(
  client: OdooClient, dryRun: boolean,
): Promise<Map<number, string>> {
  const odooLocs = await client.getInternalStockLocations();
  const codeRows = await query<{ id: string; code: string }>('SELECT id, code FROM stock_locations');
  const codeToId = new Map(codeRows.map((r) => [r.code, String(r.id)]));
  const map = new Map<number, string>();
  for (const loc of odooLocs) {
    const code = odooLocationToFfCode(loc.complete_name);
    if (!code) continue;
    const ffId = codeToId.get(code);
    if (!ffId) continue;
    map.set(loc.id, ffId);
    if (!dryRun) {
      await query(
        `INSERT INTO odoo_location_mappings (odoo_location_id, ff_location_id, ff_warehouse_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (odoo_location_id) DO UPDATE SET ff_location_id = EXCLUDED.ff_location_id,
           ff_warehouse_code = EXCLUDED.ff_warehouse_code`,
        [loc.id, ffId, code],
      );
    }
  }
  return map;
}

/** Resolve the VENDORS virtual location id (created by migration 382). */
async function getVendorsLocationId(): Promise<string> {
  const rows = await query<{ id: string }>("SELECT id FROM stock_locations WHERE code = 'VENDORS' LIMIT 1");
  if (!rows[0]) throw new Error('VENDORS location missing — run migration 382 first');
  return String(rows[0].id);
}

export async function seedStockQuantsFromOdoo(
  client: OdooClient, opts: { dryRun: boolean },
): Promise<SeedRunResult> {
  const { dryRun } = opts;
  const [productMap, locationMap, quants] = await Promise.all([
    loadProductMap(),
    loadAndPersistLocationMap(client, dryRun),
    client.getInternalStockQuants({ limit: 5000 }),
  ]);
  const { rows, gaps } = buildSeedPlan(quants, productMap, locationMap);
  if (dryRun) return { dryRun, rows, gaps, committed: 0 };

  const vendorsId = await getVendorsLocationId();
  let committed = 0;
  await transaction(async (txn) => {
    for (const r of rows) {
      // Opening on-hand: upsert on the canonical location-only unique key.
      await txn.query(
        `INSERT INTO stock_quants (id, stock_item_id, location_id, quantity, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
        [r.stockItemId, r.locationId, r.quantity],
      );
      // Balancing opening movement (Vendors -> destination), tagged for idempotent rollback.
      await txn.query(
        `INSERT INTO field_stock_movements
           (id, stock_item_id, movement_type, from_location_id, to_location_id, quantity, reference, performed_at, created_at)
         VALUES (gen_random_uuid(), $1, 'receipt', $2, $3, $4, 'ODOO_OPENING', NOW(), NOW())`,
        [r.stockItemId, vendorsId, r.locationId, r.quantity],
      );
      committed++;
    }
  });
  return { dryRun, rows, gaps, committed };
}
```

- [ ] **Step 2: Verify `getInternalStockLocations` exists on OdooClient (add if missing)**

Run: `grep -n "getInternalStockLocations" src/services/odoo/odooClient.ts`
Expected: a method returning `{ id: number; complete_name: string; ... }[]`. If absent, add it next to `getInternalStockQuants` (line ~785):

```typescript
async getInternalStockLocations(): Promise<Array<{ id: number; complete_name: string; usage: string }>> {
  return this.searchRead('stock.location', [['usage', '=', 'internal']], ['id', 'complete_name', 'usage']);
}
```
(Use the same `searchRead` helper `getInternalStockQuants` uses — match its exact internal call style.)

- [ ] **Step 3: Write the CLI wrapper (env creds — never hardcoded)**

```typescript
// scripts/seed-stock-quants-from-odoo.ts
/** Seed stock_quants from live Odoo. Run: npx tsx scripts/seed-stock-quants-from-odoo.ts [--commit] */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { seedStockQuantsFromOdoo } from '../src/services/odoo/entities/stockQuantSeed';

function cfg(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
}

async function main() {
  const commit = process.argv.includes('--commit');
  console.log(`\n=== ODOO -> stock_quants SEED — ${commit ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const client = new OdooClient({
    url: cfg('ODOO_URL'), db: cfg('ODOO_DB'),
    username: cfg('ODOO_USERNAME'), password: cfg('ODOO_PASSWORD'),
  });
  const conn = await client.testConnection();
  if (!conn.success) { console.error('Odoo connect failed:', conn.message); process.exit(1); }

  const res = await seedStockQuantsFromOdoo(client, { dryRun: !commit });

  const byLoc = res.rows.reduce<Record<string, number>>((a, r) => {
    a[r.locationId] = (a[r.locationId] || 0) + r.quantity; return a;
  }, {});
  console.log(`Seed rows: ${res.rows.length}  | total qty: ${Math.round(res.rows.reduce((s, r) => s + r.quantity, 0))}`);
  console.log('By location id:'); Object.entries(byLoc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k} = ${Math.round(v)}`));
  if (res.gaps.length) {
    console.log(`\nGAPS (${res.gaps.length}) — NOT seeded:`);
    res.gaps.forEach((g) => console.log(`  [${g.kind}] ${g.name} (odoo ${g.odooId}) qty ${g.quantity}`));
  }
  console.log(commit ? `\nCOMMITTED ${res.committed} quant rows.` : '\nDRY RUN — nothing written.');
}
main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
```

- [ ] **Step 4: Add Odoo env keys to `.env.local`** (local only; gitignored — edit via your editor, not committed)

```
ODOO_URL=https://velocityfibre.odoo.com
ODOO_DB=velocityfibre
ODOO_USERNAME=jacques@velocityfibre.co.za
ODOO_PASSWORD=<the Odoo password — from password manager, NOT committed>
```

- [ ] **Step 5: Type check + commit (code only; no DB writes yet)**

Run: `npx tsc --noEmit 2>&1 | grep -E "stockQuantSeed|seed-stock-quants|odooClient" || echo "no new type errors"`
Expected: `no new type errors`.

```bash
git add src/services/odoo/entities/stockQuantSeed.ts scripts/seed-stock-quants-from-odoo.ts src/services/odoo/odooClient.ts
git commit -m "feat(stock): Odoo->stock_quants seed runner + CLI (dry-run/commit, audit-tagged)"
```

---

### Task 5: GRN receipt posting helper (transactional, location-aware)

**Files:**
- Create: `src/services/procurement/postGrnReceipt.ts`
- Test: `tests/services/procurement/postGrnReceipt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/services/procurement/postGrnReceipt.test.ts
import { describe, it, expect, vi } from 'vitest';
import { postGrnReceiptLines, type GrnLine } from '@/services/procurement/postGrnReceipt';

function fakeTxn() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    client: {} as never,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async () => null),
  };
}

const line = (over: Partial<GrnLine> = {}): GrnLine => ({
  stockItemId: 'item-1', quantityReceived: 10, quantityRejected: 2, lotNumber: null, ...over,
});

describe('postGrnReceiptLines', () => {
  it('posts accepted qty to quants + a receipt movement + qty_available, per line', async () => {
    const txn = fakeTxn();
    const total = await postGrnReceiptLines(txn as never, {
      lines: [line()], destinationLocationId: 'loc-dc', vendorsLocationId: 'loc-vend',
    });
    expect(total).toBe(8); // 10 received - 2 rejected
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/INSERT INTO stock_quants[\s\S]*ON CONFLICT/i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'receipt'/i);
    expect(sqls).toMatch(/UPDATE stock_items[\s\S]*qty_available/i);
    // accepted quantity (8) is the value passed to the quant upsert
    expect(txn.calls[0].params).toContain(8);
  });

  it('skips lines with zero accepted quantity (no writes)', async () => {
    const txn = fakeTxn();
    const total = await postGrnReceiptLines(txn as never, {
      lines: [line({ quantityReceived: 5, quantityRejected: 5 })],
      destinationLocationId: 'loc-dc', vendorsLocationId: 'loc-vend',
    });
    expect(total).toBe(0);
    expect(txn.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/procurement/postGrnReceipt.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/procurement/postGrnReceipt.ts
import type { TxnClient } from '@/lib/db-pool';

export interface GrnLine {
  stockItemId: string;
  quantityReceived: number;
  quantityRejected: number;
  lotNumber: string | null;
}

export interface PostGrnArgs {
  lines: GrnLine[];
  destinationLocationId: string;
  vendorsLocationId: string;
}

/**
 * Post the accepted lines of one GRN inside an existing transaction:
 *  - upsert stock_quants at the destination (canonical location-only key)
 *  - insert a balancing field_stock_movements receipt (Vendors -> destination)
 *  - keep the legacy global qty_available cache in sync (additive; not a cutover)
 * Returns total accepted quantity. Lines with no stockItemId or <=0 accepted are skipped.
 */
export async function postGrnReceiptLines(txn: TxnClient, args: PostGrnArgs): Promise<number> {
  const { lines, destinationLocationId, vendorsLocationId } = args;
  let totalAccepted = 0;

  for (const l of lines) {
    const accepted = Number(l.quantityReceived || 0) - Number(l.quantityRejected || 0);
    if (!l.stockItemId || accepted <= 0) continue;

    await txn.query(
      `INSERT INTO stock_quants (id, stock_item_id, location_id, lot_number, quantity, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))
       DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [l.stockItemId, destinationLocationId, l.lotNumber, accepted],
    );

    await txn.query(
      `INSERT INTO field_stock_movements
         (id, stock_item_id, movement_type, from_location_id, to_location_id, quantity, reference, performed_at, created_at)
       VALUES (gen_random_uuid(), $1, 'receipt', $2, $3, $4, 'GRN', NOW(), NOW())`,
      [l.stockItemId, vendorsLocationId, destinationLocationId, accepted],
    );

    await txn.query(
      `UPDATE stock_items SET qty_available = COALESCE(qty_available,0) + $2, updated_at = NOW() WHERE id = $1`,
      [l.stockItemId, accepted],
    );

    totalAccepted += accepted;
  }
  return totalAccepted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/procurement/postGrnReceipt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/procurement/postGrnReceipt.ts tests/services/procurement/postGrnReceipt.test.ts
git commit -m "feat(procurement): transactional GRN receipt posting helper (quants + movement + qty_available)"
```

---

### Task 6: Rewrite `grn-confirm.ts` onto pg.Pool transaction + posting helper

**Files:**
- Modify: `pages/api/procurement/grn-confirm.ts`
- Test: `tests/api/procurement/grn-confirm.test.ts`

**Context:** The current handler uses `createLoggedSql` (Neon shim, non-transactional). Replace the shim with `@/lib/db-pool`. Keep the request/response contract, the document-level `stock_movements` insert, the GL hook, and the audit log. Wrap the document movement + per-line posting + GRN status update in one `transaction()`. The destination location is the GRN's `warehouse_id` (already a real FK, excluded from virtual via the GRN/new picker).

- [ ] **Step 1: Write the failing handler test**

```typescript
// tests/api/procurement/grn-confirm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const txnQueries: string[] = [];
vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({
    query: vi.fn(async (text: string) => { txnQueries.push(text); return []; }),
    queryOne: vi.fn(async () => null),
    client: {},
  })),
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []), unsafe: (s: string) => s }),
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/procurement/auditService', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/modules/accounting/services/glIntegrationHooks', () => ({ postGRNToGL: vi.fn() }));

import * as dbPool from '@/lib/db-pool';
import handler from '../../../pages/api/procurement/grn-confirm';

function makeRes() {
  const res = {} as NextApiResponse & { _status?: number; _json?: unknown };
  res.status = vi.fn((c: number) => { (res as { _status?: number })._status = c; return res; }) as never;
  res.json = vi.fn((b: unknown) => { (res as { _json?: unknown })._json = b; return res; }) as never;
  res.setHeader = vi.fn(() => res) as never;
  return res;
}

describe('POST /api/procurement/grn-confirm', () => {
  beforeEach(() => { txnQueries.length = 0; vi.clearAllMocks(); });

  it('runs the receipt posting inside a single transaction', async () => {
    const draftGrn = { id: 'g1', grn_number: 'GRN-1', status: 'draft', warehouse_id: 'loc-dc', supplier_name: 'S', warehouse_name: 'DC' };
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(draftGrn)              // load GRN
      .mockResolvedValue({ id: 'loc-vend' });        // VENDORS lookup
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', quantity_received: 10, quantity_rejected: 0, lot_number: null, total_cost: 100 }]); // GRN items

    const req = { method: 'POST', body: { grnId: 'g1' }, query: {} } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);

    expect(dbPool.transaction).toHaveBeenCalledTimes(1);
    const joined = txnQueries.join('\n');
    expect(joined).toMatch(/INSERT INTO stock_quants/i);
    expect(joined).toMatch(/INSERT INTO field_stock_movements/i);
    expect(joined).toMatch(/UPDATE goods_receipt_notes[\s\S]*completed/i);
  });

  it('rejects a non-draft/receiving GRN with 400 and no transaction', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'g1', status: 'completed', warehouse_id: 'loc-dc' });
    const req = { method: 'POST', body: { grnId: 'g1' }, query: {} } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/procurement/grn-confirm.test.ts`
Expected: FAIL — current handler uses the shim, does not call `transaction`, queries don't hit `stock_quants`.

- [ ] **Step 3: Rewrite the handler**

Replace the body of `pages/api/procurement/grn-confirm.ts`. Key changes: import `{ query, queryOne, transaction }` from `@/lib/db-pool` (drop `createLoggedSql`); load GRN + items with `queryOne`/`query`; resolve VENDORS id; run document-movement + `postGrnReceiptLines` + GRN status update inside one `transaction()`; keep GL hook + audit log after commit.

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { query, queryOne, transaction } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { postGRNToGL } from '@/modules/accounting/services/glIntegrationHooks';
import { postGrnReceiptLines, type GrnLine } from '@/services/procurement/postGrnReceipt';

interface ConfirmRequest { grnId: string; notes?: string; }

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const { grnId, notes } = req.body as ConfirmRequest;
  if (!grnId) return apiResponse.validationError(res, { grnId: 'GRN ID is required' });

  try {
    const grn = await queryOne<{ id: string; grn_number: string; status: string; supplier_id: string; warehouse_id: string; purchase_order_id: string | null; supplier_name: string; warehouse_name: string; }>(
      `SELECT grn.id, grn.grn_number, grn.status, grn.supplier_id, grn.warehouse_id, grn.purchase_order_id,
              COALESCE(s.company_name, s.name) AS supplier_name, sl.name AS warehouse_name
         FROM goods_receipt_notes grn
         LEFT JOIN suppliers s ON grn.supplier_id = s.id
         LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.id = $1`, [grnId]);
    if (!grn) return apiResponse.notFound(res, 'Goods Receipt Note', grnId);
    if (!['draft', 'receiving'].includes(grn.status)) {
      return apiResponse.badRequest(res, `Cannot confirm GRN in '${grn.status}' status. Only draft or receiving GRNs can be confirmed.`);
    }
    if (!grn.warehouse_id) return apiResponse.badRequest(res, 'GRN has no destination warehouse');

    const grnItems = await query<{ stock_item_id: string | null; quantity_received: number; quantity_rejected: number; lot_number: string | null; item_code: string | null; item_description: string | null; uom: string | null; unit_cost: number | null; serial_numbers: unknown; total_cost: number | null; }>(
      `SELECT stock_item_id, quantity_received, quantity_rejected, lot_number, item_code, item_description,
              uom, unit_cost, serial_numbers, total_cost
         FROM goods_receipt_items WHERE grn_id = $1`, [grnId]);
    if (grnItems.length === 0) return apiResponse.badRequest(res, 'GRN has no items to receive');

    const vendors = await queryOne<{ id: string }>("SELECT id FROM stock_locations WHERE code = 'VENDORS' LIMIT 1");
    if (!vendors) return apiResponse.badRequest(res, 'VENDORS location missing — run migration 382');

    const lines: GrnLine[] = grnItems.map((i) => ({
      stockItemId: i.stock_item_id ?? '', quantityReceived: Number(i.quantity_received || 0),
      quantityRejected: Number(i.quantity_rejected || 0), lotNumber: i.lot_number,
    }));

    const { movementId, totalAccepted } = await transaction(async (txn) => {
      const [mv] = await txn.query<{ id: string }>(
        `INSERT INTO stock_movements (id, project_id, movement_type, reference_number, reference_type, reference_id,
            from_location, to_location, status, movement_date, confirmed_at, requested_by, processed_by, notes, source_type)
         VALUES (gen_random_uuid(), 'fibreflow', 'GRN', $1, 'goods_receipt_note', $2, $3, $4, 'completed', NOW(), NOW(), $5, $5, $6, 'fibreflow')
         RETURNING id`,
        [grn.grn_number, grnId, grn.supplier_name || 'Supplier', grn.warehouse_name || 'Warehouse', userId || 'system', notes || `GRN confirmed: ${grn.grn_number}`]);

      const totalAccepted = await postGrnReceiptLines(txn, {
        lines, destinationLocationId: grn.warehouse_id, vendorsLocationId: vendors.id,
      });

      await txn.query(
        `UPDATE goods_receipt_notes SET status = 'completed', total_quantity_received = $2,
            verified_by = $3, verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [grnId, totalAccepted, userId || 'system']);

      return { movementId: mv!.id, totalAccepted };
    });

    createAuditLog({ entityType: 'goods_receipt', entityId: grnId, action: 'update', performedBy: userId,
      newValues: { status: 'completed', totalQuantityReceived: totalAccepted, movementId } });

    const grnTotalValue = grnItems.reduce((s, i) => s + Number(i.total_cost || 0), 0);
    if (grnTotalValue > 0) {
      const poProjectId = grn.purchase_order_id
        ? (await queryOne<{ project_id: string }>('SELECT project_id FROM purchase_orders WHERE id = $1', [grn.purchase_order_id]))?.project_id ?? null
        : null;
      await postGRNToGL(grnId, grnTotalValue, poProjectId, userId, grn.grn_number);
    }

    log.info('GRN confirmed successfully', { grnId, grnNumber: grn.grn_number, movementId, totalAccepted, module: 'procurement:grn-confirm' });
    return apiResponse.success(res, {
      message: 'GRN confirmed successfully',
      grn: { id: grn.id, grnNumber: grn.grn_number, status: 'completed' },
      movement: { id: movementId, referenceNumber: grn.grn_number, type: 'GRN' },
      summary: { itemsProcessed: lines.filter((l) => l.stockItemId && (l.quantityReceived - l.quantityRejected) > 0).length, totalQuantityReceived: totalAccepted },
    });
  } catch (error) {
    log.error('Failed to confirm GRN', { grnId, error, module: 'procurement:grn-confirm' });
    return apiResponse.databaseError(res, error, 'Failed to confirm GRN');
  }
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/procurement/grn-confirm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Confirm file size <300 lines**

Run: `wc -l pages/api/procurement/grn-confirm.ts`
Expected: < 300 (the posting logic now lives in `postGrnReceipt.ts`). If over, move the stock_movements insert into a small helper.

- [ ] **Step 6: Commit**

```bash
git add pages/api/procurement/grn-confirm.ts tests/api/procurement/grn-confirm.test.ts
git commit -m "feat(procurement): atomic location-aware GRN confirm via pg.Pool transaction"
```

---

### Task 7: Reconcile tool — FibreFlow `stock_quants` vs live Odoo

**Files:**
- Create: `src/services/odoo/entities/stockQuantReconcile.ts`
- Test: `tests/services/odoo/stockQuantReconcile.test.ts`
- Create: `scripts/reconcile-stock-quants-vs-odoo.ts`

- [ ] **Step 1: Write the failing test (pure diff)**

```typescript
// tests/services/odoo/stockQuantReconcile.test.ts
import { describe, it, expect } from 'vitest';
import { diffOdooVsFf, type FfQuant, type OdooAgg } from '@/services/odoo/entities/stockQuantReconcile';

describe('diffOdooVsFf', () => {
  it('matches equal quantities and reports deltas (sorted by magnitude)', () => {
    const odoo: OdooAgg[] = [
      { stockItemId: 'a', locationId: 'L1', name: 'A@L1', quantity: 100 },
      { stockItemId: 'b', locationId: 'L1', name: 'B@L1', quantity: 50 },
      { stockItemId: 'c', locationId: 'L2', name: 'C@L2', quantity: 10 },
    ];
    const ff: FfQuant[] = [
      { stockItemId: 'a', locationId: 'L1', quantity: 100 },  // match
      { stockItemId: 'b', locationId: 'L1', quantity: 30 },   // delta -20
      // c missing in FF -> delta -10
    ];
    const r = diffOdooVsFf(odoo, ff);
    expect(r.matches).toBe(1);
    expect(r.drift.map((d) => d.name)).toEqual(['B@L1', 'C@L2']); // |20| before |10|
    expect(r.drift[0]).toMatchObject({ odooQty: 50, ffQty: 30, delta: -20 });
    expect(r.drift[1]).toMatchObject({ odooQty: 10, ffQty: 0, delta: -10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/odoo/stockQuantReconcile.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/odoo/entities/stockQuantReconcile.ts
export interface OdooAgg { stockItemId: string; locationId: string; name: string; quantity: number; }
export interface FfQuant { stockItemId: string; locationId: string; quantity: number; }
export interface DriftRow { name: string; stockItemId: string; locationId: string; odooQty: number; ffQty: number; delta: number; }
export interface ReconcileResult { matches: number; drift: DriftRow[]; }

/** Pure: compare Odoo-aggregated on-hand to FibreFlow stock_quants per (item, location). */
export function diffOdooVsFf(odoo: OdooAgg[], ff: FfQuant[]): ReconcileResult {
  const ffMap = new Map(ff.map((q) => [`${q.stockItemId}|${q.locationId}`, q.quantity]));
  let matches = 0;
  const drift: DriftRow[] = [];
  for (const o of odoo) {
    const ffQty = ffMap.get(`${o.stockItemId}|${o.locationId}`) ?? 0;
    if (Math.abs(o.quantity - ffQty) < 0.001) { matches++; continue; }
    drift.push({ name: o.name, stockItemId: o.stockItemId, locationId: o.locationId, odooQty: o.quantity, ffQty, delta: ffQty - o.quantity });
  }
  drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { matches, drift };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/odoo/stockQuantReconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the DB-backed runner + CLI**

Append a `reconcileStockQuantsVsOdoo(client)` to `stockQuantReconcile.ts` that: loads the product+location maps (reuse the seed's loaders — export them), fetches Odoo quants, aggregates to `OdooAgg[]` via the maps, reads FF `stock_quants` into `FfQuant[]`, and returns `diffOdooVsFf(...)`. Then:

```typescript
// scripts/reconcile-stock-quants-vs-odoo.ts
/** Report FibreFlow stock_quants vs live Odoo drift. Run: npx tsx scripts/reconcile-stock-quants-vs-odoo.ts */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { OdooClient } from '../src/services/odoo/odooClient';
import { reconcileStockQuantsVsOdoo } from '../src/services/odoo/entities/stockQuantReconcile';

function cfg(k: string): string { const v = process.env[k]; if (!v) { console.error(`Missing env ${k}`); process.exit(1); } return v; }

async function main() {
  const client = new OdooClient({ url: cfg('ODOO_URL'), db: cfg('ODOO_DB'), username: cfg('ODOO_USERNAME'), password: cfg('ODOO_PASSWORD') });
  const r = await reconcileStockQuantsVsOdoo(client);
  console.log(`\nMatches: ${r.matches}  | Drift rows: ${r.drift.length}`);
  console.log('Top 30 drift (FF - Odoo):');
  r.drift.slice(0, 30).forEach((d) => console.log(`  ${d.name}: FF ${Math.round(d.ffQty)} vs Odoo ${Math.round(d.odooQty)} (Δ ${Math.round(d.delta)})`));
}
main().catch((e) => { console.error('Reconcile failed:', e.message); process.exit(1); });
```

- [ ] **Step 6: Type check + commit**

Run: `npx vitest run tests/services/odoo/stockQuantReconcile.test.ts && npx tsc --noEmit 2>&1 | grep -E "stockQuantReconcile|reconcile-stock" || echo "no new type errors"`
Expected: PASS + `no new type errors`.

```bash
git add src/services/odoo/entities/stockQuantReconcile.ts tests/services/odoo/stockQuantReconcile.test.ts scripts/reconcile-stock-quants-vs-odoo.ts
git commit -m "feat(stock): Odoo-vs-stock_quants reconcile tool (manual)"
```

---

### Task 8: Dry-run the seed, review with Hein, commit the seed, verify

**Files:** none (operational gate). **Prereq:** migration 382 applied (Task 1, Step 4).

- [ ] **Step 1: Run the seed dry-run**

Run: `npx tsx scripts/seed-stock-quants-from-odoo.ts`
Expected: prints seed rows (~140 product×location combos), total qty near **1,370,112**, per-location breakdown across the ~12–16 mapped locations, and a GAPS list. Writes nothing.

- [ ] **Step 2: Resolve the `WH/Stock` ambiguity + review gaps WITH HEIN**

Confirm with Hein: does Odoo `WH/Stock` map to `WH-WH` (VelocityFibre) or `WH-MAIN` (Main Warehouse)? Add the chosen token to `TOKEN_TO_CODE` in `src/services/odoo/stockLocationMap.ts`. Confirm the GAPS list is only expected exclusions ("Vendor Labour" + any non-physical Odoo locations). Re-run Step 1 until the per-location totals look right to Hein. (Commit the `WH` map addition.)

- [ ] **Step 3: Commit the seed (live write)**

Run: `npx tsx scripts/seed-stock-quants-from-odoo.ts --commit`
Expected: `COMMITTED <N> quant rows.`

- [ ] **Step 4: Verify the seed reconciles to Odoo by construction**

Run:
```bash
npx tsx scripts/reconcile-stock-quants-vs-odoo.ts
PGPASSWORD=$PGPASSWORD psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow -tA -c "SELECT count(*), round(SUM(quantity)) FROM stock_quants; SELECT count(*) FROM field_stock_movements WHERE reference='ODOO_OPENING';"
```
Expected: reconcile shows **0 drift** (matches = all mapped); `stock_quants` row count = seed rows, total ≈ 1,370,112; opening movements count = seed rows.

- [ ] **Step 5: Full lint gate**

Run: `npm run ci:quick`
Expected: passes against existing ratchets (0 errors / 185 warnings / 43 pre-existing tsc errors — must not regress).

> Rollback if the seed looks wrong: `DELETE FROM stock_quants; DELETE FROM field_stock_movements WHERE reference='ODOO_OPENING';` (quants started empty).

---

### Task 9: Open the PR

- [ ] **Step 1: Parallel-migration + symptom collision check**

Run: `gh pr list --search 'migration in:title' --state open` and `gh pr list --search 'grn stock_quants in:title' --state open`
Expected: no colliding open PR (per `feedback_parallel_session_migration_coordination`).

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/ff-stock-ledger-consolidation
gh pr create --title "feat(stock): Sprint A — location-aware stock ledger (Odoo seed + atomic GRN confirm)" \
  --body "Implements docs/superpowers/specs/2026-05-26-stock-ledger-consolidation-sprintA-design.md. Seeds stock_quants from live Odoo (migration 382 + seed script), rewrites grn-confirm onto a pg.Pool transaction posting quants + field_stock_movements + qty_available, and adds a manual Odoo reconcile tool. stock_levels/qty_available readers untouched (additive). Seed committed + reconciled to Odoo (0 drift)."
```

- [ ] **Step 3: Blind review + CI (do not self-review)**

Invoke `/review` (single sonnet reviewer for this multi-file but single-domain PR; pass the raw diff + relevant CLAUDE.md). Watch CI: `gh run watch <id> --exit-status`; if GHA doesn't schedule, fall back to `bash scripts/ci-local.sh` in a clean `git worktree add /tmp/ff-pr-ci origin/feat/ff-stock-ledger-consolidation`. Merge only after blind review APPROVED **and** CI passed.

---

## Self-Review (plan vs spec)

- **Spec coverage:** D1 → Task 5/6; D2 (location-only ON CONFLICT) → Task 5 + seed Task 4; D3 (additive qty_available, v_stock_on_hand) → Task 1 + Task 5; D4 (Odoo seed, dry-run→commit, audit-tagged) → Tasks 2–4, 8; Vendors/`vendor` type → Task 1; reconcile tool → Task 7; three flows → Task 6 (receipt) + spec note (transfer = fast-follow); validation gates → Task 8. **Flow-3 DC→Project transfer posting is NOT a task** — per spec §5 it is the immediate fast-follow; called out, not silently dropped.
- **Placeholder scan:** none — every code step has full code; the only `<...>` is the Odoo password (a deliberate secret, not committed) and PR run-id.
- **Type consistency:** `SeedRow`/`SeedGap`/`SeedPlan`, `GrnLine`/`PostGrnArgs`, `TxnClient` (from db-pool), `OdooStockQuant` (from odooClient), `OdooAgg`/`FfQuant`/`DriftRow` are defined once and reused; `postGrnReceiptLines`, `buildSeedPlan`, `seedStockQuantsFromOdoo`, `diffOdooVsFf`, `reconcileStockQuantsVsOdoo` names are consistent across tasks.

## Risks carried from spec
- Ongoing drift until outflow capture (C/D) — reconcile tool is the meantime check.
- Hardcoded Odoo creds in `scripts/explore-odoo-inventory.js` + `scripts/odoo-sync-stock-levels.ts` — flagged; this plan's new code uses env. Rotate in a separate hardening PR.
- Shared DB: migration applies immediately to dev+prod — apply during dev hours, coordinate via the collision check (Task 9).
