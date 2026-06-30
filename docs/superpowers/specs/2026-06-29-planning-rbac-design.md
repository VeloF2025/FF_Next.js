# Planning Module — RBAC Design

**Date:** 2026-06-29
**Branch:** `feat/planning-rbac`
**Author:** Claude (with Hein)
**Status:** Approved design — ready for implementation plan

## Problem

The Planning module (kanban board at `/planning`, plus detail and create pages,
backed by `planning_items` / `planning_activities`) is live in production but has
**no access control**:

- `GET` API reads are wide open (no auth, no permission).
- `POST` / `PUT` / `DELETE` require *any* authenticated user, but **no permission check**.
- The sidebar entry references `rbacKey: 'planning.main'`, but that permission key
  **does not exist** in `access_permissions`, and the legacy `permissions: []` field
  gates nothing — so the nav shows for everyone.

This design adds RBAC consistent with the existing PostgreSQL-based system used by
procurement, assets, snags, etc.

## Decisions (confirmed with Hein)

- **Role matrix:** Standard (mirrors Procurement). See table below.
- **Edit granularity:** Module-level — anyone whose role grants `edit` may edit/move
  any card. Shared team board; **no** per-assignee restriction.
- **Reads gated:** Yes — viewing the board requires the `view` permission (closes the
  current open-reads hole; module hidden from nav for users without view).
- **Unauthorized page behavior:** Show an "Access Denied" message (not a silent redirect).

## Role → permission matrix

Applied to **both** the `planning` module key and the `planning.main` page key
(the parent-cascade rule forces children to `false` if the module row is not granted,
so the module row must carry the same grants).

| role        | view | create | edit | delete |
|-------------|:----:|:------:|:----:|:------:|
| super_admin |  ✓   |   ✓    |  ✓   |   ✓    |
| admin       |  ✓   |   ✓    |  ✓   |   ✓    |
| manager     |  ✓   |   ✓    |  ✓   |   ✗    |
| technician  |  ✓   |   ✗    |  ✗   |   ✗    |
| viewer      |  ✓   |   ✗    |  ✗   |   ✗    |
| contractor  |  ✗   |   ✗    |  ✗   |   ✗    |

(`super_admin` also bypasses checks in code via `userHasPermission`.)

## Architecture

The codebase already provides every mechanism needed; this is wiring, not new
infrastructure.

### 1. Permission seed — `scripts/migrations/sql/433_planning_rbac.sql`

Insert two rows into `access_permissions` (next free number is **432**; re-confirm
against the live migration tracker at apply time — version collisions have bitten us):

| key            | type   | parent_key | label              | route       |
|----------------|--------|------------|--------------------|-------------|
| `planning`     | module | (null)     | `Planning`         | `/planning` |
| `planning.main`| page   | `planning` | `Planning Board`   | `/planning` |

Then seed `role_permissions` rows (one per role × both keys) per the matrix above.

- Idempotent: `INSERT … ON CONFLICT (key) DO UPDATE` for `access_permissions`,
  `INSERT … ON CONFLICT (role, permission_key) DO UPDATE` for `role_permissions`.
  Modelled on migration `242_snags_module.sql`.
- Ships with `scripts/migrations/sql/rollback_433_planning_rbac.sql` that deletes the
  two permission keys (cascades to their `role_permissions` rows).

### 2. Server-side enforcement (the real boundary)

Replace the ad-hoc `getUserId()` / `verifyToken` logic in the two App Router handlers
with `requirePermission` from `@/lib/auth/app-router` (tuple-returning helper that
already does super_admin bypass + parent-cascade):

```ts
const [user, deny] = await requirePermission(req, 'planning.main', 'view');
if (deny) return deny;
const userId = user.id;
```

| File | Verb → action |
|------|---------------|
| `app/api/planning/items/route.ts` | `GET` → `view`, `POST` → `create` |
| `app/api/planning/items/[id]/route.ts` | `GET` → `view`, `PUT` → `edit`, `DELETE` → `delete` |

- Gate key is `planning.main`; the cascade check automatically respects a `planning`
  module-level block.
- `created_by` and activity-log actor now come from the returned `user.id`.
- The existing 401-on-missing-token behavior is preserved (now via `requireAuth`
  inside `requirePermission`).

### 3. Navigation

`src/components/layout/sidebar/config/planningSection.ts` already has
`rbacKey: 'planning.main'`. Once the permission is seeded, `sidebarUtils.ts`
(`can(item.rbacKey, 'view')`) auto-hides the entry for contractors and anyone without
view. Remove the dead `permissions: []` line for tidiness (no behavioral change).

### 4. Page-level UX gating (client-side)

No App Router page in this repo does server-side redirect gating; gating is client-side
via the nav plus `PermissionGate`. The API layer (#2) is the enforcement; this is
defense-in-depth + UX.

| Page (client component) | Gate |
|-------------------------|------|
| `/planning` board | `<PermissionGate permission="planning.main" action="view" fallback={<AccessDenied/>}>` |
| `/planning/new` | gate body with `action="create"` |
| `/planning/[id]` | gate `view`; hide edit/move controls behind `action="edit"`, delete/cancel behind `action="delete"` |

"Access Denied" fallback is a simple inline message (reuse an existing access-denied
component if one exists; otherwise a minimal local element).

## Out of scope

- **Pipeline auto-create** (`pages/api/pipeline/projects/[id]/transition.ts` →
  `createPlanningItem`) stays **ungated**. It is a system side-effect of a pipeline
  transition, already gated by the pipeline's own permission, and is best-effort /
  non-fatal. Requiring `planning.create` there would break valid pipeline flows.
- **Per-assignee edit limits** — explicitly not built (shared-board decision).
- No new roles, no changes to the RBAC tables/schema, no changes to `usePermission` or
  `requirePermission` themselves.

## Verification

- **Tests** (`tests/api/planning/items.test.ts`): for each verb assert
  `401` unauthenticated, `403` authenticated-without-permission, `200/201` permitted.
  Keep the existing "POST without token → 401" case.
- `npm run ci:quick` green (includes lint ratchet + the planning unit tests).
- **Browser check on dev** (`dev.fibreflow.app`) using a minted session:
  - contractor → no Planning nav entry; direct `GET /api/planning/items` → 403; board
    page shows Access Denied.
  - manager → board loads, can create/move; delete/cancel control hidden; `DELETE` API → 403.
  - admin → full board including delete.

## Files touched

- `scripts/migrations/sql/433_planning_rbac.sql` (new)
- `scripts/migrations/sql/rollback_433_planning_rbac.sql` (new)
- `app/api/planning/items/route.ts`
- `app/api/planning/items/[id]/route.ts`
- `app/(main)/planning/client.tsx`
- `app/(main)/planning/new/client.tsx`
- `app/(main)/planning/[id]/client.tsx`
- `src/components/layout/sidebar/config/planningSection.ts`
- `tests/api/planning/items.test.ts`
- (optional) `src/modules/planning/.claude.md` — note the RBAC key for future work
