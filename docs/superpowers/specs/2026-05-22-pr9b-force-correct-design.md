# PR-9b — Force-correct write API + admin UI

**Date:** 2026-05-22
**Author:** Claude (Opus 4.7, brainstormed with Hein)
**Wave:** Wave 2 deferred catalogue → picked up on user override (no formal trigger fired)
**Plan reference:** `docs/superpowers/plans/2026-05-21-serial-master-register-wave2.md`
**Predecessor specs:** `docs/superpowers/specs/2026-05-21-serial-master-register-design.md`

---

## 1 — Problem

`stock_serials` rows occasionally land in a state that the state machine (`src/services/procurement/serialStateMachine.ts`) refuses to transition out of:

- The 807-false-activation incident on 2026-05-21 flipped 807 serials to `installed` against the wrong `installed_at_drop_number`. `transitionSerial` from `installed` → `available` is not in the allowed-transitions matrix, so the only fix was direct SQL by a DBA.
- Future ingest channels (Fibertime CSV, Lawley contractor uploads, OneDrive imports) are likely to produce similar systematic wrong-state rows.
- Audit/compliance has not asked yet, but "who flipped what when" is a likely future ask.

Today, only Hein/the DBA can remediate this state. Building a controlled, auditable bypass — gated by a new permission, with row-level audit trail — lets a wider set of trusted admins fix bad state without becoming a DBA.

**This PR was deferred in the Wave 2 plan** with the rationale that direct SQL was sufficient. **Hein explicitly overrode the deferral on 2026-05-22** to build it proactively rather than wait for a trigger to fire.

## 2 — Goals & non-goals

### Goals

1. A trusted operator (super_admin + anyone granted a new RBAC permission) can directly set the following columns on `stock_serials`, bypassing the state machine, via a controlled UI and a single API. Column set was confirmed against the live schema 2026-05-22 (no `current_warehouse_id` column exists; project column is `allocated_to_project_id`):
   - `status`
   - `current_location_id`
   - `allocated_to_project_id`
   - `installed_at_drop_number`
   - `activated_at_olt_id`
2. Every change writes one `stock_serial_events` row capturing user, reason, prior values, new values, and a flag distinguishing force-corrects from normal transitions.
3. Two UI entry points (single-serial in-context on the detail page, batch via paste-list on a dedicated admin page) both POST to the same underlying API.
4. Batch operations have a mandatory preview step (per `feedback_run_backfills_through_verification_first`).
5. Batch operations are per-serial best-effort — one bad row in 200 does not block the rest.

### Non-goals

- A reconciliation UI (that is deferred PR-11).
- A force-correct API that can rewrite `serial_number`, model/SKU, or supplier_id.
- A new audit-trail table (we reuse `stock_serial_events`).
- A change to the existing `transitionSerial` state machine — it remains the canonical write path for normal lifecycle events.
- A UI to *grant* the new permission (existing RBAC admin tooling does that).
- Backfilling audit rows for the 807-incident retroactively.
- Concurrency/locking hardening beyond what `stock_serials` already provides (force-correct is admin-rare, not a hot path).

## 3 — Architecture

```
┌─ Service ─────────────────────────────────────────────────────┐
│  src/modules/procurement/field-stock/services/serialForceCorrectService.ts               │
│    forceCorrectSerials(params) → ForceCorrectResult           │
│      • Each serial wrapped in its own pg txn (best-effort)    │
│      • Uses pg.Pool via @/lib/db-pool (matches Wave 2 pattern)│
│      • Writes one stock_serial_events row per changed serial  │
└─────────────┬─────────────────────────────────────────────────┘
              │
              ▲
              │ called by
              │
┌─ API ────────┴────────────────────────────────────────────────┐
│  POST /api/procurement/field-stock/serials/force-correct      │
│    withAuth + permission check: 'procurement.field-stock.     │
│      force-correct' (edit)                                    │
│    Validation at boundary; per-row errors returned in body,   │
│    not as HTTP errors.                                        │
└─────────────┬─────────────────────────────────────────────────┘
              │
   ┌──────────┴──────────────┐
   ▼                         ▼
 Admin batch page          Detail-page modal
 /procurement/field-       /procurement/field-stock/
   stock/serials/            serials/[serialNumber]
   force-correct             (button + modal, list of 1)
```

