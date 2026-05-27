# Field-Stock PWA — Phase 3: Return Flow + Warehouse Inspect

**Date:** 2026-05-20
**Author:** Claude (with Hein)
**Status:** Spec — revised after schema discovery; awaiting approval before plan
**Builds on:** Phase 2 (PR #1669), `src/modules/field-stock-pwa/`

## Revision history

- **v1 (2026-05-20)** — original spec assumed `stock_pickings` with `type='return'` and a new migration 359 for virtual REPAIR-QUEUE/SCRAPPED locations.
- **v2 (2026-05-20)** — discovered existing `stock_returns` + `stock_return_lines` tables (migration 029) and three existing endpoints (`POST /returns`, `POST /returns/[id]/inspect`, `POST /returns/[id]/accept`). Spec rewritten to build on top of the existing backend rather than create a parallel one. Migration dropped; vocabulary aligned to existing CHECK constraints; disposition flow is two-call (inspect then accept).

## Context

Phase 2 shipped a 5-step Issue flow at `/my/stores/issue` that creates a `stock_picking` (type='issue', status='draft') with serial allocations. Phase 3 adds the inverse — technicians return unused stock from the field, and storemen disposition + restock what came back.

The backend already exists from PRD-027 work (migration `029_field_stock_returns.sql`):

- `stock_returns` table — return header with status workflow pending → received → inspected → accepted → rejected → restocked
- `stock_return_lines` table — per-item condition, return_reason, disposition
- `POST /api/procurement/field-stock/returns` — creates with `status='pending'`
- `POST /api/procurement/field-stock/returns/[returnId]/inspect` — sets `status='inspected'`, applies per-line `condition` + `disposition` + `notes`
- `POST /api/procurement/field-stock/returns/[returnId]/accept` — sets `status='restocked'`, updates `stock_serials.status` (available/scrapped/faulty), `stock_quants`, records `stock_movements`

Phase 3 wraps this backend in PWA UI on the `/my` staff portal and hardens the endpoints (role gating, input validation, audit context).

## Scope (decided during brainstorming)

| Decision | Choice |
|---|---|
| Flows included | **Both** — technician create *and* warehouse inspect |
| Inspect location | `/my/stores/inspect` and `/my/stores/inspect/[id]` (same mobile portal) |
| Destination warehouse for the return | **Locked** — auto-derived from the source warehouse of the serial's most recent `stock_pickings` row where it was issued |
| Reason captured at create | **One overall reason** for the batch (radio + Other text); per-serial `condition` + `disposition` happens at inspect |
| Mixed-source returns | **Blocked** — first scanned serial locks the source warehouse; subsequent scans from a different source are rejected |
| Offline support | **Yes** — mirror Phase 2's `queueIssue` pattern with a separate `pending-returns` IndexedDB store |
| Inspect → accept | **Two server calls from one client action** — PWA inspect screen POSTs `/inspect` then `/accept` in sequence; the existing `accept` endpoint enforces `status='inspected'`. If accept fails after inspect succeeds, the return is left in `inspected` state and the next storeman can retry accept. |

## Out of scope (deferred to Phase 4+)

- Stores Today / reconciliation dashboard
- Return rejection workflow (status='rejected')
- `received` intermediate state (skip — go pending → inspected → restocked)
- `supplier_return` disposition (existing CHECK allows it but Phase 3 UI does not surface it)
- Damage-repair workflow beyond setting serial status='faulty'
- Contractor accountability roll-up (existing trigger handles issues; equivalent for returns is out of scope here)

---

## Architecture

```
TECH RETURN FLOW (mobile, /my portal, technician/storeman/admin/super_admin)
  /my/stores/return        ReturnOrchestrator
    Step 1: PickReturnReasonStep
    Step 2: ScanMyStockStep        (enforces locked source)
    Step 3: ReturnSignSubmitStep   (signature + submit; no value cap)
  Submit → POST /api/procurement/field-stock/returns
         → creates stock_returns row, status='pending'
         → returned_by_id = tech's staff.id
         → return_to_location_id = source warehouse derived from latest issue picking
         → notes = signature data URL + UI reason label (or store signature
           separately if we add a column; Phase 3 stores it in notes JSON)

WAREHOUSE INSPECT FLOW (mobile, /my portal, stores/admin/super_admin only)
  /my/stores/inspect           list pending stock_returns
                               (status='pending'), grouped by tech
  /my/stores/inspect/[id]      InspectOrchestrator
    Per-line radio: condition (good/damaged/non_functional)
    Per-line radio: disposition (restock/repair/scrap)
    Per-line optional notes
    SignaturePad + submit
  Submit → POST /api/procurement/field-stock/returns/[id]/inspect
         → sets status='inspected', applies lineDispositions
         → THEN immediately
         → POST /api/procurement/field-stock/returns/[id]/accept
         → sets status='restocked'
         → updates stock_serials.status per disposition
         → updates stock_quants for restocked items
         → records stock_movements
```

### Reused from Phase 2 (unchanged)

- `SignaturePad`
- `StepProgress`
- `useStoresSession`
- `storesRoles.ts` — extended with `isReturnCreator` + `isReturnInspector`
- `AbandonedIssuesBanner` *pattern* (clone to `AbandonedReturnsBanner`)
- `queueIssue` *pattern* (clone to `queueReturn`)
- `useStockSync` (extend to also drain `pending-returns`)

### New components

```
src/modules/field-stock-pwa/components/
  ReturnOrchestrator.tsx          step machine, mirrors IssueOrchestrator (~180 lines)
  PickReturnReasonStep.tsx        radio over return_reason CHECK values (~100 lines)
  ScanMyStockStep.tsx             adapts ScanSerialsStep; calls /my-serials;
                                  enforces locked source warehouse (~180 lines)
  ReturnSignSubmitStep.tsx        adapts SignAndSubmitStep, no R5k value cap (~150 lines)
  AbandonedReturnsBanner.tsx      clone of AbandonedIssuesBanner (~80 lines)
  InspectListPage.tsx             list of pending returns (rendered by /inspect/index) (~120 lines)
  InspectOrchestrator.tsx         single-screen disposition + signature + submit (~180 lines)
  SerialDispositionRow.tsx        one row: serial + condition radio + disposition radio
                                  + optional notes (~80 lines)
```

### New backend

#### New endpoints

```
pages/api/procurement/field-stock/
  my-serials.ts                   GET — serials currently allocated to req.user's staff
  serial-source.ts                GET ?serialNumber=XYZ — returns the source warehouse
                                  of the latest issue picking that touched this serial
```

Per CLAUDE.md "flatten nested dynamic routes" — these are flat. The existing `/returns/[returnId]/inspect.ts` and `.../accept.ts` are nested but already shipped; we leave them alone and only add the flat new routes.

#### Existing endpoints — hardening (modifications, not rewrites)

```
pages/api/procurement/field-stock/returns/index.ts
  - Add role gate: isReturnCreator on POST, broader read on GET
  - Validate request body shape with a tighter schema (lines.condition CHECK match,
    return_reason CHECK match, returnToLocationId required, serial_id required for
    serialised items)
  - Add idempotency_key support (client UUID; ignore duplicates if already created)
  - Derive returned_by_id from req.user's staff (don't trust client value)
  - Use generate_return_number() SQL function instead of count-based generator
    (avoids race when two returns submit concurrently)

pages/api/procurement/field-stock/returns/[returnId]/inspect.ts
  - Add role gate: isReturnInspector
  - Set inspected_by from req.user's staff.name (don't trust client)
  - Validate lineDispositions shape against CHECK constraints
  - Apply line-level status update: stock_return_lines.status='inspected'

pages/api/procurement/field-stock/returns/[returnId]/accept.ts
  - Add role gate: isReturnInspector
  - Add stock_return_lines.status='processed' update after each line's disposition
  - Apply atomically: wrap all serial+quant+movement updates in a single transaction
    (existing code does them sequentially; if one fails mid-batch the return is half-restocked)
```

### New PWA-side helpers

```
src/modules/field-stock-pwa/api/
  returns.ts                      submitReturn(draft) → POST /returns
                                  submitInspectAndAccept(returnId, lineDispositions)
                                    → POST /inspect then /accept

src/modules/field-stock-pwa/lib/
  returnReasons.ts                const RETURN_REASONS aligned to CHECK constraint
                                  values
  dispositionOptions.ts           const DISPOSITION_OPTIONS aligned to CHECK
                                  constraint values (excluding supplier_return)
  conditionOptions.ts             const CONDITION_OPTIONS aligned to CHECK
                                  constraint values

src/modules/field-stock-pwa/hooks/
  useReturnWizard.ts              wizard state machine + submit dispatcher
```

### New offline support

```
src/modules/field-stock-pwa/offline/
  queueReturn.ts                  clone of queueIssue.ts; DB name 'field-stock-pwa-v1'
                                  (shared with issues); two new object stores:
                                    'pending-returns'
                                    'abandoned-returns'
                                  DB_VERSION bumped from 3 to 4 (additive — pending-issues
                                  and abandoned-issues stores preserved unchanged)
  __tests__/queueReturn.test.ts
```

`useStockSync` extended to:
- Track `pendingReturnsCount` + `abandonedReturnsCount` alongside the issue counters.
- Drain both queues in parallel.

### New pages

```
pages/my/stores/
  return.tsx                      (~60 lines — mounts ReturnOrchestrator)
  inspect/index.tsx               (~60 lines — mounts InspectListPage)
  inspect/[id].tsx                (~80 lines — mounts InspectOrchestrator)
```

---

## Data flow & state machine

### Return header lifecycle

```
pending                ← tech submits (direct or offline drain)
   │
   │  (storeman opens inspect screen, picks dispositions, submits)
   ▼
inspected              ← POST /inspect succeeded
   │
   │  (same client action, immediately follows)
   ▼
restocked              ← POST /accept succeeded; serials + quants + movements applied
```

Phase 3 skips `received` and `rejected`. If accept fails after inspect succeeded, the return sits in `inspected` and the storeman re-opens the same return to retry accept.

### Disposition outcomes (executed by existing `accept.ts`)

| Disposition | `stock_serials.status` | `stock_quants.location_id` impact |
|---|---|---|
| `restock` | `available` | quantity added at `return_to_location_id` |
| `repair` | `faulty` | no quant change (serialised; lives on serial) |
| `scrap` | `scrapped` | no quant change |

(`supplier_return` is in the CHECK but not exposed by Phase 3 UI.)

### Vocabulary (must match existing CHECK constraints)

```ts
// stock_return_lines.return_reason CHECK
type ReturnReason = 'unused' | 'job_cancelled' | 'wrong_item' | 'excess' | 'faulty' | 'customer_refused';

// stock_return_lines.condition CHECK (Phase 3 UI uses a 3-button subset)
type ReturnCondition = 'good' | 'damaged' | 'non_functional';
// Schema also allows: 'new', 'fair', 'poor' — Phase 3 UI does not expose them.

// stock_return_lines.disposition CHECK (Phase 3 UI uses a 3-button subset)
type ReturnDisposition = 'restock' | 'repair' | 'scrap';
// Schema also allows: 'supplier_return' — Phase 3 UI does not expose it.

// stock_returns.status CHECK
type ReturnStatus = 'pending' | 'received' | 'inspected' | 'accepted' | 'rejected' | 'restocked';
// Phase 3 only writes: pending (create), inspected (inspect), restocked (accept).
```

### UI labels for the create flow's overall reason

```ts
export const RETURN_REASONS: { code: ReturnReason; label: string }[] = [
  { code: 'unused',           label: 'Unused — end of job' },
  { code: 'job_cancelled',    label: 'Job cancelled' },
  { code: 'wrong_item',       label: 'Wrong item issued' },
  { code: 'excess',           label: 'Excess — over-issued' },
  { code: 'faulty',           label: 'Faulty / damaged in field' },
  { code: 'customer_refused', label: 'Customer refused install' },
];
```

This is one overall reason applied to **all** return lines in the batch (written as `return_reason` on every `stock_return_lines` row). Per-line override is **not** available in Phase 3 — keeps the wizard 3 steps.

### Mixed-source guard (create flow)

State in `ScanMyStockStep`:

```ts
lockedSourceWarehouseId: UUID | null
```

- First valid scan: `GET /serial-source?serialNumber=XYZ` returns the source warehouse id and name → set lock; remember name for error message.
- Subsequent scans: `GET /serial-source?serialNumber=XYZ` returns a different id → reject inline with: *"This serial was issued from {scannedSourceName}. Finish your {lockedSourceName} return first or start a new one."*
- The lock is also passed to `POST /returns` as `returnToLocationId` so the server doesn't have to re-derive.

### Offline queue (mirrors Phase 2)

- IndexedDB store `pending-returns`, keyed by client-generated UUID. Same DB (`field-stock-pwa-v1`), version bumped 3 → 4 (additive).
- Wizard writes to queue on submit; `useStockSync` drains via `submitReturn`.
- `AbandonedReturnsBanner` on `/my/stores` lists drafts that failed `MAX_ATTEMPTS=5` on 4xx.
- Same transient/permanent error classification as `useStockSync` for issues.

### Idempotency

- Client generates a UUID per return submission and per inspect+accept submission.
- Sent as `idempotency_key` in POST bodies.
- Server stores in `stock_returns.idempotency_key` (new column, NULLABLE, with a UNIQUE partial index `WHERE idempotency_key IS NOT NULL`). Adding this column is a **schema change** — see below.

**Schema change required:** Add `idempotency_key VARCHAR(64) UNIQUE` to `stock_returns`. This is a small addition — Phase 3 includes a migration `359_returns_idempotency_key.sql` strictly for this one column + partial unique index.

---

## Edge cases & error handling

| Case | Behaviour |
|---|---|
| Tech scans a serial they don't possess | `GET /my-serials` doesn't return it; client rejects: *"This serial isn't in your stock."* No leak about who owns it. |
| Tech scans a consumed serial | `GET /my-serials` returns only serials with `status='assigned'`; consumed ones (`status='consumed'`) are filtered out → same "not in your stock" message. |
| Tech scans from a different source than first | `GET /serial-source` returns different id → reject inline with locked-source error. |
| Tech submits empty serial list | Submit button disabled until ≥1 serial. |
| Tech goes offline mid-wizard | Wizard continues; submit writes to IndexedDB; sync drains on reconnect. |
| Double-tap submit | UUID `idempotency_key` dedupes server-side. |
| Storeman opens an already-restocked return | `/inspect` list filters to `status='pending'`. Direct nav to `[id]` of `restocked` return → show read-only summary, no submit. |
| Storeman opens an `inspected` return (accept failed previously) | UI offers "Retry restock" — POST /accept only (no second inspect). |
| Disposition `scrap` or `repair` without notes | Notes optional; soft prompt *"Add a note?"* but don't block. |
| Concurrent inspect on same return | Existing endpoint rejects if `status !== 'pending'`. PWA shows: *"This return was already inspected. Refresh to see latest."* |
| Accept fails after inspect succeeded | Return left in `status='inspected'`. PWA shows: *"Dispositions saved. Tap Retry restock to finalise."* Inspect screen re-fetches and shows read-only dispositions + Retry button. |
| Partial accept (one serial fails) | After endpoint hardening, accept is transactional — either all lines apply or none. Before hardening: best-effort, returns 207 with per-line status. |

### Logging

Every API entry/exit uses `log` from `@/lib/logger`. No `console.log`. Examples:

```ts
log.info('returns.create', { staffId, serialCount, returnToLocationId, idempotencyKey });
log.warn('returns.create.mixed_source', { staffId, lockedSource, scannedSource });
log.error('returns.inspect.failed', { error, returnId, staffId });
```

### Auth

| Endpoint | Guard |
|---|---|
| `POST /returns` | `withAuth` + `isReturnCreator(profile.role, profile.authRole)` |
| `GET /returns` | `withAuth`; if caller is only a creator (not inspector), scope rows to own staff_id |
| `POST /returns/[id]/inspect` | `withAuth` + `isReturnInspector(profile.role, profile.authRole)` |
| `POST /returns/[id]/accept` | `withAuth` + `isReturnInspector(profile.role, profile.authRole)` |
| `GET /my-serials` | `withAuth`; always scoped to req.user's linked staff_id |
| `GET /serial-source` | `withAuth`; any authed user (read-only, low risk) |

```ts
// storesRoles.ts (extension)
const RETURN_CREATOR_ROLES = ['technician', 'stores', 'admin'] as const;       // staff.role
const RETURN_INSPECTOR_ROLES = ['stores', 'admin'] as const;                   // staff.role
// super_admin/system in authRole always admitted by both helpers.

export function isReturnCreator(role, authRole) { /* … */ }
export function isReturnInspector(role, authRole) { /* … */ }
```

---

## Testing

| Layer | What | Where |
|---|---|---|
| Unit | `storesRoles` extension, `returnReasons`, `dispositionOptions`, `conditionOptions`, `queueReturn` IDB ops | co-located `__tests__/` |
| Unit | Mixed-source guard logic | `ScanMyStockStep.test.tsx` (RTL) |
| Integration | POST /returns happy path with new role gate; idempotency dedupe; mixed-source server-side guard (in case client bypassed); GET /my-serials scoping; inspect+accept atomicity; my-serials excludes consumed | `tests/api/procurement/field-stock/returns-flow-integration.test.ts` |
| Browser smoke | End-to-end on dev via Playwriter MCP — mirror Phase 2 smoke test (caught 5 real bugs) | Run before merge; not in CI |

Phase 2 lesson: unit tests with mocked `sql` missed all five real bugs. The browser smoke test is the load-bearing verification step; do not skip it.

---

## Migration

```
scripts/migrations/sql/359_returns_idempotency_key.sql
```

Single column add + partial unique index:

```sql
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_returns_idempotency
  ON stock_returns(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Optional but recommended addition: a column for the tech-side signature data URL (currently the Phase 3 design stores it in `notes` JSON, which is messy). Decision: store signature in `notes` for v1 to avoid a second column; revisit in Phase 4 if cleanup needed.

---

## Success criteria

1. Migration 359 applied to dev DB; `stock_returns.idempotency_key` column + unique partial index exist.
2. A technician can complete a return wizard end-to-end on `dev.fibreflow.app`, with signature captured and a `RET-YYYYMM-NNNNN` returned.
3. A storeman can open `/my/stores/inspect`, see the pending return, set per-line condition + disposition (with optional notes), submit, and verify:
   - `stock_returns.status='restocked'`
   - For each line: `stock_serials.status` matches the disposition (available/scrapped/faulty)
   - For `restock` lines: `stock_quants.quantity` at `return_to_location_id` increased
4. A mixed-source attempt is blocked client-side with the right error message.
5. Offline submission queues and drains on reconnect; the same return is not duplicated (idempotency key).
6. Role gating: a technician sees only the Return tile (no Inspect); a storeman sees both.
7. `npm run ci:quick` passes; no lint ratchet regressions (77 errors / ~1833 warnings / 94 catches floor).
8. Blind review-team approves the bundled PR.
9. Browser smoke test on dev passes (Playwriter MCP).
10. No `console.log`, no empty catches, files <300 lines, components <200 lines.

---

## Open verification items (must check before each marked task)

1. **stock_serials.status** valid values — `accept.ts` writes `available`, `scrapped`, `faulty`. Confirm the CHECK constraint accepts these and `assigned` (for issued state) by querying:
   ```sql
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'stock_serials'::regclass AND contype = 'c';
   ```
   *Task 1 (Schema probe) does this.*

2. **staff ↔ users linkage** — `req.user.id` is `users.id`; tech-side calls need `staff.id`. Phase 2 fixed this with `staff WHERE user_id = req.user.id` lookup. Same pattern in `my-serials` and `returns.ts` POST. *No new question; reuse Phase 2 helper.*

3. **`my-serials` shape** — what defines "currently held by tech"? Candidate sources:
   - Latest `stock_pickings` line where `technician_id=staff.id` and picking `status='done'`, MINUS serials already returned/consumed
   - `stock_quants` filtered by a technician-bound location (Phase 2 used FIELD-DEFAULT, not per-tech)
   - A view if one exists (`stock_serial_current_holders` or similar)

   *Task 1 (Schema probe) confirms which source is canonical.*

4. **`generate_return_number()` availability** — the SQL function exists per migration 029 line 187-200. Confirm it still does:
   ```sql
   SELECT generate_return_number();
   ```
   If it does, the existing `index.ts` count-based generator is replaced with the function call to avoid races. *Task 1 (Schema probe) does this.*

5. **Existing `stock_returns.idempotency_key` column** — confirm it doesn't already exist before writing migration 359:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name='stock_returns' AND column_name='idempotency_key';
   ```
   *Task 1 (Schema probe) does this.*

These are answered in the **first task** of implementation (a schema probe in the migrations runner / psql), then carried forward as known facts in subsequent tasks.

---

## Resume / next step

Once approved by Hein, invoke the `superpowers:writing-plans` skill to produce the task-level implementation plan. The plan should follow the Phase 2 three-role pattern: implementer → blind reviewer → evaluator, parallelised across the file groups above.
