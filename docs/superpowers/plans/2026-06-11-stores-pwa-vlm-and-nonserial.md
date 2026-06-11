# Stores PWA — Non-Serial Issue Path + Photo→Serial Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `/my/stores` PWA issue non-serial (lot/quantity) stock with quantity + mandatory photo proof, add a photo→serial fallback (server barcode decode → VLM → pre-filled manual entry), and tune the live scanner so dense Code 128 labels (Gizzu) decode.

**Architecture:** Two PRs off `origin/master`. PR A extends the existing issue flow (`IssueOrchestrator` step machine, shared `_create.ts` picking core, `processPicking` custody path — all verified to already support quantity lines) with a quantity step, a proof-photo upload endpoint, and two new columns on `stock_pickings`. PR B adds one `withMySession` extract endpoint (sharp → zxing-wasm → Qwen3-VL → VF Storage) plus scanner-config changes.

**Tech Stack:** Next.js Pages Router, `withMySession` + `requireStoresActor`, pg.Pool (`@/lib/db-pool`) for new endpoints / Neon shim only inside existing `_create.ts`, `formidable`, `sharp`, `zxing-wasm` 2.2.4, `html5-qrcode` 2.3.8, VF Storage (`vfStorageAdapter`), Qwen3-VL on `100.96.203.105:8100`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-stores-pwa-vlm-and-nonserial-design.md`

---

## Verified facts the plan relies on (do not re-derive)

- `processPicking` issue path already handles quantity-only lines: `postIssueToHolderWith` debits `stock_quants`, credits `stock_custody`, writes `field_stock_movements` from `planned_quantity`; serial promotion only runs when `serial_ids` exist (`pages/api/procurement/field-stock/pickings/[pickingId]/process.ts:154-194`).
- `SQL_DEBIT_QUANT` matches `COALESCE(lot_number,'') = COALESCE($3,'')` (`custodyService.ts:65-69`). Live DB (2026-06-11): **every** `stock_quants` row has NULL/empty `lot_number` and there are **zero** (item, location) pairs with multiple quant rows — so `lotNumber: null` lines debit correctly today. The integration test in Task A9 locks this in.
- `validateSerialsAvailable` skips lines with empty/absent `serialIds` (`_validation.ts:154`) — non-serial lines pass through untouched.
- `_create.ts` cap check already computes quantity as `plannedQuantity ?? serialIds.length` (`_create.ts:92-96`).
- The issue flow is **single item per picking** (`IssueOrchestrator` holds one `stockItem`), so "one photo per picking" needs no multi-line handling.
- zxing-wasm (`tryHarder/tryRotate/tryInvert`) decodes the real Gizzu label still photo → `Code128: GU18W12V2512041619`, and decodes Nokia ISO 15434 DataMatrix envelopes. Verified on this machine 2026-06-11 with `await readBarcodes(new Blob([buf]), {...})` from `zxing-wasm/full` in plain Node.
- `html5-qrcode@2.3.8` typings expose `useBarCodeDetectorIfSupported?: boolean` in the constructor config (`node_modules/html5-qrcode/esm/html5-qrcode.d.ts:7`) and `videoConstraints?: MediaTrackConstraints` in the camera-scan config (line 18).
- `vfStorage.uploadFile(file: Buffer, type: string, category: string, fileName: string)` POSTs to `/upload/<type>/<category>` and returns `{ url }` (`src/services/vfStorageAdapter.ts:62-85`).
- `compressFileToJpeg(file: File, { maxDim = 1280, quality = 0.85 })` → `Promise<Blob>` (`src/modules/receipts/client/compressImage.ts`).
- Latest migration on disk: **407**. Confirm DB max before numbering (Task A1).

**Decision added during planning (spec §Feature 2 amendment):** offline submit is **blocked for non-serial issues** in v1 — the proof photo must upload before the picking is created, so `SignAndSubmitStep` shows an inline error instead of enqueueing to IndexedDB when `!navigator.onLine` and the item is non-serial. Serial issues keep the offline queue unchanged.

**Worktree discipline:** work in `/home/hein/Workspace/FF_Next.js-stores-pwa-scan`. Git writes need the hook syntax: `cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && git …`. Run tests with `./node_modules/.bin/vitest run <file>` (symlinked node_modules) and `npm run ci:quick` before each PR — never full `npm run ci` (vitest hangs in worktrees).

---

# PR A — Non-serial issue path (branch `feat/stores-pwa-vlm-nonserial`, current worktree branch)

### Task A1: Migration — proof photo columns on stock_pickings

**Files:**
- Create: `scripts/migrations/sql/408_stock_picking_proof_photo.sql` (number TBC in step 1)
- Create: `scripts/migrations/sql/rollback_408_stock_picking_proof_photo.sql`

- [ ] **Step 1: Confirm the migration number**

Run (read-only; uses `.env.local` DATABASE_URL):

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)
psql "$DATABASE_URL" -t -c "SELECT MAX(version::int) FROM migrations WHERE version ~ '^[0-9]+$';" \
  -c "SELECT MAX(version::int) FROM schema_migrations WHERE version ~ '^[0-9]+$';" 2>/dev/null
ls scripts/migrations/sql/ | grep -oP '^\d+' | sort -n | tail -1
```

Expected: disk max 407. Migration number = MAX(all three) + 1. If it is not 408, rename the files below accordingly.

- [ ] **Step 2: Write the migration**

`scripts/migrations/sql/408_stock_picking_proof_photo.sql`:

```sql
-- 408: photo proof for non-serial stock issues from the /my/stores PWA.
-- One photo per picking (spec 2026-06-11-stores-pwa-vlm-and-nonserial-design.md).
-- proof_photo_key: VF Storage key  e.g. stores/picking-proof/<staffId>__<uuid>.jpg
-- proof_photo_url: public path     e.g. /storage/stores/picking-proof/<file>
-- Nullable: serial pickings never set them. No backfill (table near-empty).

ALTER TABLE stock_pickings
  ADD COLUMN IF NOT EXISTS proof_photo_key text,
  ADD COLUMN IF NOT EXISTS proof_photo_url text;
```

- [ ] **Step 3: Write the rollback**

`scripts/migrations/sql/rollback_408_stock_picking_proof_photo.sql`:

```sql
-- Rollback 408: drop the proof-photo columns.
ALTER TABLE stock_pickings
  DROP COLUMN IF EXISTS proof_photo_key,
  DROP COLUMN IF EXISTS proof_photo_url;
```

- [ ] **Step 4: Apply to the shared dev/prod DB (CONTROLLER-OWNED — the main session runs this, not a subagent)**

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)
psql "$DATABASE_URL" -c "\i scripts/migrations/sql/408_stock_picking_proof_photo.sql" \
  -c "\d stock_pickings" | grep proof_photo
```

Expected: both columns listed, type `text`. (Additive nullable columns on a shared DB are safe to apply ahead of deploy; the migration runner will record it on next deploy.)

- [ ] **Step 5: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add scripts/migrations/sql/408_stock_picking_proof_photo.sql scripts/migrations/sql/rollback_408_stock_picking_proof_photo.sql && \
git commit -m "feat(stores-pwa): mig 408 proof photo columns on stock_pickings"
```

---

### Task A2: Types + items API client — issuable items of all tracking types

**Files:**
- Modify: `src/modules/field-stock-pwa/types.ts` (add fields to `PwaIssueDraft`)
- Modify: `src/modules/field-stock-pwa/api/items.ts` (rename fetch fn, add fields)
- Test: `src/modules/field-stock-pwa/api/__tests__/items.test.ts` (create)

- [ ] **Step 1: Extend PwaIssueDraft**

In `src/modules/field-stock-pwa/types.ts`, add to `PwaIssueDraft` (after `serials`):

