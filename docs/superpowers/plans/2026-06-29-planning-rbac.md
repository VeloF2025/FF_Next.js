# Planning Module RBAC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-based access control to the Planning module — seed `planning` permissions, enforce them on every `app/api/planning/**` handler, and gate the UI — so the module is hidden/blocked for users without access and edit/delete follow the role matrix.

**Architecture:** Reuse the existing PostgreSQL RBAC system unchanged. A seed migration adds two permission keys (`planning` module + `planning.main` page) with role-default grants. The two App Router route handlers swap their ad-hoc cookie/JWT logic for the canonical `requirePermission()` helper. The three client pages wrap in the existing `ProtectedPage` component; the sidebar already references `rbacKey: 'planning.main'` and auto-hides once the permission exists.

**Tech Stack:** Next.js App Router route handlers (`NextRequest`/`NextResponse`), PostgreSQL (`access_permissions` / `role_permissions`), `@/lib/auth/app-router` (`requirePermission`), `@/components/PermissionGate` (`ProtectedPage` / `PermissionGate` / `useCanDo`), Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Worktree only:** all edits happen under `/home/hein/Workspace/FF_Next.js-wt-planning-rbac` (branch `feat/planning-rbac`). Never edit the main tree. Git write verbs must be `&&`-chained after `cd <worktree>` (the worktree-guard hook blocks otherwise).
- **No `console.log`** — use `createLogger`/`log` from `@/lib/logger`. No empty catch blocks. 100% types. Files <300 lines.
- **Gate key is `planning.main`** for all enforcement (server + client). The parent-cascade rule means `userHasPermission` automatically also honours a `planning` module-level block — but the migration must grant the `planning` module row too, or the cascade forces children to `false`.
- **Permission actions are exactly:** `view`, `create`, `edit`, `delete`.
- **Role matrix (applied to BOTH `planning` and `planning.main`):**
  | role | view | create | edit | delete |
  |---|:-:|:-:|:-:|:-:|
  | super_admin | ✓ | ✓ | ✓ | ✓ |
  | admin | ✓ | ✓ | ✓ | ✓ |
  | manager | ✓ | ✓ | ✓ | ✗ |
  | technician | ✓ | ✗ | ✗ | ✗ |
  | viewer | ✓ | ✗ | ✗ | ✗ |
  | contractor | ✗ | ✗ | ✗ | ✗ |
- **Out of scope:** the pipeline auto-create path (`pages/api/pipeline/projects/[id]/transition.ts` → `createPlanningItem`) stays ungated; no per-assignee edit limits; no schema/table changes.
- **CI floor:** `npm run ci:quick` must pass before PR. Never `--no-verify`.

---

### Task 1: RBAC seed migration (432) + rollback

Adds the two permission rows and role grants to the database. SQL seed — no Vitest cycle; verified by re-run idempotency and a count query. **Do not apply against the shared dev/prod DB ad hoc** — the file is created and committed here; application happens through the standard migration runner as a controlled step (see Step 5).

**Files:**
- Create: `scripts/migrations/sql/433_planning_rbac.sql`
- Create: `scripts/migrations/sql/rollback_433_planning_rbac.sql`

**Interfaces:**
- Produces: `access_permissions` rows with keys `planning` (type `module`) and `planning.main` (type `page`, parent `planning`); `role_permissions` rows for all 6 roles × both keys. Consumed at runtime by `userHasPermission()` (server) and `/api/admin/permissions/me` → `usePermission()` (client).

- [ ] **Step 1: Confirm 432 is still the next free number**

Run: `ls scripts/migrations/sql/ | grep -oE '^[0-9]+' | sort -n | tail -3`
Expected: highest is `431`. If a `432_*` already exists (parallel branch), use the next free integer and rename both files + update the rollback command in Step 5 accordingly.

- [ ] **Step 2: Write the forward migration**

Create `scripts/migrations/sql/433_planning_rbac.sql`:

