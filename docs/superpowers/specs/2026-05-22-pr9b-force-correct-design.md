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

1. A trusted operator (super_admin + anyone granted a new RBAC permission) can directly set the following columns on `stock_serials`, bypassing the state machine, via a controlled UI and a single API:
   - `status`
   - `current_location_id`
   - `current_warehouse_id`
   - `project_id`
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
│      • Uses pg.Pool via @/lib/db, NOT @neondatabase/serverless│
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
2. **`pg.Pool` via `@/lib/db`**, not the Neon serverless shim. Per Wave 2 lesson #4, the shim is technical debt; new code uses `pg.Pool`.
3. **Audit reuses `stock_serial_events`** with `event_type='force_corrected'`. Per Wave 2 Locked decision #8, `event_type` has no CHECK constraint, so this is a code-only change.
4. **Per-serial atomicity.** Each serial wrapped in its own `BEGIN`/`COMMIT`. Failures do not roll back the rest. Rationale: matches how a DBA's `UPDATE WHERE` behaves and lets the operator fix only the broken rows on a second pass.
5. **No nav link.** Admin page is URL-only by default (Locked decision #11).
6. **Permission seeded via migration**; the migration is the only schema-shaped change in this PR.

## 4 — API & service contract

### Service: `src/modules/procurement/field-stock/services/serialForceCorrectService.ts`

```typescript
import type { SerialStatusValue } from '@/types/procurement/stock/enums.types';

// All target fields optional — omit = don't touch that column.
// `null` = explicitly set the column to NULL.
// At least one target field must be present (validated at API boundary).
export interface ForceCorrectTarget {
  status?: SerialStatusValue;
  currentLocationId?: string | null;
  currentWarehouseId?: string | null;
  projectId?: string | null;
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
  - `target`: at least one of the 6 fields present.
  - `target.status`: if present, must be one of `available | reserved | issued | in_transit | installed | faulty | returned | scrapped`.
  - `reason`: string, min 10 chars after trim.
  - `dryRun`: boolean. **If missing, defaults to `true`** (defensive — never accidentally commit).
- **Response:** `apiResponse.success(res, result: ForceCorrectResult)`. Per-row errors live inside `rows[].error`. Top-level HTTP errors are reserved for validation failures (`400`), auth (`401`), and permission (`403`).

### Why these specific shapes

- `serials: string[]` (serial_number, not UUID) — users will paste from Excel/WA/CSV; UUID lookup is friction.
- `null` vs `undefined` in `target` — `undefined` = "don't touch this column"; `null` = "explicitly set to NULL" (e.g., clear a wrongly-set `installed_at_drop_number`).
- 500-row batch cap — bounds preview/apply latency. Raise if reality demands; better to start tight.
- `dryRun` defaults to `true` if missing — defensive; the UI must consciously send `false` to commit.

## 5 — Data & audit

### No schema changes to `stock_serials` or `stock_serial_events`

We add a new `event_type` value (`'force_corrected'`). Per Wave 2 Locked decision #8, this is code-only.

### Audit row per changed serial

One `stock_serial_events` INSERT per row that actually changed (no-op rows write nothing):

```sql
INSERT INTO stock_serial_events (
  serial_id,
  event_type,        -- 'force_corrected'
  performed_by,
  performed_by_name,
  reason,
  metadata           -- JSONB
)
VALUES (...);
```

`metadata` JSONB shape:

```json
{
  "isForceCorrect": true,
  "before": { "status": "installed", "installedAtDropNumber": "1234567" },
  "after":  { "status": "available", "installedAtDropNumber": null },
  "changedFields": ["status", "installedAtDropNumber"]
}
```

Rendered on the `/serials/[serialNumber]` timeline with a distinct visual treatment (icon + "Force-corrected by" label) so it is never confused with a normal state-machine transition.

### Pre-implementation probe (mandatory)

Per `feedback_query_schema_before_migration` + Wave 2 lesson #1 (probe JOINed tables too), the very first execution step is:

```sql
SELECT version FROM migrations ORDER BY version::int DESC LIMIT 5;
\d stock_serials
\d stock_serial_events
\d permissions
\d role_permissions
\d roles
```

If the live column names differ from those assumed in this spec (likely candidates: `metadata` may be named differently; `role_permissions.can_*` columns may have a different shape), **the spec is amended before any SQL or service code is written** — same discipline as Wave 2 PR-0.

### RBAC migration: `scripts/migrations/sql/<MAX+1>_rbac_field_stock_force_correct.sql`

Version picked from `SELECT MAX(version) FROM migrations`, **not from `ls`** (per `feedback_migration_version_collision` — side branches apply to the shared DB).

```sql
BEGIN;

INSERT INTO permissions (
  resource_type, resource_key, module, label, description, path, sort_order
)
VALUES (
  'action',
  'procurement.field-stock.force-correct',
  'procurement',
  'Force-correct serial state',
  'Bypass state-machine validation and directly set status/location/project on stock_serials. Writes audit-trail row to stock_serial_events.',
  NULL,
  NULL
)
ON CONFLICT (resource_key) DO NOTHING;

-- Defensive explicit grant to super_admin (some setups treat super_admin
-- as implicit-all; explicit grant ensures the new permission is honoured
-- regardless of which model is in effect).
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_create, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.resource_key = 'procurement.field-stock.force-correct'
ON CONFLICT DO NOTHING;

COMMIT;

-- ROLLBACK (manual, not auto-applied):
-- BEGIN;
-- DELETE FROM role_permissions WHERE permission_id = (
--   SELECT id FROM permissions WHERE resource_key = 'procurement.field-stock.force-correct'
-- );
-- DELETE FROM permissions WHERE resource_key = 'procurement.field-stock.force-correct';
-- COMMIT;
```

The exact column names above (`permissions.resource_key`, `role_permissions.can_*`) are inferred from `247_rbac_update_all_modules.sql`. The probe step above confirms them before this migration is written for real.

### Permission check at API

```typescript
const allowed = await hasPermission(req.user.id, 'procurement.field-stock.force-correct', 'edit');
if (!allowed) return apiResponse.forbidden(res, 'force-correct permission required');
```

The exact `hasPermission` helper is discovered during implementation by inspecting `@/lib/rbac` (or wherever the existing RBAC helpers live) and the pattern already used by other gated endpoints. Whatever pattern the repo already uses wins — this spec does not invent a new RBAC API surface.

## 6 — UI

### 6a. Detail-page modal (single serial)

File: `pages/procurement/field-stock/serials/[serialNumber].tsx`.

Added: one "Force-correct state" button (visible only if the user has the new permission), opening a modal with the 6 editable fields, a current-values column, a new-values column, a required reason textarea (min 10 chars), and "Cancel" / "Apply" buttons.

On submit: POST with `serials: [serialNumber]`, `dryRun: false` → success toast → refresh timeline (the new force-correct event appears at the top).

No preview step on the detail page — the current values are already visible in the modal next to the new values.

### 6b. Admin batch page (paste-list)

File: `pages/procurement/field-stock/serials/force-correct.tsx`. Permission-gated route (403 page if missing).

**Three-step UX:**

1. **Compose:** Paste serial numbers (one per line, count badge updates live). Pick target fields. Type reason. Click "Preview changes →".
2. **Preview:** Table showing per-serial proposed change with columns `Serial | Found | Status before → after | Changes count | Note`. Footer: `N total, M failed, K no-op`. Buttons: `← Edit list` / `Apply N changes (skips no-ops + not-found)`.
3. **Result:** Same table shape with `Applied | Error` columns. User can copy failed rows back into step 1 to retry.

### Shared component

A single `<ForceCorrectFields>` component at `src/components/field-stock/ForceCorrectFields.tsx`, used by both the modal (6a) and the batch page (6b). Renders the 6 editable fields + reason textarea. Props: `currentValues` (optional — supplied on detail-page modal only), `value`, `onChange`.

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