```typescript
  /** Quantity for non-serial (lot/quantity/none) items. Undefined for serial issues. */
  quantity?: number;
  /** VF Storage key of the mandatory proof photo (non-serial issues only). */
  proofPhotoKey?: string;
  /** Public /storage/... URL of the proof photo (non-serial issues only). */
  proofPhotoUrl?: string;
```

- [ ] **Step 2: Write the failing test**

`src/modules/field-stock-pwa/api/__tests__/items.test.ts`:

```typescript
/**
 * fetchIssuableStockItems — row mapping incl. trackingType/uom and the
 * no-trackingType-param query string.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.fn();
vi.mock('../request', () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { fetchIssuableStockItems } from '../items';

describe('fetchIssuableStockItems', () => {
  beforeEach(() => requestMock.mockReset());

  it('maps rows including trackingType and uom, parsing standard_cost', async () => {
    requestMock.mockResolvedValue([
      { id: 'i1', name: 'Cable ties', item_code: 'CABLETIE-2.5x100',
        tracking_type: 'quantity', uom: 'Units', standard_cost: '12.50' },
      { id: 'i2', name: 'FT-ONT', item_code: 'FT-ONT',
        tracking_type: 'serial', uom: 'Units', standard_cost: null },
    ]);
    const items = await fetchIssuableStockItems();
    expect(items).toEqual([
      { id: 'i1', name: 'Cable ties', sku: 'CABLETIE-2.5x100',
        trackingType: 'quantity', uom: 'Units', unitValueZar: 12.5 },
      { id: 'i2', name: 'FT-ONT', sku: 'FT-ONT',
        trackingType: 'serial', uom: 'Units', unitValueZar: null },
    ]);
  });

  it('omits trackingType from the query (all types) and passes search', async () => {
    requestMock.mockResolvedValue([]);
    await fetchIssuableStockItems({ search: 'cable' });
    const url = requestMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/my/stores/items?search=cable');
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`fetchIssuableStockItems` is not exported)

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && ./node_modules/.bin/vitest run src/modules/field-stock-pwa/api/__tests__/items.test.ts
```

- [ ] **Step 4: Implement**

In `src/modules/field-stock-pwa/api/items.ts`: add `tracking_type`/`uom` to `StockItemRow`, replace `fetchSerialStockItems` with:

```typescript
export type PwaTrackingType = 'serial' | 'lot' | 'quantity' | 'none';

export interface PwaIssuableItem {
  id: string;
  name: string;
  sku: string | null;
  trackingType: PwaTrackingType;
  uom: string | null;
  unitValueZar: number | null;
}

/**
 * Fetch all active, issuable stock items (every tracking type).
 * No trackingType param → the endpoint returns all types (Task A3).
 */
export async function fetchIssuableStockItems(
  opts: { search?: string } = {}
): Promise<PwaIssuableItem[]> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  const qs = params.toString();
  const rows = await request<StockItemRow[]>(
    `/api/my/stores/items${qs ? `?${qs}` : ''}`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.item_code ?? null,
    trackingType: (r.tracking_type as PwaTrackingType) ?? 'serial',
    uom: r.uom ?? null,
    unitValueZar: r.standard_cost != null ? parseFloat(r.standard_cost) : null,
  }));
}
```

(`StockItemRow` gains `uom: string | null`.) Update the barrel `src/modules/field-stock-pwa/api/index.ts` if it re-exports `fetchSerialStockItems`.

- [ ] **Step 5: Run test — expect PASS**, then commit

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/types.ts src/modules/field-stock-pwa/api/items.ts src/modules/field-stock-pwa/api/index.ts src/modules/field-stock-pwa/api/__tests__/items.test.ts && \
git commit -m "feat(stores-pwa): issuable-items client returns all tracking types"
```

(PickItemStep still imports the old name — the tree won't compile until Task A4; that's fine within the same PR, but if you run `tsc` between tasks expect that one error.)

---

### Task A3: Items endpoint — return all tracking types

**Files:**
- Modify: `pages/api/my/stores/items.ts`

- [ ] **Step 1: Implement the four explicit query branches**

Replace the two-branch query block (lines 29-61) with four explicit branches (this file uses pg.Pool tagged templates; keep the existing explicit-branch style — no conditional SQL fragments):

```typescript
    const trackingType = req.query.trackingType as string | undefined;
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? `%${rawSearch}%` : undefined;

    let rows: Record<string, unknown>[];
    if (trackingType && search) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true AND tracking_type = ${trackingType}
          AND (name ILIKE ${search} OR item_code ILIKE ${search})
        ORDER BY category, name LIMIT 100
      `;
    } else if (trackingType) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true AND tracking_type = ${trackingType}
        ORDER BY category, name LIMIT 100
      `;
    } else if (search) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true
          AND (name ILIKE ${search} OR item_code ILIKE ${search})
        ORDER BY tracking_type = 'serial' DESC, category, name LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true
        ORDER BY tracking_type = 'serial' DESC, category, name LIMIT 100
      `;
    }
```

Behaviour change: **no `trackingType` param now means all types** (previously defaulted to `'serial'`). The only existing caller always sent `trackingType=serial`, so nothing regresses. Serial items sort first (they're the high-traffic picks). Update the file's doc comment to match. Note the 100-row LIMIT now spans ~300 items — the search box is the access path; keep the LIMIT.

- [ ] **Step 2: Verify against dev DB via curl (needs a logged-in ff_my_session cookie) — OR defer to the Task A10 browser verification.** Minimum static check:

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && ./node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -v "PickItemStep" | head
```

Expected: no NEW errors from this file (PickItemStep's stale import is fixed in Task A4).

- [ ] **Step 3: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add pages/api/my/stores/items.ts && \
git commit -m "feat(stores-pwa): items endpoint returns all tracking types when unfiltered"
```

---

### Task A4: PickItemStep — list all issuable items with tracking badge

**Files:**
- Modify: `src/modules/field-stock-pwa/components/PickItemStep.tsx`

- [ ] **Step 1: Update the StockItem interface and fetch**

In `PickItemStep.tsx`: replace the `fetchSerialStockItems` import with `fetchIssuableStockItems` (and import `PwaTrackingType` from `../api/items` or the barrel). Extend the exported `StockItem`:

```typescript
export interface StockItem {
  id: string;
  name: string;
  sku: string | null;
  trackingType: PwaTrackingType;
  /** Unit of measure, e.g. 'Units', 'Meters' — shown in the quantity step. */
  uom: string | null;
  unitValueZar: number | null;
}
```

In `load()`, call `fetchIssuableStockItems(searchTerm ? { search: searchTerm } : {})` and map straight through (the client already returns this shape). Update the doc comment (it still references `trackingType=serial` and the old procurement endpoint — both stale).

- [ ] **Step 2: Add the tracking badge to the item row**

In the item list row (next to the sku line), render:

```tsx
<span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${
  item.trackingType === 'serial'
    ? 'bg-sky-950 text-sky-300'
    : 'bg-amber-950 text-amber-300'
}`}>
  {item.trackingType === 'serial' ? 'Serial' : 'Qty'}
</span>
```

- [ ] **Step 3: tsc + commit**

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && ./node_modules/.bin/tsc --noEmit 2>&1 | grep field-stock-pwa | head
```

Expected: errors only in IssueOrchestrator/SignAndSubmitStep (their `stockItem` prop shapes — fixed in A5/A6). Commit:

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/components/PickItemStep.tsx && \
git commit -m "feat(stores-pwa): PickItemStep lists all issuable items with tracking badge"
```

---

### Task A5: EnterQuantityStep component

**Files:**
- Create: `src/modules/field-stock-pwa/components/EnterQuantityStep.tsx`
- Test: `src/modules/field-stock-pwa/components/__tests__/EnterQuantityStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * EnterQuantityStep — quantity entry for non-serial issues.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnterQuantityStep } from '../EnterQuantityStep';

const ITEM = {
  id: 'i1', name: 'Cable ties', sku: 'CABLETIE-2.5x100',
  trackingType: 'quantity' as const, uom: 'Units', unitValueZar: 12.5,
};