```sql
-- Migration 433: RBAC — Planning module
-- Registers the `planning` module + `planning.main` page in access_permissions
-- and seeds role_permissions per the Standard matrix. Before this migration the
-- Planning sidebar referenced rbacKey 'planning.main' but no DB row existed, so
-- the API was ungated and the nav showed for everyone.
--
-- Idempotent: safe to re-run (ON CONFLICT DO UPDATE corrects drift).

BEGIN;

-- 1. Permission entries (module + its landing page).
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order)
VALUES
  ('module', 'planning',      NULL,       'Planning',       '/planning', 90),
  ('page',   'planning.main', 'planning', 'Planning Board', '/planning', 1)
ON CONFLICT (key) DO UPDATE
  SET type = EXCLUDED.type,
      parent_key = EXCLUDED.parent_key,
      label = EXCLUDED.label,
      route = EXCLUDED.route,
      updated_at = NOW();

-- 2. Role grants — Standard matrix, applied to BOTH keys so the parent cascade
--    does not force the page to false. super_admin also bypasses in code.
INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin', 'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('super_admin', 'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('admin',       'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('admin',       'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('manager',     'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": false}'::jsonb),
  ('manager',     'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": false}'::jsonb),
  ('technician',  'planning',      '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('technician',  'planning.main', '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('viewer',      'planning',      '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('viewer',      'planning.main', '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('contractor',  'planning',      '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
  ('contractor',  'planning.main', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE
  SET actions = EXCLUDED.actions,
      updated_at = NOW();

COMMIT;
```

- [ ] **Step 3: Write the rollback migration**

Create `scripts/migrations/sql/rollback_433_planning_rbac.sql`:

```sql
-- Rollback 432: remove Planning RBAC permissions and their role grants.
BEGIN;
DELETE FROM role_permissions   WHERE permission_key IN ('planning', 'planning.main');
DELETE FROM access_permissions WHERE key            IN ('planning.main', 'planning');
COMMIT;
```

- [ ] **Step 4: Static checks**

Run: `npx --yes sql-formatter --version >/dev/null 2>&1; node -e "const fs=require('fs');const s=fs.readFileSync('scripts/migrations/sql/433_planning_rbac.sql','utf8');if(!/BEGIN;[\s\S]*COMMIT;/.test(s))throw new Error('missing txn');if((s.match(/planning.main/g)||[]).length<7)throw new Error('expected 7 planning.main refs (1 perm + 6 roles)');console.log('OK: txn-wrapped, 7 planning.main rows')"`
Expected: `OK: txn-wrapped, 7 planning.main rows`

- [ ] **Step 5: Document the apply command (do NOT run here)**

Application is a controlled step (shared dev+prod DB). The runner is `npm run db:migrate` (tracks by filename in `schema_migrations`; idempotent ON CONFLICT means a re-run is harmless). Rollback: `npm run db:migrate rollback 432`. Post-apply verification query (run in a dev psql session — see `.claude/credentials.local.md`):