### Key design choices (and rejected alternatives)

1. **One service, one API, two UIs.** The detail-page modal is the batch flow with `serials.length === 1` and the preview step skipped (the detail page already shows current state on screen).
2. **`pg.Pool` via `@/lib/db-pool`** (named `pool` import), not the Neon serverless shim. Matches Wave 2's `serialTimelineService` / `serialSearchService` convention. Per Wave 2 lesson #4, the shim is technical debt; new code uses `pg.Pool`.
3. **Audit reuses `stock_serial_events`** with `event_type='force_corrected'`. Per Wave 2 Locked decision #8, `event_type` has no CHECK constraint, so this is a code-only change.
4. **Per-serial atomicity.** Each serial wrapped in its own `BEGIN`/`COMMIT`. Failures do not roll back the rest. Rationale: matches how a DBA's `UPDATE WHERE` behaves and lets the operator fix only the broken rows on a second pass.
5. **No nav link.** Admin page is URL-only by default (Locked decision #11).
6. **Permission seeded via migration**; the migration is the only schema-shaped change in this PR.

## 4 — API & service contract

### Service: `src/modules/procurement/field-stock/services/serialForceCorrectService.ts`

```typescript
// Full DB-allowed status set (stock_serials_status_check). Force-correct intentionally
// allows the FULL set, not just the 8 values exposed by SerialStatusValue / transition.ts —
// 'bypass the state machine' is the whole point.
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

// All target fields optional — omit = don't touch that column.
// `null` = explicitly set the column to NULL.
// At least one target field must be present (validated at API boundary).
export interface ForceCorrectTarget {
  status?: ForceCorrectStatus;
  currentLocationId?: string | null;
  allocatedToProjectId?: string | null;
  installedAtDropNumber?: string | null;
  activatedAtOltId?: string | null;
}

export interface ForceCorrectParams {
  serials: string[];           // serial_number values (NOT UUIDs)
  target: ForceCorrectTarget;
  reason: string;              // min 10 chars, validated at API
  performedBy: string;         // user.id
  performedByName: string;     // user.name
  dryRun: boolean;             // true = preview only, no writes
}

export interface ForceCorrectRowResult {
  serialNumber: string;
  found: boolean;
  applied: boolean;            // false on dryRun OR on error
  before?: Partial<ForceCorrectTarget>;  // only fields that would change
  after?: Partial<ForceCorrectTarget>;
  changedFields: string[];     // [] = no-op (already in target state)
  error?: string;
}

export interface ForceCorrectResult {
  dryRun: boolean;
  totalRequested: number;
  totalApplied: number;        // 0 on dryRun
  totalFailed: number;
  totalNoOp: number;
  rows: ForceCorrectRowResult[];
}

export async function forceCorrectSerials(p: ForceCorrectParams): Promise<ForceCorrectResult>;
```

### API: `pages/api/procurement/field-stock/serials/force-correct.ts`

- **Method:** `POST` only. Anything else → `apiResponse.methodNotAllowed`.
- **Wrapper:** `withAuth` + explicit permission check on `procurement.field-stock.force-correct` with `edit` capability.
- **Body shape:** `ForceCorrectParams` minus `performedBy`/`performedByName` (taken from `req.user.id`/`req.user.name`).
- **Validation (at boundary only — per CLAUDE.md hard rule):**
  - `serials`: array of strings, length 1–500, each non-empty after trim.
  - `target`: at least one of the 5 fields present.
  - `target.status`: if present, must be one of `available | reserved | allocated_to_project | in_transit | issued | installed | activated | faulty | in_repair | returned | scrapped` (the full DB CHECK constraint set).
  - `reason`: string, min 10 chars after trim.
  - `dryRun`: boolean. **If missing, defaults to `true`** (defensive — never accidentally commit).
- **Response:** `apiResponse.success(res, result: ForceCorrectResult)`. Per-row errors live inside `rows[].error`. Top-level HTTP errors are reserved for validation failures (`400`), auth (`401`), and permission (`403`).

### Why these specific shapes

- `serials: string[]` (serial_number, not UUID) — users will paste from Excel/WA/CSV; UUID lookup is friction.
- `null` vs `undefined` in `target` — `undefined` = "don't touch this column"; `null` = "explicitly set to NULL" (e.g., clear a wrongly-set `installed_at_drop_number`).
- 500-row batch cap — bounds preview/apply latency. Raise if reality demands; better to start tight.
- `dryRun` defaults to `true` if missing — defensive; the UI must consciously send `false` to commit.
- 5 fields, not 6 — the spec originally listed `currentWarehouseId`, but the live `stock_serials` table has no `current_warehouse_id` column. Warehouse-level reassignment, if ever needed, would be a separate column-add migration outside this PR's scope.

## 5 — Data & audit

### No schema changes to `stock_serials` or `stock_serial_events`

We add a new `event_type` value (`'force_corrected'`). Per Wave 2 Locked decision #8, this is code-only.

### Audit row per changed serial

One `stock_serial_events` INSERT per row that actually changed (no-op rows write nothing). Column layout confirmed live 2026-05-22:

```sql
INSERT INTO stock_serial_events (
  serial_id,
  event_type,        -- 'force_corrected'
  from_state,        -- old status (only when status changes; else NULL)
  to_state,          -- new status (only when status changes; else NULL)
  actor_user_id,     -- uuid of operator
  payload,           -- JSONB (NOT NULL, default '{}')
  occurred_at        -- NOW() (column has no default)
  -- source_table, source_id intentionally NULL → bypasses dedupe unique index
)
VALUES (...);
```

`payload` JSONB shape:

```json
{
  "isForceCorrect": true,
  "performedByName": "Hein van Vuuren",
  "reason": "807-incident remediation 2026-05-21",
  "before": { "status": "installed", "installedAtDropNumber": "1234567" },
  "after":  { "status": "available", "installedAtDropNumber": null },
  "changedFields": ["status", "installedAtDropNumber"]
}
```

(Note: `stock_serial_events` has no dedicated `performed_by_name` or `reason` columns — both live inside `payload`. Operator `actor_user_id` is the structured FK; the display name + reason are denormalised into JSON.)

Rendered on the `/serials/[serialNumber]` timeline with a distinct visual treatment (icon + "Force-corrected by" label, sourced from `payload.performedByName`) so it is never confused with a normal state-machine transition.

### Pre-implementation probe — DONE 2026-05-22

Live schema confirmed against `100.96.203.105:5436`. Findings that drove the column changes captured above:

- `stock_serials` has NO `current_warehouse_id` column → dropped from writable set.
- Project FK is `allocated_to_project_id` (NOT `project_id`).
- `stock_serial_events` columns are `actor_user_id` / `payload` / `from_state` / `to_state` / `occurred_at` (NOT `performed_by` / `performed_by_name` / `reason` / `metadata`). `payload` is JSONB NOT NULL with default `'{}'`.
- RBAC tables are `access_permissions` (registry) + `role_permissions` (grants). There is NO `permissions` table and NO `roles` table.
- `access_permissions.type` CHECK allows `'module' | 'page' | 'tab' | 'action'`. `'action'` is correct for the new permission.
- `role_permissions` shape: `(role varchar(50), permission_key varchar(100), actions jsonb)`. `actions` is a JSONB blob of `{view, create, edit, delete}` booleans — NOT separate columns. Unique constraint on `(role, permission_key)`.
- `stock_serials.status` CHECK accepts 11 values: `available | reserved | allocated_to_project | in_transit | issued | installed | activated | faulty | in_repair | returned | scrapped`.
- MAX migration version = **377**. New migration = **378** (re-verified at Task 3 step 1 against a fresh `SELECT MAX(version) FROM migrations` to guard against parallel-session collisions).
- DB pool: import `pool` from `@/lib/db-pool` (matches Wave 2's `serialTimelineService` / `serialSearchService` convention), not the default-export `pool` from `@/lib/db`.

### RBAC migration: `scripts/migrations/sql/378_rbac_field_stock_force_correct.sql`

(Version 378 is provisional — re-pick via `SELECT MAX(version) FROM migrations` immediately before the file is written, per `feedback_migration_version_collision`.)

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

### Permission check at API

Use the existing `withPermission` middleware from `@/lib/auth` (confirmed pattern in `pages/api/procurement/field-stock/serials/search.ts`):

```typescript
export default withAuth(
  withPermission('procurement.field-stock.force-correct', 'edit')(handler)
);
```

`withPermission` calls `userHasPermission()` from `@/lib/permissions`, which queries `role_permissions.actions->>'edit'` after the parent-block cascade. Super_admin bypasses the check via an early return in the middleware (confirmed live read). No new RBAC helper is invented.

## 6 — UI

### 6a. Detail-page modal (single serial)

File: `pages/procurement/field-stock/serials/[serialNumber].tsx`.

Added: one "Force-correct state" button (visible only if the user has the new permission), opening a modal with the 5 editable fields (status, currentLocationId, allocatedToProjectId, installedAtDropNumber, activatedAtOltId), a current-values column, a new-values column, a required reason textarea (min 10 chars), and "Cancel" / "Apply" buttons.

On submit: POST with `serials: [serialNumber]`, `dryRun: false` → success toast → refresh timeline (the new force-correct event appears at the top).

No preview step on the detail page — the current values are already visible in the modal next to the new values.

### 6b. Admin batch page (paste-list)

File: `pages/procurement/field-stock/serials/force-correct.tsx`. Permission-gated route (403 page if missing).

**Three-step UX:**

1. **Compose:** Paste serial numbers (one per line, count badge updates live). Pick target fields. Type reason. Click "Preview changes →".
2. **Preview:** Table showing per-serial proposed change with columns `Serial | Found | Status before → after | Changes count | Note`. Footer: `N total, M failed, K no-op`. Buttons: `← Edit list` / `Apply N changes (skips no-ops + not-found)`.
3. **Result:** Same table shape with `Applied | Error` columns. User can copy failed rows back into step 1 to retry.

### Shared component

A single `<ForceCorrectFields>` component at `src/components/field-stock/ForceCorrectFields.tsx`, used by both the modal (6a) and the batch page (6b). Renders the 5 editable fields + reason textarea. Props: `currentValues` (optional — supplied on detail-page modal only), `value`, `onChange`.

### UI implementation pointers

- Pages wrap in `<AppLayout>` (Locked decision #14).
- Reuse `Card` / `Button` / `Input` / `Select` / `Table` from existing `src/components/ui/`.
- No new design-system primitives.
- Types imported from `@/types/field-stock`; services MUST NOT import from `@/components/` (Locked decision #13).

## 7 — Types

Add to `src/types/field-stock/`:

- `forceCorrectTarget.ts` — `ForceCorrectTarget`
- `forceCorrectResult.ts` — `ForceCorrectRowResult`, `ForceCorrectResult`

Re-export from `src/types/field-stock/index.ts`.

## 8 — Testing strategy

Per CLAUDE.md hard rule #4 (goal-driven verification) + Wave 2 lessons.

| Layer | File | Coverage |
|---|---|---|
| **Service unit + integration (real Postgres)** | `tests/db/services/field-stock/serialForceCorrect.test.ts` | Uses `tests/db/setup/seed.sql` (the seed that was repaired in Wave 2 to mirror prod's `projects.project_name`). Covers: dry-run preview, single-serial apply, batch apply, no-op detection (already-in-target-state), not-found serial, `null` vs `undefined` target semantics, audit-row JSONB shape, per-serial txn isolation (one failure ≠ batch failure), audit row written for changed rows but NOT for no-op or not-found. |
| **API handler (mocked service)** | `tests/api/procurement/field-stock/serials/force-correct.test.ts` | Mocks `forceCorrectSerials`. Covers: method allowlist (`GET` → 405), validation errors (empty `serials`, no `target` fields, `reason` <10 chars, status not in enum, batch > 500), `withAuth` enforcement (no user → 401), permission check (denied → 403), `dryRun` defaulting to `true` when missing from body. |
| **RBAC migration** | `tests/migrations/<version>_rbac_field_stock_force_correct.test.ts` | Apply migration to test DB → assert permission row exists with expected `resource_key`. Apply twice → assert idempotent (no error, no duplicate row). Assert super_admin grant row exists. |
| **UI smoke (Playwright MCP)** | Browser test via `mcp__playwriter__execute` per `feedback_browser_playwright`. Two flows: (1) detail-page modal apply on a seeded test serial; (2) batch page paste 3 serials → preview → apply. Screenshots into PR body (or `page.evaluate()` DOM extraction per Wave 2 lesson #3 if `captureScreenshot` times out on dev). |

### Explicitly out of scope

- Concurrency / row-lock stress testing — force-correct is admin-rare, not a hot path.
- 500-row performance SLA — the cap is a guardrail, not a SLA target.
- RBAC UI for assigning the new permission — assignment uses existing RBAC admin tooling.

## 9 — Risks & mitigations

| Risk | Mitigation |
|---|---|
| Operator force-corrects the wrong serial number (typo in paste-list). | Preview step shows current values; operator can spot the mistake before "Apply". Audit row captures `before` state so it can be reversed by a second force-correct. |
| Operator force-corrects a batch and gets the target state wrong. | All audit rows have full `before` + `reason`. Reverse-fix is a follow-up force-correct that uses the prior `before` values as the new target. |
| New permission accidentally granted to too many users via existing RBAC admin tooling. | The migration grants only to `super_admin`. Granting to other roles is a deliberate human action through the existing RBAC UI; this PR does not widen distribution by default. |
| Live schema differs from spec assumptions (column names on `permissions`/`role_permissions`/`stock_serial_events`). | Mandatory pre-implementation probe (§5) catches this before any SQL or service code is written. Spec amended before code if so. |
| Parallel session opens a colliding PR. | Per Wave 2 lesson #2, `gh pr list --search "force-correct"` before opening the PR. |
| Migration version collides with a parallel-session migration in flight on another branch. | Per `feedback_migration_version_collision`, the version is read from `SELECT MAX(version) FROM migrations` immediately before the migration is committed, not from `ls`. |
| State-machine bypass becomes the default lazy fix instead of a real solution. | Distinct UI surface ("Force-correct" naming, warning banner, mandatory reason ≥10 chars). Audit trail makes overuse visible. |

## 10 — Out of scope (explicit)

- PR-9b does NOT touch the existing `transition.ts` API or `transitionSerial` service.
- PR-9b does NOT add a UI for granting the new RBAC permission.
- PR-9b does NOT change the `stock_serial_events` schema (no migration on that table).
- PR-9b does NOT touch any other deferred Wave 2 PR (PR-10 dashboard, PR-11 reconciliation, PR-12/13 drill-downs, PR-14/15 rebuilds).
- PR-9b does NOT add a CSV upload feature for the batch list (paste-text only). If CSV upload is asked for >2x, that is a follow-up.

## 11 — Open questions (none at sign-off)

All resolved through brainstorming on 2026-05-22:

- Writable fields → status + linkage + project/warehouse (6 fields).
- Batch model → batch by explicit paste-list (not by filter).
- Authorization → new granular permission `procurement.field-stock.force-correct`.
- UI surface → detail-page modal + admin batch page (both POST to same API).
- Dry-run → two-step preview→confirm for batch; single-serial flow skips preview.
- Atomicity → per-serial best-effort.

## 12 — Wave 2 conventions inherited (do not re-litigate)

| # | Decision |
|---|---|
| 1 | Persona = procurement admins/managers, desktop. |
| 2 | Augment, not replace. New routes only. |
| 6 | API uses `withAuth` (`ff_auth_token`). |
| 8 | `stock_serial_events.event_type` has no CHECK constraint — new types are code-only. |
| 9 | No migrations unless absolutely necessary. (One unavoidable here: RBAC permission seed.) |
| 11 | New pages are orphaned (no nav link). |
| 12 | API routes are FLAT. (`/serials/force-correct.ts`, NOT `/serials/[serialNumber]/force-correct.ts`.) |
| 13 | Shared types live in `src/types/field-stock/`. Services do not import from `src/components/`. |
| 14 | Pages wrap in `<AppLayout>` from `@/components/layout`. |
| 15 | Browser smoke uses Playwright MCP with screenshots / DOM extraction. |
