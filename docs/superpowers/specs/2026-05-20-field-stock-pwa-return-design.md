# Field-Stock PWA — Phase 3: Return Flow + Warehouse Inspect

**Date:** 2026-05-20
**Author:** Claude (with Hein)
**Status:** Spec — awaiting approval before plan
**Builds on:** Phase 2 (PR #1669), `src/modules/field-stock-pwa/`

## Context

Phase 2 shipped a 5-step Issue flow that lets a storeman issue stock from a warehouse to a technician via `/my/stores/issue` on the staff portal. Phase 3 adds the inverse: technicians return unused stock from the field, and storemen inspect what came back and dispose of it as `available`, `damaged`, or `scrapped`.

Both flows live in the same module (`src/modules/field-stock-pwa/`) and share the same role gating, signature capture, scan flow, and offline queue patterns.

## Scope (decided during brainstorming)

| Decision | Choice |
|---|---|
| Flows included | **Both** — technician create *and* warehouse inspect |
| Inspect location | `/my/stores/inspect` and `/my/stores/inspect/[id]` (same mobile portal) |
| Destination warehouse for the return | **Locked** — auto-derived from the source warehouse of the serial's most recent issue picking |
| Reason captured at create | **One overall reason** for the batch (radio + Other text); per-serial disposition happens at inspect |
| Mixed-source returns | **Blocked** — first scanned serial locks the source warehouse; subsequent scans from a different source are rejected |
| Offline support | **Yes** — mirror Phase 2's `queueIssue` pattern with a separate `pending-returns` IndexedDB store |

## Out of scope (deferred)

- Stores Today / reconciliation dashboard (Phase 4)
- Return-to-PO reversal
- Damage-repair workflow (Phase 3 just stamps `damaged` + parks the serial in a virtual `REPAIR-QUEUE` location; the actual repair work is later)
- Contractor accountability impact (the existing aggregation should pick `type='return'` pickings up automatically — verify in Phase 4)

---

## Architecture

```
TECH RETURN FLOW (mobile, /my portal, technician/storeman/admin/super_admin)
  /my/stores/return        ReturnOrchestrator
    Step 1: PickReturnReasonStep
    Step 2: ScanMyStockStep        (enforces locked source)
    Step 3: ReturnSignSubmitStep   (signature + submit; no value cap)
  Submit → POST /api/procurement/field-stock/returns
         → creates picking type='return', status='draft'
         → source = tech's possession (FIELD-DEFAULT)
         → destination = serial's original source warehouse (locked)

WAREHOUSE INSPECT FLOW (mobile, /my portal, stores/admin/super_admin only)
  /my/stores/inspect           list of pending (status='draft') return pickings
  /my/stores/inspect/[id]      InspectOrchestrator
    Per-serial radio: Good / Damaged / Faulty
    Optional per-serial notes
    SignaturePad + submit
  Submit → POST /api/procurement/field-stock/returns-inspect?id=<picking_id>
         → updates stock_serials.status per disposition
         → updates stock_quants.location_id per disposition
         → updates picking status='done'
```

### Reused from Phase 2 (unchanged)

- `SignaturePad`
- `StepProgress`
- `useStoresSession`
- `storesRoles.ts` — extended with `isReturnCreator` + `isReturnInspector`
- `AbandonedIssuesBanner` *pattern* (clone to `AbandonedReturnsBanner`)
- `queueIssue` *pattern* (clone to `queueReturn`)
- `useStockSync` (extend to drain `pending-returns` alongside `pending-issues`)

### New components

```
src/modules/field-stock-pwa/components/
  ReturnOrchestrator.tsx          step machine, mirrors IssueOrchestrator
  PickReturnReasonStep.tsx        radio (End of job / Extra stock / Job cancelled
                                  / Wrong item / Damaged in field / Other+text)
  ScanMyStockStep.tsx             adapts ScanSerialsStep; calls /my-serials;
                                  enforces locked source warehouse
  ReturnSignSubmitStep.tsx        adapts SignAndSubmitStep, no R5k value cap
  AbandonedReturnsBanner.tsx      clone of AbandonedIssuesBanner
  InspectOrchestrator.tsx         single-screen disposition + signature + submit
  SerialDispositionRow.tsx        one row: serial + 3-way radio + notes
```

### New backend

```
pages/api/procurement/field-stock/
  returns.ts                      POST create, GET list (scoped)
  returns-inspect.ts              POST disposition (flattened — ?id=<picking_id>)
  my-serials.ts                   GET serials currently allocated to req.user's staff

src/modules/field-stock-pwa/api/
  returns.ts                      handler logic for the page route above
  returns-inspect.ts              handler logic for inspect
  my-serials.ts                   handler logic for /my-serials
```

Per CLAUDE.md: flattened dynamic routes (`returns-inspect.ts?id=...`) instead of nested `[id]/inspect.ts`.

### New offline support

```
src/modules/field-stock-pwa/offline/
  queueReturn.ts                  clone of queueIssue.ts, key 'pending-returns'
  __tests__/queueReturn.test.ts
```

`useStockSync` will drain `pending-returns` alongside `pending-issues`.

### Migration 358

```
scripts/migrations/sql/358_field_stock_return_dispositions.sql
```

- Add `'damaged'`, `'scrapped'` to `stock_serials.status` CHECK constraint **if not already present** (verify before writing the migration; existing schema may already include them).
- Insert two virtual locations:
  - `REPAIR-QUEUE` (UUID `00000000-0000-0000-0000-000000000002`), `is_virtual=true`, `location_type='transit'`
  - `SCRAPPED` (UUID `00000000-0000-0000-0000-000000000003`), `is_virtual=true`, `location_type='transit'`
- Add a GIN index on `stock_picking_lines.serial_ids` **if not already present** (verify first).

All inserts/index creation idempotent (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`).

---

## Data flow & state machine

### Picking lifecycle for type='return'

```
draft   ← tech submits (direct or via offline queue drain)
done    ← storeman submits inspect with per-serial disposition
```

No intermediate `received` state for Phase 3 — keeps the model simple. If audit needs "acknowledged at X, dispositioned at Y" later, add a column or an intermediate state in Phase 4.

### Per-disposition outcomes (applied in one transaction on inspect submit)

| Disposition | `stock_serials.status` | `stock_quants.location_id` |
|---|---|---|
| Good | `available` | original source warehouse |
| Damaged | `damaged` | `REPAIR-QUEUE` virtual location |
| Faulty | `scrapped` | `SCRAPPED` virtual location |

Mixed dispositions in one submit are allowed — all applied atomically.

### Mixed-source guard (create flow)

State in `ScanMyStockStep`:

```ts
lockedSourceWarehouseId: UUID | null
```

- First valid scan: server returns the serial's `source_warehouse_id` (from latest issue picking) → set lock.
- Subsequent scans: if `serial.source_warehouse_id !== lockedSourceWarehouseId`, reject inline with the message: *"This serial was issued from {sourceName}. Finish your {lockedName} return first or start a new one."*

### Offline queue

- IndexedDB store `pending-returns`, keyed by client-generated UUID.
- Wizard writes to queue on submit; `useStockSync` drains in the background.
- `AbandonedReturnsBanner` on `/my/stores` lists drafts where the wizard was abandoned mid-flow (distinct from the sync queue — same distinction as Phase 2's `AbandonedIssuesBanner` vs `pending-issues`).

### Idempotency

- Client generates a UUID per submission; sent as `idempotency_key` in the POST body.
- API upserts on `idempotency_key` (column added by migration 358 if it's not already on `stock_pickings`; verify schema first).

---

## Edge cases & error handling

| Case | Behaviour |
|---|---|
| Tech scans a serial they don't possess | API 403; UI: *"This serial isn't in your stock."* No leak about who owns it. |
| Tech scans a consumed serial | API 409; UI: *"This serial was marked installed on DR-XXXXX. Contact your manager to reverse."* |
| Tech scans from a different source than first | Reject inline with locked-source error message above. |
| Tech submits empty serial list | Submit button disabled until ≥1 serial. |
| Tech goes offline mid-wizard | Wizard continues; submit writes to IndexedDB; sync drains on reconnect. |
| Double-tap submit | UUID idempotency key dedupes server-side. |
| Storeman opens an already-dispositioned return | List filters to `status='draft'`. Direct nav to `[id]` of `done` picking → read-only summary view. |
| Damaged disposition without notes | Notes optional; show soft prompt *"Add a note?"* but don't block submit. |
| Concurrent inspect on same return | Optimistic concurrency on `updated_at`; stale POST rejected with 409. |

### Logging

Every API entry/exit uses `log` from `@/lib/logger`. No `console.log`. Examples:

```ts
log.info('returns.create', { staffId, serialCount, sourceWarehouseId });
log.warn('returns.create.mixed_source', { staffId, lockedSource, scannedSource });
log.error('returns.inspect.failed', { error, pickingId, staffId });
```

### Auth

| Endpoint | Guard |
|---|---|
| `POST /returns` | `withAuth` + `isReturnCreator(profile.role, profile.authRole)` |
| `GET /returns` | `withAuth`; if creator-only role, scope to own staff_id |
| `POST /returns-inspect` | `withAuth` + `isReturnInspector(profile.role, profile.authRole)` |
| `GET /my-serials` | `withAuth`; always scoped to req.user's linked staff_id |

```ts
// storesRoles.ts (extension)
const RETURN_CREATOR_ROLES = ['technician', 'stores', 'admin', 'super_admin'];
const RETURN_INSPECTOR_ROLES = ['stores', 'admin', 'super_admin']; // no technician
export function isReturnCreator(role, authRole) { ... }
export function isReturnInspector(role, authRole) { ... }
```

---

## Testing

| Layer | What | Where |
|---|---|---|
| Unit | `serialSourceLookup`, `returnReasons`, `queueReturn`, `storesRoles` extension | co-located `__tests__/` |
| Integration | POST returns happy path, mixed-source rejection, GET my-serials scoping, inspect dispositions atomicity, idempotency dedupe | `tests/api/procurement/field-stock/returns-flow-integration.test.ts` |
| Browser smoke | End-to-end on dev via Playwriter MCP — mirror the Phase 2 smoke test that caught 5 real bugs | Run before merge; not in CI |

Phase 2 lesson: unit tests with mocked `sql` missed all five real bugs. The browser smoke test is the load-bearing verification step; do not skip it.

---

## Reference data

### Return reasons (from `returnReasons.ts`)

```ts
export const RETURN_REASONS = [
  { code: 'end_of_job',       label: 'End of job — unused stock' },
  { code: 'extra_stock',      label: 'Extra stock — over-issued' },
  { code: 'job_cancelled',    label: 'Job cancelled' },
  { code: 'wrong_item',       label: 'Wrong item issued' },
  { code: 'damaged_in_field', label: 'Damaged in field' },
  { code: 'other',            label: 'Other (please specify)' },
] as const;
```

`other` requires a non-empty `reason_text` (validated client + server).

### Virtual locations introduced by migration 358

| UUID | Code | Type | Purpose |
|---|---|---|---|
| `00000000-0000-0000-0000-000000000002` | `REPAIR-QUEUE` | transit | Holds serials marked `damaged` pending repair workflow (Phase 4+) |
| `00000000-0000-0000-0000-000000000003` | `SCRAPPED` | transit | Holds serials marked `scrapped` (faulty, write-off) |

(Phase 2 introduced `00000000-0000-0000-0000-000000000001` = `FIELD-DEFAULT`.)

---

## Success criteria

1. Migration 358 applied to dev DB; virtual locations and status values exist.
2. A technician can complete a return wizard end-to-end on `dev.fibreflow.app`, with signature captured and a `PCK-XXXXXX` returned.
3. A storeman can open `/my/stores/inspect`, see the pending return, disposition each serial Good/Damaged/Faulty (with optional notes), submit, and verify `stock_serials.status` + `stock_quants.location_id` reflect the choices.
4. A mixed-source attempt is blocked with the right error message.
5. Offline submission queues and drains on reconnect; the same return is not duplicated.
6. Role gating: a technician sees only the return tile (no inspect); a storeman sees both.
7. `npm run ci:quick` passes; no lint ratchet regressions (77 errors / ~1833 warnings / 94 catches floor).
8. Blind review-team approves the bundled PR.
9. Browser smoke test on dev passes (Playwriter MCP).
10. No `console.log`, no empty catches, files <300 lines, components <200 lines.

---

## Open verification items (must check before writing the migration)

1. Does `stock_serials.status` CHECK currently include `damaged` and `scrapped`? Migration text depends on the answer.
2. Does `stock_pickings` already have an `idempotency_key` column? If yes, reuse; if no, add it in 358.
3. Is there already a GIN index on `stock_picking_lines.serial_ids`? If yes, skip; if no, add it in 358.
4. Confirm `stock_pickings.type` enum/CHECK accepts `'return'` (Phase 2's Issue flow used `'internal_transfer'` — verify the return type is allowed before relying on it).

These are answered during the first task of implementation, not now.

---

## Resume / next step

Once approved by Hein, invoke the `superpowers:writing-plans` skill to produce the task-level implementation plan. The plan should follow the Phase 2 three-role pattern: implementer → blind reviewer → evaluator, parallelised across the file groups above.