```sql
SELECT key, type, parent_key FROM access_permissions WHERE key LIKE 'planning%' ORDER BY key;
-- expect 2 rows: planning (module), planning.main (page, parent planning)
SELECT role, permission_key, actions FROM role_permissions
  WHERE permission_key IN ('planning','planning.main') ORDER BY role, permission_key;
-- expect 12 rows matching the matrix
```

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && git add scripts/migrations/sql/433_planning_rbac.sql scripts/migrations/sql/rollback_433_planning_rbac.sql && git commit -m "feat(planning): seed RBAC permissions (migration 433)"
```

---

### Task 2: Server-side enforcement — list/create route + test harness

Swap the ad-hoc cookie/JWT logic in the list/create handler for `requirePermission`, gating GET on `view` and POST on `create`. This task also rewrites the shared test file's auth mock (consumed by Task 3).

**Files:**
- Modify: `app/api/planning/items/route.ts`
- Modify (rewrite mock block + GET/POST cases): `tests/api/planning/items.test.ts`

**Interfaces:**
- Consumes: `requirePermission(req: NextRequest, key: string, action: 'view'|'create'|'edit'|'delete'): Promise<[AuthUser, null] | [null, NextResponse]>` from `@/lib/auth/app-router`. On allow returns `[user, null]` (`user.id` is the actor); on deny returns `[null, NextResponse]` (401 unauth / 403 no-permission).
- Produces: the `auth` hoisted mock object + `vi.mock('@/lib/auth/app-router', …)` block in the test file, reused by Task 3.

- [ ] **Step 1: Replace the test file's mock block + GET/POST cases (failing tests)**

Overwrite `tests/api/planning/items.test.ts` with the new mock harness and the GET/POST suites. (Task 3 appends the `[id]` suite — leave its imports `PUT, DELETE` in place.)

```ts
// tests/api/planning/items.test.ts
// Exercises the real App Router route handlers (list/create + [id]) with the
// service + RBAC auth boundary mocked. requirePermission is mocked so each test
// controls allow / 401 / 403 independently.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controls what requirePermission returns. user set => allowed; user null =>
// deny with denyStatus (401 unauth, 403 no-permission).
const auth = vi.hoisted(() => ({ user: null as null | { id: string }, denyStatus: 403 }));

vi.mock('@/lib/auth/app-router', () => ({
  requirePermission: vi.fn(async () => {
    if (auth.user) return [auth.user, null];
    const { NextResponse } = await import('next/server');
    return [null, NextResponse.json({ error: 'denied' }, { status: auth.denyStatus })];
  }),
}));

const svc = vi.hoisted(() => ({
  listPlanningItems: vi.fn(),
  createPlanningItem: vi.fn(),
  getPlanningItemById: vi.fn(),
  updatePlanningItem: vi.fn(),
  deletePlanningItem: vi.fn(),
  logPlanningActivity: vi.fn(),
}));
vi.mock('@/modules/planning/services/planningService', () => svc);

import { GET, POST } from '../../../app/api/planning/items/route';
import { PUT, DELETE, GET as GET_BY_ID } from '../../../app/api/planning/items/[id]/route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown) => ({ json: async () => body }) as never;
const urlReq = (url: string) => ({ url }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'user-123' }; // default: authenticated + permitted
  auth.denyStatus = 403;
});

describe('GET /api/planning/items', () => {
  it('returns 403 when the caller lacks planning view', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await GET(urlReq('http://localhost/api/planning/items'));
    expect(res.status).toBe(403);
    expect(svc.listPlanningItems).not.toHaveBeenCalled();
  });

  it('returns the paginated envelope when permitted', async () => {
    svc.listPlanningItems.mockResolvedValue({
      data: [], pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 },
    });
    const res = await GET(urlReq('http://localhost/api/planning/items'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.pagination).toHaveProperty('totalPages');
    expect(svc.listPlanningItems).toHaveBeenCalledTimes(1);
  });

  it('parses repeated exclude_stage params into a filter array', async () => {
    svc.listPlanningItems.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 } });
    await GET(urlReq('http://localhost/api/planning/items?exclude_stage=on_hold&exclude_stage=cancelled'));
    expect(svc.listPlanningItems).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_stage: ['on_hold', 'cancelled'] }),
    );
  });
});