describe('EnterQuantityStep', () => {
  it('disables Continue at quantity 0 and enables it for a positive quantity', () => {
    const onDone = vi.fn();
    const onChange = vi.fn();
    render(<EnterQuantityStep stockItem={ITEM} quantity={0} onChange={onChange} onDone={onDone} />);
    const btn = screen.getByRole('button', { name: /continue/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it('shows the uom and rejects negative input', () => {
    const onChange = vi.fn();
    render(<EnterQuantityStep stockItem={ITEM} quantity={5} onChange={onChange} onDone={vi.fn()} />);
    expect(screen.getByText('Units')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '-3' } });
    expect(onChange).not.toHaveBeenCalledWith(-3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

```bash
./node_modules/.bin/vitest run src/modules/field-stock-pwa/components/__tests__/EnterQuantityStep.test.tsx
```

- [ ] **Step 3: Implement** (`'use client'`; match the module's dark-theme styling; keep <200 lines)

```tsx
'use client';

/**
 * EnterQuantityStep — step 4 of the issue flow for NON-SERIAL items
 * (tracking_type lot | quantity | none). Replaces ScanSerialsStep for these
 * items: the stores person types how much is being handed out; photo proof
 * is captured later in SignAndSubmitStep (one photo per picking).
 *
 * Decimals allowed (planned_quantity is numeric(12,3) — cable is issued in
 * metres). Lot items carry lot_number=null in v1 (storemen don't pick lots;
 * all live stock_quants rows have NULL lot_number — see plan "Verified facts").
 */

import { Package } from 'lucide-react';
import type { StockItem } from './PickItemStep';

export interface EnterQuantityStepProps {
  stockItem: StockItem;
  quantity: number;
  onChange: (quantity: number) => void;
  onDone: () => void;
}

export function EnterQuantityStep({ stockItem, quantity, onChange, onDone }: EnterQuantityStepProps) {
  const handleInput = (raw: string) => {
    const parsed = parseFloat(raw);
    if (raw === '') { onChange(0); return; }
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange(Math.round(parsed * 1000) / 1000); // numeric(12,3)
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <Package className="w-4 h-4 text-neutral-500" />
        <div>
          <span className="text-sm font-medium text-white">{stockItem.name}</span>
          {stockItem.sku && <span className="ml-2 text-xs text-neutral-500">{stockItem.sku}</span>}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="issue-quantity" className="text-sm font-medium text-neutral-300">
          Quantity
        </label>
        <div className="flex items-center gap-2">
          <input
            id="issue-quantity"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={quantity === 0 ? '' : quantity}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="0"
            className="flex-1 px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-lg font-mono placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
          />
          {stockItem.uom && <span className="text-sm text-neutral-400 w-16">{stockItem.uom}</span>}
        </div>
        {stockItem.unitValueZar != null && quantity > 0 && (
          <p className="text-xs text-neutral-500">
            ≈ R{(stockItem.unitValueZar * quantity).toFixed(2)}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDone}
        disabled={quantity <= 0}
        className="w-full py-3.5 rounded-lg bg-emerald-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-600 active:bg-emerald-800"
      >
        Continue
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS. Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/components/EnterQuantityStep.tsx src/modules/field-stock-pwa/components/__tests__/EnterQuantityStep.test.tsx && \
git commit -m "feat(stores-pwa): EnterQuantityStep for non-serial issues"
```

---

### Task A6: IssueOrchestrator — branch on tracking type

**Files:**
- Modify: `src/modules/field-stock-pwa/components/IssueOrchestrator.tsx`

- [ ] **Step 1: Extend the state machine**

Changes (keep file <300 lines):

1. `type IssueStep` gains `'enter-quantity'`:
   `'pick-warehouse' | 'pick-tech' | 'pick-item' | 'scan-serials' | 'enter-quantity' | 'sign-submit' | 'done'`.
2. `IssueState` gains `quantity: number;` — `INITIAL_ISSUE_STATE` sets `quantity: 0`.
3. `STEP_INDEX`: `'enter-quantity': 4` (same slot as scan-serials).
4. `STEP_LABELS` becomes a function of the picked item:
   ```typescript
   const stepLabels = (item: StockItem | null): string[] =>
     ['WH', 'Tech', 'Item', item && item.trackingType !== 'serial' ? 'Qty' : 'Serials', 'Sign'];
   ```
   and `<StepProgress current={...} labels={stepLabels(flow.stockItem)} />`.
5. `PickItemStep.onPick` branches:
   ```tsx
   onPick={(item) => setFlow((s) => ({
     ...s,
     step: item.trackingType === 'serial' ? 'scan-serials' : 'enter-quantity',
     stockItem: item,
     scanned: [],
     quantity: 0,
   }))}
   ```
6. New step render after the scan-serials block:
   ```tsx
   {flow.step === 'enter-quantity' && flow.stockItem && (
     <EnterQuantityStep stockItem={flow.stockItem} quantity={flow.quantity}
       onChange={(q) => setFlow((s) => ({ ...s, quantity: q }))}
       onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))} />
   )}
   ```
7. `SignAndSubmitStep` gets `quantity={flow.quantity}` and its `onBack` returns to the right step:
   ```tsx
   onBack={() => setFlow((s) => ({
     ...s,
     step: s.stockItem && s.stockItem.trackingType !== 'serial' ? 'enter-quantity' : 'scan-serials',
   }))}
   ```
8. `isDirty` also counts `flow.quantity > 0`.

Import `EnterQuantityStep`. The `stockItem` prop type passed to SignAndSubmitStep widens in Task A8.

- [ ] **Step 2: tsc check** (expect only SignAndSubmitStep prop errors, fixed in A8), **commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/components/IssueOrchestrator.tsx && \
git commit -m "feat(stores-pwa): issue flow branches to quantity step for non-serial items"
```

---

### Task A7: Proof-photo upload endpoint

**Files:**
- Create: `pages/api/my/stores/pickings/upload-proof.ts`
- Test: manual curl in Step 3 (multipart endpoints in this repo are verified by integration, mirroring `/api/my/receipts/extract` which has no unit test; the validation logic worth unit-testing lives in `_create.ts` → Task A9)

- [ ] **Step 1: Implement**

```typescript
/**
 * POST /api/my/stores/pickings/upload-proof — upload the mandatory proof
 * photo for a NON-SERIAL stock issue, BEFORE the picking is created.
 *
 * Upload-first sequencing: client uploads here, gets { photoKey, photoUrl },
 * then includes them in POST /api/my/stores/pickings. The picking create
 * rejects non-serial issues without a proofPhotoKey (_create.ts).
 *
 * Storage: VF Storage /upload/stores/picking-proof, filename
 * <staffId>__<uuid>.jpg. Orphaned blobs (upload then abandoned flow) are
 * accepted in v1 — same trade-off as receipts extract.
 *
 * Gated to stores roles via requireStoresActor (withMySession tier).
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import formidable from 'formidable';
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { vfStorage } from '@/services/vfStorageAdapter';

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function parseMultipart(req: NextApiRequest): Promise<{ files: formidable.Files }> {
  const form = formidable({ multiples: false, maxFileSize: MAX_FILE_BYTES, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => (err ? reject(err) : resolve({ files })));
  });
}

function pickFirst<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  let parsed: { files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('upload-proof multipart parse failed', { err }, 'my/stores/upload-proof');
    return apiResponse.badRequest(res, 'Could not read upload — file too large or malformed.');
  }

  const file = pickFirst(parsed.files.photo) as formidable.File | undefined;
  if (!file) return apiResponse.badRequest(res, 'Photo is required (form field "photo").');
  const mime = file.mimetype || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) return apiResponse.badRequest(res, `Unsupported file type: ${mime}`);

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file.filepath);
  } finally {
    fs.unlink(file.filepath).catch(() => undefined);
  }

  try {
    const filename = `${actor.staffId}__${crypto.randomUUID()}.jpg`;
    const uploaded = await vfStorage.uploadFile(buffer, 'stores', 'picking-proof', filename);
    return apiResponse.success(res, {
      photoKey: `stores/picking-proof/${filename}`,
      photoUrl: uploaded.url,
    });
  } catch (err) {
    log.error('upload-proof storage upload failed', { err, staffId: actor.staffId }, 'my/stores/upload-proof');
    return apiResponse.internalError(res, err);
  }
});
```

- [ ] **Step 2: tsc check** — confirm `vfStorage` is the export name (`import { vfStorage } from '@/services/vfStorageAdapter'`; if the adapter exports a class instance under another name, match it — check `src/services/vfStorageAdapter.ts` exports).

- [ ] **Step 3: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add pages/api/my/stores/pickings/upload-proof.ts && \
git commit -m "feat(stores-pwa): proof-photo upload endpoint for non-serial issues"
```

---

### Task A8: Client API — uploadIssueProof + submitIssue quantity mapping; SignAndSubmitStep photo capture

**Files:**
- Modify: `src/modules/field-stock-pwa/api/pickings.ts`
- Modify: `src/modules/field-stock-pwa/components/SignAndSubmitStep.tsx`
- Test: `src/modules/field-stock-pwa/api/__tests__/pickings.test.ts` (create; mock `../request`)

- [ ] **Step 1: Write the failing test for the body mapping**

```typescript
/**
 * submitIssue — non-serial drafts send plannedQuantity + proof photo fields
 * and omit serialIds; serial drafts unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.fn();
vi.mock('../request', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  ApiError: class ApiError extends Error {},
}));

import { submitIssue } from '../pickings';
import type { PwaIssueDraft } from '../../types';

const BASE: PwaIssueDraft = {
  technicianId: 't1', contractorId: null, stockItemId: 'i1',
  serials: [], signatureDataUrl: 'data:image/png;base64,x', notes: '',
  sourceLocationId: 'src1', destinationLocationId: 'dst1',
};

describe('submitIssue body mapping', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ id: 'p1', picking_number: 'PCK-1', status: 'draft' });
  });

  it('non-serial: plannedQuantity from draft.quantity, no serialIds, proof fields present', async () => {
    await submitIssue({ ...BASE, quantity: 25, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k' });
    const body = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(body.lines[0].plannedQuantity).toBe(25);
    expect(body.lines[0].serialIds).toBeUndefined();
    expect(body.proofPhotoKey).toBe('k');
    expect(body.proofPhotoUrl).toBe('/storage/k');
  });

  it('serial: plannedQuantity = serial count, serialIds present, no proof fields', async () => {
    await submitIssue({
      ...BASE,
      serials: [{ serialNumber: 'S1', stockItemId: 'i1', stockItemName: 'x', scannedAt: 1, state: 'valid' }],
    });
    const body = JSON.parse(requestMock.mock.calls[0][1].body as string);
    expect(body.lines[0].plannedQuantity).toBe(1);
    expect(body.lines[0].serialIds).toEqual(['S1']);
    expect(body.proofPhotoKey).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement in `api/pickings.ts`:

In `submitIssue`, change the body construction:

```typescript
  const isSerialIssue = draft.serials.length > 0;
  const body = {
    pickingType: 'issue',
    sourceLocationId: draft.sourceLocationId,
    destinationLocationId: draft.destinationLocationId,
    technicianId: draft.technicianId,
    contractorId: draft.contractorId ?? undefined,
    notes: draft.notes || undefined,
    proofPhotoKey: draft.proofPhotoKey,
    proofPhotoUrl: draft.proofPhotoUrl,
    lines: [
      {
        stockItemId: draft.stockItemId,
        plannedQuantity: isSerialIssue ? draft.serials.length : (draft.quantity ?? 0),
        serialIds: isSerialIssue ? draft.serials.map((s) => s.serialNumber) : undefined,
        notes: draft.notes || undefined,
      },
    ],
  };
```

And add the upload helper:

```typescript
/**
 * Upload the mandatory proof photo for a non-serial issue. Multipart, so it
 * bypasses the JSON request() helper. Returns the storage key+URL to include
 * in the subsequent picking create.
 */
export async function uploadIssueProof(photo: Blob): Promise<{ photoKey: string; photoUrl: string }> {
  const form = new FormData();
  form.append('photo', photo, 'proof.jpg');
  const res = await fetch('/api/my/stores/pickings/upload-proof', { method: 'POST', body: form });
  const json = (await res.json()) as {
    success: boolean;
    data?: { photoKey: string; photoUrl: string };
    error?: { message?: string };
  };
  if (!res.ok || !json.success || !json.data) {
    throw new ApiError(json.error?.message ?? `Proof upload failed (${res.status})`, res.status);
  }
  return json.data;
}
```

(Check `request.ts` for `ApiError`'s constructor signature and match it.)

- [ ] **Step 3: Run test — expect PASS. Commit api changes**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/api/pickings.ts src/modules/field-stock-pwa/api/__tests__/pickings.test.ts && \
git commit -m "feat(stores-pwa): submitIssue supports quantity lines + proof upload helper"
```

- [ ] **Step 4: SignAndSubmitStep — photo capture + offline guard + quantity-aware cap**

Modify `SignAndSubmitStep.tsx` (keep <200 lines for the component — if the photo block pushes it over, extract `ProofPhotoCapture.tsx` as a sibling presentational component):

1. Props: `stockItem` type becomes the full `StockItem` from PickItemStep (it now carries `trackingType`); add `quantity: number;`.
2. Derived: `const isSerialIssue = stockItem.trackingType === 'serial';` and `const unitCount = isSerialIssue ? validSerials.length : quantity;` — use `unitCount` in the `checkPendingValueCap` call and the summary line ("25 Units of Cable ties" when non-serial; reuse `stockItem.uom`).
3. Photo state + capture block (only rendered when `!isSerialIssue`), above the SignaturePad:

```tsx
const [proofPhoto, setProofPhoto] = useState<Blob | null>(null);
const [proofPreview, setProofPreview] = useState<string | null>(null);

const handlePhotoPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const compressed = await compressFileToJpeg(file); // 1280px is plenty for proof
  setProofPhoto(compressed);
  setProofPreview(URL.createObjectURL(compressed));
}, []);
```

```tsx
{!isSerialIssue && (
  <div className="space-y-1.5">
    <p className="text-sm font-medium text-neutral-300">
      Photo of the stock being handed out <span className="text-rose-400">*</span>
    </p>
    {proofPreview ? (
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proofPreview} alt="Proof of stock" className="w-full rounded-lg border border-neutral-700" />
        <label className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-neutral-900/90 border border-neutral-700 text-xs text-white cursor-pointer">
          Retake
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoPick} />
        </label>
      </div>
    ) : (
      <label className="w-full flex items-center justify-center gap-2 py-4 rounded-lg bg-neutral-900 border border-dashed border-neutral-600 text-neutral-300 text-sm font-medium cursor-pointer">
        <Camera className="w-5 h-5" /> Take photo
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoPick} />
      </label>
    )}
  </div>
)}
```

Imports: `Camera` from lucide-react, `compressFileToJpeg` from `@/modules/receipts/client/compressImage`, `uploadIssueProof` from the api barrel.

4. Submit gating: `canSubmit` additionally requires `(isSerialIssue ? validSerials.length > 0 : quantity > 0 && proofPhoto !== null)` (replace the existing `validSerials.length > 0` term).
5. `handleSubmit` for non-serial: **block offline** and upload first:

```typescript
if (!isSerialIssue) {
  if (!navigator.onLine) {
    setError('You are offline — quantity issues need a connection to upload the proof photo. Try again when you have signal.');
    setSubmitting(false);
    return;
  }
  const proof = await uploadIssueProof(proofPhoto!);
  const result = await submitIssue({ ...draftBase, quantity, proofPhotoKey: proof.photoKey, proofPhotoUrl: proof.photoUrl });
  onSubmitted(result);
  return;
}
// serial path: existing online-submit / offline-enqueue behaviour unchanged
```

(Restructure `handleSubmit` so `draftBase` is the existing draft object minus the new fields; keep the existing try/catch + ApiError surfacing around both paths.)

- [ ] **Step 5: tsc clean for the module + run existing component tests**

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && ./node_modules/.bin/tsc --noEmit 2>&1 | grep field-stock-pwa
./node_modules/.bin/vitest run src/modules/field-stock-pwa
```

Expected: no errors; all module tests pass.

- [ ] **Step 6: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/field-stock-pwa/components/SignAndSubmitStep.tsx src/modules/field-stock-pwa/components/ProofPhotoCapture.tsx 2>/dev/null; \
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && git add -u src/modules/field-stock-pwa && \
git commit -m "feat(stores-pwa): proof photo capture + offline guard in SignAndSubmitStep"
```

---

### Task A9: Server enforcement in _create.ts + unit test

**Files:**
- Modify: `pages/api/procurement/field-stock/pickings/_create.ts`
- Test: `pages/api/procurement/field-stock/pickings/__tests__/_create.proof.test.ts` (create; follow the mocking style of any existing test under that directory — check `ls pages/api/procurement/field-stock/pickings/__tests__/` first; if none exists, mock `@neondatabase/serverless` and `_validation` with vi.mock)

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * createPicking — proof-photo enforcement for non-serial issue lines.
 * The Neon sql client and validators are mocked; we assert on the HTTP
 * response for the validation branch (no DB writes reached).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@neondatabase/serverless', () => ({
  neon: () => vi.fn().mockResolvedValue([]),
}));
vi.mock('../_validation', () => ({
  validateFieldDefaultDestination: vi.fn().mockResolvedValue({ ok: true }),
  validateSerialsAvailable: vi.fn().mockResolvedValue({ ok: true, resolvedSerialIds: new Map() }),
}));

import { createPicking } from '../_create';

function mockRes() {
  const res: Partial<NextApiResponse> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => { res.statusCode = code; return res; }) as never;
  res.json = vi.fn().mockImplementation((body: unknown) => { res.body = body; return res; }) as never;
  return res as NextApiResponse & { statusCode?: number; body?: unknown };
}

const NON_SERIAL_BODY = {
  pickingType: 'issue',
  sourceLocationId: 'src', destinationLocationId: 'dst',
  lines: [{ stockItemId: 'i1', plannedQuantity: 25 }],
};

describe('createPicking proof-photo enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-serial issue without proofPhotoKey', async () => {
    const res = mockRes();
    await createPicking({ body: NON_SERIAL_BODY } as NextApiRequest, res, 'staff1');
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain('proof');
  });

  it('rejects a non-serial issue with plannedQuantity <= 0', async () => {
    const res = mockRes();
    await createPicking(
      { body: { ...NON_SERIAL_BODY, proofPhotoKey: 'k', proofPhotoUrl: '/storage/k',
        lines: [{ stockItemId: 'i1', plannedQuantity: 0 }] } } as NextApiRequest,
      res, 'staff1');
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`createPicking` lacks the branch; 400 not returned)

- [ ] **Step 3: Implement in `_create.ts`** (Neon shim file — only add STATIC SQL, no conditional fragments):

After the existing `lines` array validation (line ~51), add:

```typescript
    // ── Non-serial issue lines: proof photo + positive quantity (spec 2026-06-11) ──
    // A line with no serialIds is a quantity-based issue (lot/quantity/none
    // tracking). One proof photo per picking is mandatory for these; serial
    // pickings carry the serials themselves as evidence.
    const { proofPhotoKey, proofPhotoUrl } = req.body as {
      proofPhotoKey?: string; proofPhotoUrl?: string;
    };
    const nonSerialLines = (lines as PickingLine[]).filter(
      (l) => !Array.isArray(l.serialIds) || l.serialIds.length === 0,
    );
    if ((pickingType ?? null) === 'issue' && nonSerialLines.length > 0) {
      if (!proofPhotoKey) {
        return apiResponse.validationError(res, {
          proofPhotoKey: 'A proof photo is required when issuing non-serial stock',
        });
      }
      const badQty = nonSerialLines.find(
        (l) => typeof l.plannedQuantity !== 'number' || !(l.plannedQuantity > 0),
      );
      if (badQty) {
        return apiResponse.validationError(res, {
          plannedQuantity: 'Quantity must be greater than zero for non-serial lines',
        });
      }
    }
```

And extend the header INSERT (static column additions):

```sql
      INSERT INTO stock_pickings (
        picking_number, picking_type,
        source_location_id, destination_location_id,
        project_id, job_reference, job_type,
        contractor_id, contractor_name, team_name,
        technician_id, technician_name,
        scheduled_date, status, notes,
        created_by_staff_id,
        proof_photo_key, proof_photo_url
      ) VALUES (
        ..., ${createdByStaffId},
        ${proofPhotoKey || null}, ${proofPhotoUrl || null}
      )
```

(Keep all existing VALUES; only append the two params.) File stays under 300 lines — if it tips over, extract the new validation block into `_validation.ts` as `validateNonSerialProof(body, lines): ValidationResult` and call it like the other validators.

- [ ] **Step 4: Run test — expect PASS. Then run the whole pickings test dir + tsc**

```bash
./node_modules/.bin/vitest run pages/api/procurement/field-stock/pickings
./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add pages/api/procurement/field-stock/pickings/ && \
git commit -m "feat(stores-pwa): enforce proof photo + positive qty for non-serial issue pickings"
```

---

### Task A10: End-to-end verification on dev + PR A

- [ ] **Step 1: ci:quick**

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && npm run ci:quick
```

Expected: 0 errors, warnings ≤ ratchet baseline.

- [ ] **Step 2: Local build smoke** (`PORT=3004 npm run dev` in the worktree), then browser-verify with Playwright/Claude-in-Chrome against `localhost:3004`:
  - `/my/stores/issue`: pick warehouse → tech → pick a **quantity** item (search "CABLETIE") → badge shows Qty → quantity step accepts 5 → sign-submit shows photo requirement → submit disabled until photo + signature → with both, submit succeeds → success screen.
  - Verify in DB: `SELECT picking_number, proof_photo_key, proof_photo_url, status FROM stock_pickings ORDER BY created_at DESC LIMIT 1;` → proof fields populated, status `done`; `SELECT * FROM field_stock_movements ORDER BY performed_at DESC LIMIT 1;` → quantity movement row; `stock_quants` decremented for the item at the source location.
  - Serial regression: issue an `in_stock` FT-ONT serial (e.g. `ALCLB4922DE2`, Mamelodi Pop1 WH) — flow unchanged, no photo asked.
- [ ] **Step 3: Push + PR** (target `master`), body summarises the feature + migration 408 + offline-block decision. Then the standing rule: blind `/review` (review-team if >500 lines), `gh run watch`, merge only after both pass.

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && git push -u origin feat/stores-pwa-vlm-nonserial
gh pr create --title "feat(stores-pwa): non-serial issue path with quantity + mandatory proof photo" --body "..."
```

---

# PR B — Photo→serial fallback + Gizzu scanner tuning (branch `feat/stores-pwa-photo-serial-fallback` off PR A's branch; rebase onto master after A merges)

### Task B1: Extract core — barcode decode + VLM + patterns

**Files:**
- Create: `pages/api/my/stores/serials/_extractCore.ts` (underscore = not a route; same pattern as pickings/_create.ts)
- Test: `pages/api/my/stores/serials/__tests__/_extractCore.test.ts`

- [ ] **Step 1: Write the failing tests** — the zxing test generates a real Code 128 with zxing-wasm's writer, so the decode path is exercised end-to-end with no fixtures:

```typescript
/**
 * _extractCore — serial extraction pipeline units.
 * The barcode test writes a real Code128 PNG with zxing-wasm's writer and
 * decodes it back (no image fixtures, no mocked decoder).
 */
import { describe, it, expect } from 'vitest';
import {
  decodeSerialFromImage,
  validateSerialCandidate,
  parseVlmSerialResponse,
} from '../_extractCore';

describe('decodeSerialFromImage', () => {
  it('decodes a Code128 Gizzu serial from PNG bytes', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const written = await writeBarcode('GU18W12V2512041619', { format: 'Code128' });
    expect(written.image).toBeTruthy();
    const buf = Buffer.from(await written.image!.arrayBuffer());
    const result = await decodeSerialFromImage(buf);
    expect(result).toBe('GU18W12V2512041619');
  });

  it('unwraps an ISO 15434 DataMatrix envelope to the bare serial', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const payload = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4918842\x1e\x04';
    const written = await writeBarcode(payload, { format: 'DataMatrix' });
    const buf = Buffer.from(await written.image!.arrayBuffer());
    const result = await decodeSerialFromImage(buf);
    expect(result).toBe('ALCLB4918842');
  });

  it('returns null for a non-barcode image', async () => {
    const sharp = (await import('sharp')).default;
    const blank = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#888' } })
      .jpeg().toBuffer();
    expect(await decodeSerialFromImage(blank)).toBeNull();
  });
});

describe('validateSerialCandidate', () => {
  it.each([
    ['ALCLB4918842', 'ont'],
    ['GU18W12V2512041619', 'gizzu'],
  ])('accepts %s as %s', (serial, family) => {
    expect(validateSerialCandidate(serial)).toEqual({ serial, family });
  });

  it('accepts a generic S/N-looking value with family generic', () => {
    expect(validateSerialCandidate('AB12-CD3456')).toEqual({ serial: 'AB12-CD3456', family: 'generic' });
  });

  it.each(['', 'ALHN-1234', 'x', 'ALCLB4923FA8' /* prompt example */])(
    'rejects %s', (bad) => expect(validateSerialCandidate(bad)).toBeNull(),
  );
});

describe('parseVlmSerialResponse', () => {
  it('parses a fenced JSON answer', () => {
    expect(parseVlmSerialResponse('```json\n{"serial":"GU18W12V2512041330","confidence":0.93}\n```'))
      .toEqual({ serial: 'GU18W12V2512041330', confidence: 0.93 });
  });
  it('returns null serial on NOT_FOUND', () => {
    expect(parseVlmSerialResponse('{"serial":null,"confidence":0}'))
      .toEqual({ serial: null, confidence: 0 });
  });
  it('returns null on garbage', () => {
    expect(parseVlmSerialResponse('I cannot see a serial')).toBeNull();
  });
});
```

(`writeBarcode` exists in zxing-wasm 2.x full build; if the option key differs run `node -e "import('zxing-wasm/full').then(m=>console.log(Object.keys(m)))"` and check its `WriterOptions` type — adjust `format` casing to the typings, e.g. `'Code128'`/`'DataMatrix'` per `BarcodeFormat` strings used by `readBarcodes` results.)

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
./node_modules/.bin/vitest run pages/api/my/stores/serials/__tests__/_extractCore.test.ts
```

- [ ] **Step 3: Implement `_extractCore.ts`**

```typescript
/**
 * Serial-extraction pipeline for POST /api/my/stores/serials/extract.
 *
 * Order: (1) zxing-wasm barcode decode on the ORIGINAL-resolution image
 * (density matters for dense Code128 — resizing first destroys it), then
 * (2) one Qwen3-VL call on a 1024x768 resize. Both produce a candidate that
 * must pass validateSerialCandidate before it reaches the client.
 *
 * Known serial families (stores stock, 2026-06):
 *   ont    ALCLB4 + 6 hex chars (12 total)          — Nokia GPON ONT
 *   gizzu  GU18W12V25 + 8 digits (18 total)         — Gizzu UPS
 *   generic fallback: 6-24 chars A-Z 0-9 '-' (VLM path gets lower confidence)
 */

import { extractScannedSerial } from '@/modules/field-stock-pwa/lib/scannedSerial';
import {
  VLM_CHAT_ENDPOINT,
  VLM_EXTRACTION_MODEL,
  VLM_MAX_TOKENS_OCR,
  VLM_TEMPERATURE,
  VLM_TIMEOUT_REALTIME,
} from '@/lib/vlm';
import { log } from '@/lib/logger';

export type SerialFamily = 'ont' | 'gizzu' | 'generic';

const ONT_RE = /^ALCLB4[0-9A-F]{6}$/;
const GIZZU_RE = /^GU18W12V25\d{8}$/;
const GENERIC_RE = /^[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]$/;
/** Serials that appear as examples in VLM prompts — hallucination guard. */
const PROMPT_EXAMPLE_SERIALS = new Set(['ALCLB4923FA8', 'GU18W12V2512041619']);
/** SSID/MAC/part-number prefixes that are NOT serials. */
const REJECT_PREFIXES = ['ALHN', 'STN', '3TN'];

export function validateSerialCandidate(
  raw: string,
): { serial: string; family: SerialFamily } | null {
  const serial = raw.trim().toUpperCase();
  if (!serial || PROMPT_EXAMPLE_SERIALS.has(serial)) return null;
  if (REJECT_PREFIXES.some((p) => serial.startsWith(p))) return null;
  if (ONT_RE.test(serial)) return { serial, family: 'ont' };
  if (GIZZU_RE.test(serial)) return { serial, family: 'gizzu' };
  if (GENERIC_RE.test(serial)) return { serial, family: 'generic' };
  return null;
}

/** zxing-wasm decode → ISO 15434 unwrap → validated serial, or null. */
export async function decodeSerialFromImage(buffer: Buffer): Promise<string | null> {
  try {
    const { readBarcodes } = await import('zxing-wasm/full');
    const results = await readBarcodes(new Blob([new Uint8Array(buffer)]), {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });
    for (const r of results) {
      const unwrapped = extractScannedSerial(r.text).toUpperCase();
      if (validateSerialCandidate(unwrapped)) return unwrapped;
    }
    return null;
  } catch (err) {
    log.warn('serial extract: zxing decode failed', { err }, 'my/stores/serials/extract');
    return null;
  }
}

export const STORES_SERIAL_PROMPT = `You are reading an equipment label photo from a fibre-network warehouse.
Find the SERIAL NUMBER on the label. Known formats:
- Nokia ONT: starts "ALCLB4", exactly 12 characters (letters/digits), printed after "S/N:".
- Gizzu UPS: starts "GU18W12V25", exactly 18 characters, printed under a 1D barcode.
- Otherwise: the value labelled "S/N", "Serial", or "SN".
NOT serials: SSID (starts ALHN), part numbers (start STN or 3TN), MAC addresses (colon-separated hex), model numbers, batch codes.
Reply with ONLY JSON: {"serial": "<value or null>", "confidence": <0..1>}
If no serial is clearly readable, reply {"serial": null, "confidence": 0}.`;

export function parseVlmSerialResponse(
  content: string,
): { serial: string | null; confidence: number } | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { serial?: unknown; confidence?: unknown };
    return {
      serial: typeof parsed.serial === 'string' ? parsed.serial : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch {
    return null;
  }
}

/** One VLM call on a pre-resized JPEG buffer. Returns a VALIDATED serial or null. */
export async function extractSerialWithVlm(
  resizedJpeg: Buffer,
): Promise<{ serial: string; family: SerialFamily; confidence: number } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: STORES_SERIAL_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${resizedJpeg.toString('base64')}` } },
          ],
        }],
        max_tokens: VLM_MAX_TOKENS_OCR,
        temperature: VLM_TEMPERATURE,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`VLM ${response.status}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseVlmSerialResponse(content);
    if (!parsed?.serial) return null;
    const valid = validateSerialCandidate(parsed.serial);
    if (!valid) return null;
    // Generic-family values from the VLM are the most hallucination-prone.
    const confidence = valid.family === 'generic'
      ? Math.min(parsed.confidence, 0.5)
      : parsed.confidence;
    return { ...valid, confidence };
  } catch (err) {
    log.warn('serial extract: VLM call failed', { err }, 'my/stores/serials/extract');
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Check the exact export names exist in `@/lib/vlm` (`src/lib/vlm/index.ts`); import from `@/lib/vlm/config` directly if the barrel omits any.

NOTE: `PROMPT_EXAMPLE_SERIALS` includes `GU18W12V2512041619` because the diagnosis photo's serial is in this plan and may leak into future prompt examples — and a unit physically photographed for docs should not be hand-issuable via VLM anyway (it can still be scanned/typed). Keep the prompt itself example-free so the guard list stays at known doc examples.

- [ ] **Step 4: Run tests — expect PASS** (the writer/decoder round-trip proves the pipeline). **Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add pages/api/my/stores/serials/_extractCore.ts pages/api/my/stores/serials/__tests__/ && \
git commit -m "feat(stores-pwa): serial extraction core (zxing decode + VLM + validation)"
```

---

### Task B2: Extract endpoint

**Files:**
- Create: `pages/api/my/stores/serials/extract.ts`

(Static routes win over `[serialNumber].ts` in Pages Router, so `/extract` is safe alongside the dynamic route.)

- [ ] **Step 1: Implement**

```typescript
/**
 * POST /api/my/stores/serials/extract — photo→serial fallback for the
 * stores issue flow. Multipart field "photo".
 *
 * Pipeline (see _extractCore.ts): zxing-wasm on the original image →
 * Qwen3-VL on a 1024x768 resize → validated candidate. The photo is stored
 * to VF Storage stores/serial-scans/ regardless of outcome so failed
 * extractions stay diagnosable and become VLM training material.
 *
 * Response: { serial, family, method: 'barcode'|'vlm'|'none', confidence,
 *             photoUrl }
 * The client PRE-FILLS the manual entry field — the user always confirms
 * before the serial enters the validateSerial funnel.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import formidable from 'formidable';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { vfStorage } from '@/services/vfStorageAdapter';
import { decodeSerialFromImage, extractSerialWithVlm, validateSerialCandidate } from './_extractCore';

export const config = { api: { bodyParser: false } };

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function parseMultipart(req: NextApiRequest): Promise<{ files: formidable.Files }> {
  const form = formidable({ multiples: false, maxFileSize: MAX_FILE_BYTES, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => (err ? reject(err) : resolve({ files })));
  });
}

function pickFirst<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  let parsed: { files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('serial extract: multipart parse failed', { err }, 'my/stores/serials/extract');
    return apiResponse.badRequest(res, 'Could not read upload — file too large or malformed.');
  }
  const file = pickFirst(parsed.files.photo) as formidable.File | undefined;
  if (!file) return apiResponse.badRequest(res, 'Photo is required (form field "photo").');
  const mime = file.mimetype || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) return apiResponse.badRequest(res, `Unsupported file type: ${mime}`);

  let original: Buffer;
  try {
    original = await fs.readFile(file.filepath);
  } finally {
    fs.unlink(file.filepath).catch(() => undefined);
  }

  // Store the photo first (evidence + training data), best-effort.
  let photoUrl: string | null = null;
  try {
    const filename = `${actor.staffId}__${crypto.randomUUID()}.jpg`;
    const uploaded = await vfStorage.uploadFile(original, 'stores', 'serial-scans', filename);
    photoUrl = uploaded.url;
  } catch (err) {
    log.warn('serial extract: photo storage failed (continuing)', { err }, 'my/stores/serials/extract');
  }

  try {
    // 1. Barcode pass on the ORIGINAL image.
    const decoded = await decodeSerialFromImage(original);
    if (decoded) {
      const valid = validateSerialCandidate(decoded);
      log.info('serial extract: barcode hit', { family: valid?.family }, 'my/stores/serials/extract');
      return apiResponse.success(res, {
        serial: decoded, family: valid?.family ?? 'generic',
        method: 'barcode', confidence: 1, photoUrl,
      });
    }

    // 2. VLM pass on a 1024x768 resize.
    const resized = await sharp(original)
      .rotate() // honour EXIF orientation
      .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const vlm = await extractSerialWithVlm(resized);
    if (vlm) {
      log.info('serial extract: VLM hit', { family: vlm.family, confidence: vlm.confidence }, 'my/stores/serials/extract');
      return apiResponse.success(res, { ...vlm, method: 'vlm', photoUrl });
    }

    log.info('serial extract: no serial found', { staffId: actor.staffId }, 'my/stores/serials/extract');
    return apiResponse.success(res, { serial: null, family: null, method: 'none', confidence: 0, photoUrl });
  } catch (err) {
    log.error('serial extract failed', { err }, 'my/stores/serials/extract');
    return apiResponse.internalError(res, err);
  }
});
```

- [ ] **Step 2: tsc + a smoke decode against the REAL Gizzu photo** (proves the endpoint's pipeline pieces in node):

```bash
cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && ./node_modules/.bin/tsc --noEmit 2>&1 | head
node -e "
(async () => {
  const fs = require('fs');
  const { readBarcodes } = await import('zxing-wasm/full');
  const buf = fs.readFileSync('/home/hein/Downloads/WhatsApp Image 2026-06-11 at 09.29.18 (1).jpeg');
  const r = await readBarcodes(new Blob([buf]), { tryHarder: true, tryRotate: true, tryInvert: true });
  console.log(r.map(x => x.format + ':' + x.text));
})();"
```

Expected: `[ 'Code128:GU18W12V2512041619' ]`.

- [ ] **Step 3: Commit**

```bash
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add pages/api/my/stores/serials/extract.ts && \
git commit -m "feat(stores-pwa): photo->serial extract endpoint (barcode-first, VLM fallback)"
```

---

### Task B3: Client — extract API helper + "Take a photo instead" in ScanSerialsStep

**Files:**
- Modify: `src/modules/field-stock-pwa/api/serials.ts` (add `extractSerialFromPhoto`)
- Modify: `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`

- [ ] **Step 1: API helper** (in `api/serials.ts`, following `uploadIssueProof`'s fetch-multipart pattern from PR A):

```typescript
export interface SerialExtractResult {
  serial: string | null;
  family: 'ont' | 'gizzu' | 'generic' | null;
  method: 'barcode' | 'vlm' | 'none';
  confidence: number;
  photoUrl: string | null;
}

/**
 * Photo→serial fallback: POST the captured still to the extract endpoint.
 * Compress to 1920px max (NOT the receipts 1280 default — barcode density
 * must survive for the server-side zxing pass).
 */
export async function extractSerialFromPhoto(photo: Blob): Promise<SerialExtractResult> {
  const form = new FormData();
  form.append('photo', photo, 'serial.jpg');
  const res = await fetch('/api/my/stores/serials/extract', { method: 'POST', body: form });
  const json = (await res.json()) as {
    success: boolean; data?: SerialExtractResult; error?: { message?: string };
  };
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error?.message ?? `Extraction failed (${res.status})`);
  }
  return json.data;
}
```

- [ ] **Step 2: ScanSerialsStep UI**

Add state + handler (compression at 1920):

```tsx
const [extracting, setExtracting] = useState(false);
const [extractError, setExtractError] = useState<string | null>(null);

const handlePhotoFallback = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  setExtracting(true);
  setExtractError(null);
  try {
    const compressed = await compressFileToJpeg(file, { maxDim: 1920, quality: 0.9 });
    const result = await extractSerialFromPhoto(compressed);
    if (result.serial) {
      // PRE-FILL ONLY — the user confirms before it enters validation.
      setManualOpen(true);
      setManualInput(result.serial);
    } else {
      setExtractError("Couldn't read the label — type the serial below.");
      setManualOpen(true);
    }
  } catch {
    setExtractError('Photo upload failed — check your signal and try again, or type the serial.');
    setManualOpen(true);
  } finally {
    setExtracting(false);
  }
}, []);
```

Render between the scanner block and the manual disclosure — a label-wrapped hidden input mirroring the proof capture (live camera only):

```tsx
<label className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm font-medium cursor-pointer hover:bg-neutral-800">
  {extracting
    ? (<><Loader2 className="w-4 h-4 animate-spin" /> Reading label…</>)
    : (<><ImageIcon className="w-4 h-4" /> Take a photo instead</>)}
  <input type="file" accept="image/*" capture="environment" className="hidden"
    onChange={handlePhotoFallback} disabled={extracting} />
</label>
{extractError && <p className="text-xs text-amber-400">{extractError}</p>}
```

Imports: `Image as ImageIcon` from lucide-react, `compressFileToJpeg`, `extractSerialFromPhoto`. Keep the component under 200 lines — if it tips over, extract the fallback block into `PhotoSerialFallback.tsx` with props `{ onSerial: (s: string) => void; onNoSerial: () => void }` and have ScanSerialsStep do the manual-field prefill in those callbacks.

- [ ] **Step 3: module tests + tsc, commit**

```bash
./node_modules/.bin/vitest run src/modules/field-stock-pwa && ./node_modules/.bin/tsc --noEmit 2>&1 | head
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add -u src/modules/field-stock-pwa && git add src/modules/field-stock-pwa/components/PhotoSerialFallback.tsx 2>/dev/null; \
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git commit -m "feat(stores-pwa): photo->serial fallback pre-fills manual entry"
```

---

### Task B4: Scanner tuning for dense 1D (Gizzu)

**Files:**
- Modify: `src/modules/barcode-scanner/types/scanner.ts`
- Modify: `src/modules/barcode-scanner/hooks/useBarcodeScanner.ts`
- Modify: `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`

- [ ] **Step 1: Extend ScannerConfig** (`types/scanner.ts`):

```typescript
  /** Delegate to the native BarcodeDetector when the browser has one
   *  (Android Chrome) — much stronger on dense 1D than the JS decoder. */
  useBarCodeDetectorIfSupported?: boolean;
  /** Camera resolution request, e.g. { width: { ideal: 1920 } }. */
  videoConstraints?: MediaTrackConstraints;
```

- [ ] **Step 2: Wire through in `useBarcodeScanner.ts`:**

1. Constructor (line ~140): pass `useBarCodeDetectorIfSupported` —
   ```typescript
   scannerRef.current = new Html5Qrcode(elementId, {
     verbose: config.verbose,
     formatsToSupport: getSupportedFormats({ Html5Qrcode, Html5QrcodeSupportedFormats }),
     useBarCodeDetectorIfSupported: config.useBarCodeDetectorIfSupported ?? false,
   });
   ```
   and add `useBarCodeDetectorIfSupported?: boolean` to the local `Html5QrcodeModule` constructor-config interface (line 52).
2. `start()` second argument: add `videoConstraints` when configured —
   ```typescript
   {
     fps: config.fps ?? 10,
     qrbox: typeof qrboxSize === 'number' ? qrboxSize : qrboxSize,
     aspectRatio: config.aspectRatio ?? 1.0,
     ...(config.videoConstraints ? { videoConstraints: config.videoConstraints } : {}),
   }
   ```
   and extend the local `Html5QrcodeInstance.start` config parameter type with `videoConstraints?: MediaTrackConstraints`.
   (Both options exist in html5-qrcode 2.3.8 typings — `esm/html5-qrcode.d.ts:7` and `:18`. When `videoConstraints` is provided html5-qrcode uses it INSTEAD of the first-arg `{ facingMode }`, so always include `facingMode` inside it.)

- [ ] **Step 3: ScanSerialsStep config + hint:**

```typescript
  const { state: scannerState, start, stop, error: scannerError } = useBarcodeScanner({
    elementId: SCANNER_ELEMENT_ID,
    config: {
      formatsToSupport: ['DATA_MATRIX', 'QR_CODE', 'CODE_128', 'CODE_39', 'EAN_13', 'EAN_8'],
      // Dense Code128 (Gizzu 18-char serial on a ~3cm sticker) needs the
      // native detector + hi-res frames + a wide 1D-shaped scan box.
      useBarCodeDetectorIfSupported: true,
      qrboxSize: { width: 300, height: 140 },
      videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    },
    onScan: (result) => { handleRawSerial(result.decodedText); },
  });
```

Inside the scanner viewport (under the `#serial-scanner-reader` div):

```tsx
<p className="px-3 py-1.5 text-[11px] text-neutral-500 text-center">
  Hold barcodes horizontal and fill the box — or use “Take a photo instead”.
</p>
```

- [ ] **Step 4: tsc + existing tests, commit**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | head && ./node_modules/.bin/vitest run src/modules/barcode-scanner src/modules/field-stock-pwa
cd /tmp && cd /home/hein/Workspace/FF_Next.js-stores-pwa-scan && \
git add src/modules/barcode-scanner src/modules/field-stock-pwa/components/ScanSerialsStep.tsx && \
git commit -m "fix(stores-pwa): scanner tuning for dense Code128 (native detector, rect box, hi-res)"
```

---

### Task B5: Verification on dev + PR B

- [ ] **Step 1:** `npm run ci:quick` — 0 errors.
- [ ] **Step 2:** Local dev (`PORT=3004 npm run dev`) browser check:
  - Issue flow → serial item → scanner opens with the wide scan box + hint.
  - "Take a photo instead" → upload the saved Gizzu photo (`/home/hein/Downloads/WhatsApp Image 2026-06-11 at 09.29.18 (1).jpeg` via the file input without `capture` on desktop) → manual field pre-fills `GU18W12V2512041619` → Add → validates green (`in_stock` FT-GIZZU)… **note** the picked item must be FT-GIZZU or the cross-item guard correctly rejects it — pick FT-GIZZU in the flow for this check.
  - Check VF Storage: the photo landed under `stores/serial-scans/`.
  - VLM path: photo of the serial TEXT only (crop the barcode out) → VLM returns the serial → prefill works. If the VLM box is down, `method:'none'` degrade path shows the type-it message.
- [ ] **Step 3:** Physical-device check (Hein/storeman): live-scan a real Gizzu label on Android Chrome. Record outcome in the PR — if live scan still fails in the field, the photo fallback is the accepted path (spec).
- [ ] **Step 4:** Push branch, open PR B, blind `/review`, CI, merge per the standing rule. After both PRs merge: deploy dev (`bash scripts/deploy-local.sh dev`), re-verify on `dev.fibreflow.app`, then prod after-hours with Hein's approval.

---

## Self-review (done at planning time)

- **Spec coverage:** F1 → B1-B3; F2 → A1-A10 (incl. lot+quantity+none routing, required photo, migration, server enforcement, backend-path verification); F3 → B4 + B5 step 3. Out-of-scope items untouched. Offline decision recorded in spec amendment + A8.
- **Placeholders:** none — every code step has full code; the two "check X first" notes (vfStorage export name, zxing writer option casing, ApiError ctor) are verification instructions with the file to read, not deferred design.
- **Type consistency:** `StockItem` (PickItemStep) carries `trackingType`/`uom` end-to-end; `PwaIssueDraft.quantity/proofPhotoKey/proofPhotoUrl` line up between types.ts, SignAndSubmitStep, submitIssue, and `_create.ts`'s destructure; `EnterQuantityStepProps` matches the orchestrator call site; `uploadIssueProof`/`extractSerialFromPhoto` return shapes match their endpoint responses.