describe('POST /api/planning/items', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await POST(req({ project_id: 'p', title: 'x' }));
    expect(res.status).toBe(401);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without create', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await POST(req({ project_id: 'p', title: 'x' }));
    expect(res.status).toBe(403);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects a body without project_id (400)', async () => {
    const res = await POST(req({ title: 'x' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid stage enum value (400)', async () => {
    const res = await POST(req({ project_id: 'p', title: 'x', stage: 'rogue' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('creates the item (201) with created_by from the authenticated user', async () => {
    svc.createPlanningItem.mockResolvedValue({ id: 'new-id', item_uid: 'PLN-1' });
    const res = await POST(req({ project_id: 'p', title: 'New plan' }));
    expect(res.status).toBe(201);
    expect(svc.createPlanningItem).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'p', title: 'New plan', created_by: 'user-123' }),
    );
  });
});
```

- [ ] **Step 2: Run the GET/POST suite to verify it fails**

Run: `npx vitest run tests/api/planning/items.test.ts -t "planning/items" 2>&1 | tail -20`
Expected: FAIL — current `route.ts` still imports `next/headers`/jwt and never calls `requirePermission`, so the 403/401 expectations fail (and `GET_BY_ID` import from Task 3's untouched file is fine). Also expected: a TS/import error is acceptable at this red stage.

- [ ] **Step 3: Rewrite the list/create handler**

Overwrite `app/api/planning/items/route.ts`:

```ts
// app/api/planning/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/app-router';
import { createLogger } from '@/lib/logger';
import {
  listPlanningItems,
  createPlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';
import { PLANNING_STAGES, PLANNING_PRIORITIES } from '@/modules/planning/constants/stages';

export const dynamic = 'force-dynamic';

const logger = createLogger('planning:api:items');

export async function GET(req: NextRequest) {
  const [, deny] = await requirePermission(req, 'planning.main', 'view');
  if (deny) return deny;
  try {
    const { searchParams } = new URL(req.url);
    const filters: PlanningFilters = {};
    if (searchParams.has('project_id')) filters.project_id = searchParams.get('project_id')!;
    if (searchParams.has('stage')) filters.stage = searchParams.get('stage') as PlanningStage;
    if (searchParams.has('exclude_stage')) filters.exclude_stage = searchParams.getAll('exclude_stage') as PlanningStage[];
    if (searchParams.has('assigned_to')) filters.assigned_to = searchParams.get('assigned_to')!;
    if (searchParams.has('search')) filters.search = searchParams.get('search')!;
    if (searchParams.has('created_after')) filters.created_after = new Date(searchParams.get('created_after')!);
    if (searchParams.has('created_before')) filters.created_before = new Date(searchParams.get('created_before')!);
    if (searchParams.has('page')) filters.page = parseInt(searchParams.get('page')!, 10);
    if (searchParams.has('pageSize')) filters.pageSize = parseInt(searchParams.get('pageSize')!, 10);

    const result = await listPlanningItems(filters);
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Failed to list planning items', { error });
    return NextResponse.json({ success: false, error: { message: 'Failed to list planning items' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const [user, deny] = await requirePermission(req, 'planning.main', 'create');
  if (deny) return deny;
  try {
    const body = await req.json();
    if (!body.project_id) return NextResponse.json({ success: false, error: { message: 'project_id is required' } }, { status: 400 });
    if (!body.title || !String(body.title).trim()) return NextResponse.json({ success: false, error: { message: 'title is required' } }, { status: 400 });
    if (body.stage && !PLANNING_STAGES.includes(body.stage)) return NextResponse.json({ success: false, error: { message: `Invalid stage. Must be one of: ${PLANNING_STAGES.join(', ')}` } }, { status: 400 });
    if (body.priority && !PLANNING_PRIORITIES.includes(body.priority)) return NextResponse.json({ success: false, error: { message: `Invalid priority. Must be one of: ${PLANNING_PRIORITIES.join(', ')}` } }, { status: 400 });

    body.created_by = user.id;

    const item = await createPlanningItem(body);
    void logPlanningActivity({
      planningItemId: item.id,
      activityType: 'created',
      note: `Planning item created: ${item.item_uid}`,
      userId: user.id,
    });

    return NextResponse.json(
      { success: true, data: item, message: 'Planning item created', meta: { timestamp: new Date().toISOString() } },
      { status: 201 },
    );
  } catch (error) {
    logger.error('Failed to create planning item', { error });
    return NextResponse.json({ success: false, error: { message: 'Failed to create planning item' } }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the GET/POST suite to verify it passes**

Run: `npx vitest run tests/api/planning/items.test.ts -t "planning/items"`
Expected: the `GET /api/planning/items` and `POST /api/planning/items` describe blocks PASS. (The `[id]` block is implemented in Task 3; if it errors now, that is expected until Task 3.)

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && git add app/api/planning/items/route.ts tests/api/planning/items.test.ts && git commit -m "feat(planning): RBAC-gate list/create API (view/create)"
```

---

### Task 3: Server-side enforcement — [id] route + tests

Gate the single-item handler: GET on `view`, PUT on `edit`, DELETE on `delete`. Replaces the ad-hoc `getUserId()` helper.

**Files:**
- Modify: `app/api/planning/items/[id]/route.ts`
- Modify (append `[id]` suite): `tests/api/planning/items.test.ts`

**Interfaces:**
- Consumes: the `auth` mock + `requirePermission` mock established in Task 2; `PUT`, `DELETE`, `GET_BY_ID` already imported in the test file.

- [ ] **Step 1: Append the [id] test suite (failing)**

Append to `tests/api/planning/items.test.ts`:

```ts
describe('GET /api/planning/items/[id]', () => {
  it('returns 403 when the caller lacks planning view', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await GET_BY_ID(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.getPlanningItemById).not.toHaveBeenCalled();
  });

  it('returns the item when permitted', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, title: 'x' });
    const res = await GET_BY_ID(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/planning/items/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without edit', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 404 when the item does not exist', async () => {
    svc.getPlanningItemById.mockResolvedValue(null);
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(404);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid stage enum value (400) before touching the DB', async () => {
    const res = await PUT(req({ stage: 'rogue' }), { params: { id: ID } });
    expect(res.status).toBe(400);
    expect(svc.getPlanningItemById).not.toHaveBeenCalled();
  });

  it('updates and logs with the authenticated user id', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, stage: 'intake' });
    svc.updatePlanningItem.mockResolvedValue({ id: ID, stage: 'hld' });
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(svc.logPlanningActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'stage_change', userId: 'user-123' }),
    );
  });
});

describe('DELETE /api/planning/items/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.deletePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without delete', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.deletePlanningItem).not.toHaveBeenCalled();
  });

  it('cancels the item when permitted', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, stage: 'intake' });
    svc.deletePlanningItem.mockResolvedValue({ id: ID, stage: 'cancelled' });
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(svc.deletePlanningItem).toHaveBeenCalledWith(ID);
  });
});
```

- [ ] **Step 2: Run the [id] suite to verify it fails**

Run: `npx vitest run tests/api/planning/items.test.ts -t "/api/planning/items/\\[id\\]" 2>&1 | tail -20`
Expected: FAIL — current `[id]/route.ts` returns 401 (not 403) for permission denial and 200 for unauthenticated GET, so the new expectations fail.

- [ ] **Step 3: Rewrite the [id] handler**

Overwrite `app/api/planning/items/[id]/route.ts`:

```ts
// app/api/planning/items/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/app-router';
import { createLogger } from '@/lib/logger';
import {
  getPlanningItemById,
  updatePlanningItem,
  deletePlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';
import { PLANNING_STAGES, PLANNING_PRIORITIES } from '@/modules/planning/constants/stages';

export const dynamic = 'force-dynamic';

const logger = createLogger('planning:api:items');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const [, deny] = await requirePermission(req, 'planning.main', 'view');
  if (deny) return deny;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const item = await getPlanningItemById(params.id);
    if (!item) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });
    return NextResponse.json({ success: true, data: item, meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to get planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to get planning item' } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const [user, deny] = await requirePermission(req, 'planning.main', 'edit');
  if (deny) return deny;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const body = await req.json();
    if (body.stage && !PLANNING_STAGES.includes(body.stage)) return NextResponse.json({ success: false, error: { message: `Invalid stage. Must be one of: ${PLANNING_STAGES.join(', ')}` } }, { status: 400 });
    if (body.priority && !PLANNING_PRIORITIES.includes(body.priority)) return NextResponse.json({ success: false, error: { message: `Invalid priority. Must be one of: ${PLANNING_PRIORITIES.join(', ')}` } }, { status: 400 });
    const before = await getPlanningItemById(params.id);
    if (!before) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });

    const updated = await updatePlanningItem(params.id, body);

    if (body.stage && body.stage !== before.stage) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'stage_change',
        fieldChanged: 'stage', oldValue: before.stage, newValue: body.stage, userId: user.id,
      });
    }
    if (body.assigned_to !== undefined && body.assigned_to !== before.assigned_to) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'assignment',
        fieldChanged: 'assigned_to', oldValue: before.assigned_to, newValue: body.assigned_to ?? null, userId: user.id,
      });
    }
    if (body.stage_checklists) {
      void logPlanningActivity({ planningItemId: params.id, activityType: 'checklist', userId: user.id });
    }

    return NextResponse.json({ success: true, data: updated, message: 'Planning item updated', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to update planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to update planning item' } }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const [user, deny] = await requirePermission(req, 'planning.main', 'delete');
  if (deny) return deny;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const existing = await getPlanningItemById(params.id);
    if (!existing) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });
    const deleted = await deletePlanningItem(params.id);
    void logPlanningActivity({ planningItemId: params.id, activityType: 'cancelled', note: 'Planning item cancelled', userId: user.id });
    return NextResponse.json({ success: true, data: deleted, message: 'Planning item cancelled', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to delete planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to delete planning item' } }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the full route test file to verify it passes**

Run: `npx vitest run tests/api/planning/items.test.ts`
Expected: ALL describe blocks PASS (GET/POST from Task 2 + the four `[id]` blocks).

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && git add app/api/planning/items/[id]/route.ts tests/api/planning/items.test.ts && git commit -m "feat(planning): RBAC-gate item API (view/edit/delete)"
```

---

### Task 4: UI gating — page guards, edit controls, nav cleanup

Wrap the three client pages in `ProtectedPage`, hide edit controls in the detail view behind `edit`, hide the "New" link behind `create`, and drop the dead `permissions: []` from the nav config. The API (Tasks 2–3) is the real boundary; this is defense-in-depth + UX. One component test proves the denied path renders Access Denied.

**Files:**
- Modify: `app/(main)/planning/client.tsx`
- Modify: `app/(main)/planning/new/client.tsx`
- Modify: `app/(main)/planning/[id]/client.tsx`
- Modify: `src/modules/planning/components/PlanningItemDetail.tsx`
- Modify: `src/components/layout/sidebar/config/planningSection.ts`
- Create: `app/(main)/planning/__tests__/PlanningPageClient.test.tsx`

**Interfaces:**
- Consumes: `ProtectedPage` / `PermissionGate` from `@/components/PermissionGate`; `useCanDo(key, action)` from `@/hooks/usePermission`. `ProtectedPage` renders `<AccessDenied/>` when `can(key, action)` is false and a spinner while `isLoading`.

- [ ] **Step 1: Write the failing component test (board denied path)**

Create `app/(main)/planning/__tests__/PlanningPageClient.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningPageClient from '../client';

// Deny everything: ProtectedPage must show AccessDenied and never render the board.
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    can: () => false,
    canAny: () => false,
    canAll: () => false,
    isLoading: false,
    permissions: [],
  }),
}));

// useUrlFilters touches next/navigation — stub it so the page renders in jsdom.
vi.mock('@/hooks/useUrlFilters', () => ({
  useUrlFilters: () => ({ filters: { project: '', stage: '', search: '' }, setFilter: vi.fn(), clearAll: vi.fn() }),
}));

describe('PlanningPageClient RBAC gate', () => {
  it('renders Access Denied and not the board when view is denied', () => {
    render(<PlanningPageClient />);
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.queryByText('New Planning Item')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "app/(main)/planning/__tests__/PlanningPageClient.test.tsx"`
Expected: FAIL — current `client.tsx` has no gate, so it renders "New Planning Item" and there is no "Access Denied" text.

- [ ] **Step 3: Gate the board page + create link**

Overwrite `app/(main)/planning/client.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { ProtectedPage, PermissionGate } from '@/components/PermissionGate';
import { KanbanBoard } from '@/modules/planning/components/KanbanBoard';
import { PlanningFilterBar } from '@/modules/planning/components/PlanningFilterBar';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';

export default function PlanningPageClient() {
  const { filters, setFilter, clearAll } = useUrlFilters({ project: '', stage: '', search: '' });

  const boardFilters: PlanningFilters = useMemo(() => ({
    project_id: filters.project || undefined,
    stage: (filters.stage || undefined) as PlanningStage | undefined,
    search: filters.search || undefined,
  }), [filters.project, filters.stage, filters.search]);

  return (
    <ProtectedPage permission="planning.main" action="view">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Planning</h1>
          <PermissionGate permission="planning.main" action="create">
            <Link href="/planning/new" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">New Planning Item</Link>
          </PermissionGate>
        </div>
        <PlanningFilterBar
          value={filters}
          onChange={(k, v) => setFilter(k, v)}
          onClear={clearAll}
        />
        <KanbanBoard filters={boardFilters} />
      </div>
    </ProtectedPage>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `npx vitest run "app/(main)/planning/__tests__/PlanningPageClient.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Gate the "new" page on `create`**

In `app/(main)/planning/new/client.tsx`: add the import and wrap the returned JSX. Add after the existing `import type { Project } …` line:

```tsx
import { ProtectedPage } from '@/components/PermissionGate';
```

Replace the outer `return ( <div className="p-6 max-w-2xl"> … </div> );` so the `<div>` is wrapped:

```tsx
  return (
    <ProtectedPage permission="planning.main" action="create">
      <div className="p-6 max-w-2xl">
        {/* …existing h1 + form unchanged… */}
      </div>
    </ProtectedPage>
  );
```

(Keep the `<h1>` and `<form>` exactly as they are — only the wrapper changes.)

- [ ] **Step 6: Gate the detail page on `view`**

Overwrite `app/(main)/planning/[id]/client.tsx`:

```tsx
'use client';
import { useParams } from 'next/navigation';
import { ProtectedPage } from '@/components/PermissionGate';
import { PlanningItemDetail } from '@/modules/planning/components/PlanningItemDetail';

export default function PlanningDetailClient() {
  const params = useParams();
  const id = params?.id as string;
  return (
    <ProtectedPage permission="planning.main" action="view">
      <div className="p-6"><PlanningItemDetail itemId={id} /></div>
    </ProtectedPage>
  );
}
```

- [ ] **Step 7: Disable edit controls in the detail view when the user lacks `edit`**

In `src/modules/planning/components/PlanningItemDetail.tsx`:

Add the hook import after `import { log } from '@/lib/logger';`:

```tsx
import { useCanDo } from '@/hooks/usePermission';
```

Inside the component, add `canEdit` next to the other hooks (after `const [openStage, setOpenStage] = useState<BoardStage | null>(null);`):

```tsx
  const canEdit = useCanDo('planning.main', 'edit');
```

Gate the two stage-move buttons by adding `|| !canEdit` to each `disabled` expression:

```tsx
        <button
          disabled={currentIndex <= 0 || !canEdit}
          onClick={() => { const s = STAGE_FLOW[currentIndex - 1]; if (s) moveStage(s); }}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >← Previous stage</button>
        <button
          disabled={currentIndex < 0 || currentIndex >= STAGE_FLOW.length - 1 || !canEdit}
          onClick={() => { const s = STAGE_FLOW[currentIndex + 1]; if (s) moveStage(s); }}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >Next stage →</button>
```

Disable the checklist checkboxes for non-editors — change the checkbox input:

```tsx
                      <input type="checkbox" checked={c.done} disabled={!canEdit} onChange={() => toggleChecklist(key, c.id)} />
```

- [ ] **Step 8: Remove the dead `permissions: []` from the nav config**

In `src/components/layout/sidebar/config/planningSection.ts`, delete the line `permissions: [],` from the single item (the `rbacKey: 'planning.main'` line already drives gating via `sidebarUtils.ts`).

> Verify the `permissions` field is optional on the item type before removing. Run: `grep -nE "permissions" src/components/layout/sidebar/types.ts` — if `permissions` is a required field on the item type, leave the line as `permissions: [],` (cosmetic only) instead of deleting it.

- [ ] **Step 9: Typecheck the touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E "planning" | head` (expect no planning-related errors) and `npx vitest run "app/(main)/planning/__tests__/PlanningPageClient.test.tsx" tests/api/planning/items.test.ts` (expect PASS).

- [ ] **Step 10: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && git add "app/(main)/planning" src/modules/planning/components/PlanningItemDetail.tsx src/components/layout/sidebar/config/planningSection.ts && git commit -m "feat(planning): gate UI with PermissionGate + ProtectedPage"
```

---

### Task 5: Full verification + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the quick CI gate**

Run: `cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && npm run ci:quick`
Expected: PASS (lint ratchet + unit tests, including the two new/updated planning test files). Fix any regression — never `--no-verify`.

- [ ] **Step 2: Apply migration 433 in dev and verify the rows**

Apply via the runner (controlled step), then run the two verification queries from Task 1 Step 5 against the dev DB. Expected: 2 `access_permissions` rows + 12 `role_permissions` rows matching the matrix.

- [ ] **Step 3: Browser verification on dev**

Using the session/credential pattern (mint a session per `feedback_mint_my_session_for_local_verify.md` / `.claude/credentials.local.md`), verify on `dev.fibreflow.app` (or local `PORT=3004 npm run dev`):
- **contractor:** no "Planning" entry in the sidebar; `GET /api/planning/items` → 403; visiting `/planning` shows the Access Denied panel.
- **manager:** board loads; can create and move cards; `DELETE /api/planning/items/<id>` → 403.
- **admin:** board loads; create, move, and delete all succeed.

Capture a screenshot of each role's `/planning` view as evidence.

- [ ] **Step 4: Push and open the PR**

```bash
cd /home/hein/Workspace/FF_Next.js-wt-planning-rbac && git push -u origin feat/planning-rbac
gh pr create --title "feat(planning): add RBAC to the Planning module" --body "Seeds planning/planning.main permissions (migration 433, Standard role matrix), enforces them on every app/api/planning handler via requirePermission, and gates the UI (ProtectedPage + PermissionGate). Reads now require view; create/edit/delete follow the role matrix. Pipeline auto-create stays ungated by design. Spec: docs/superpowers/specs/2026-06-29-planning-rbac-design.md"
```

Then follow the project review-and-merge rule: invoke `/review` (blind reviewer), wait for CI on the self-hosted runner, merge only after both pass. Note in the PR that **migration 433 must be applied** (shared dev+prod DB) as part of the deploy.

---

## Self-Review

**Spec coverage:**
- Seed migration (2 perms + role matrix) → Task 1 ✓
- Server enforcement on both handlers (view/create/edit/delete; reads gated) → Tasks 2, 3 ✓
- Nav auto-hide + dead-field cleanup → Task 4 Step 8 ✓
- Page-level Access Denied + create/edit control gating → Task 4 ✓
- Out-of-scope (pipeline auto-create ungated, no per-assignee) → honoured (no task touches `transition.ts`) ✓
- Tests (401/403/200 per verb) → Tasks 2, 3 ✓; verification (ci:quick + browser per role) → Task 5 ✓

**Placeholder scan:** No TBD/TODO; every code step shows full file or exact edit. The migration-apply and browser steps are intentionally manual (shared DB / live auth), with exact commands/queries given.

**Type consistency:** `requirePermission(req, 'planning.main', action)` tuple `[user, deny]` used identically across Tasks 2–3; `user.id` is the actor everywhere; the test `auth` mock (`user`, `denyStatus`) is defined in Task 2 and reused in Task 3; `useCanDo('planning.main','edit')` matches the hook's exported signature. Gate key is `planning.main` throughout (server + client + migration).
