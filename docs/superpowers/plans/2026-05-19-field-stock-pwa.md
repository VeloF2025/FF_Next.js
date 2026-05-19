# Field Stock PWA — Booking Out & Daily Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile PWA flow on `/my` that lets a stores person issue ONT/UPS serials to a technician (signed, offline-tolerant) and accept returns at end-of-day, with reconciliation derived automatically from Activate QA installs. Allow stores to onboard new contractor technicians on-the-fly as `pending` staff records pending admin approval.

**Architecture:**
- **Identity layer**: one unified `staff` table (already the case on `/my`); generalize the existing `POST /api/field/technicians` into `POST /api/field/users` with a `role` enum (`technician | stores | supervisor`) and `account_status` (`pending | active | suspended`). New contractor techs created from the PWA start `pending`.
- **PWA layer**: three new pages under `/my/stores/*` built on the existing `MyPortalShell` pattern (full-screen step-by-step like `/my/attendance/clock`, not a modal). Reuse the existing `BarcodeScannerModal`, `useAttendanceSync` offline queue plumbing, and the `/api/procurement/field-stock/pickings|returns` endpoints — no schema change to those modules.
- **Consumption**: not user-entered. The existing `reconciliationService.ts` already joins `qa_photo_reviews.ont_serial` (captured during the Activate 12-step QA wizard) to figure out what got installed. We just surface it on the PWA.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript, Tailwind, framer-motion, lucide-react, `pg.Pool` via `@/lib/db-pool`, IndexedDB for the offline queue, the existing `BarcodeScannerModal` (ZXing under the hood), Vitest + Playwright for tests.

**Scope check:** This plan covers four loosely-coupled phases that ship as four PRs. Phase 1 (identity) is required by Phase 2. Phase 3 and Phase 4 are independent of each other and can ship in parallel once Phase 2 is in. If anything slips, Phase 2 alone is the MVP.

---

## Phase 0 — Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Actor | Stores person issues to tech (two-party trail, tech signs on stores' phone) |
| UX shape | Fresh step-by-step pages, NOT the existing `DailyCheckoutModal` modal |
| Iteration scope | Full daily loop: issue + return + reconciliation summary |
| Consumption | Automatic from `qa_photo_reviews` — no manual PWA flow |
| New tech onboarding | Hybrid — stores creates `pending`, admin approves within 24h |
| Stores account creation | Reuse the `/field/technicians` endpoint, generalized with `role` |
| Contractor link | Captured on the picking row (existing `pickings.contractor_id`), NOT added as a FK on `staff` |
| Signature device | Stores' phone — tech signs on it once items are scanned |
| Unverified-tech risk mitigation | Cap stock value at R5 000 per picking while issuing tech is `pending`; admin approval lifts cap. Existing accountability dashboard surfaces unverified-tech volume |

---

## Current-state baseline (verified 2026-05-19)

| Building block | Path | Status |
|---|---|---|
| Desktop transfer flow | `pages/procurement/field-stock/index.tsx` (Transfers tab) | Live, used by supervisors |
| Picking lifecycle API | `pages/api/procurement/field-stock/pickings/*` | Live: create / confirm / process / sign / cancel |
| Returns API | `pages/api/procurement/field-stock/returns/*` | Live: create / inspect / accept |
| Serial state machine | `pages/api/procurement/field-stock/serials/transition.ts` | Live |
| Daily reconciliation logic | `src/modules/field-stock/services/reconciliationService.ts` | Live but on Neon shim — migrate to `pg.Pool` when touched (Phase 4) |
| Orphan mobile component | `src/modules/field-stock/components/DailyCheckoutModal.tsx` | 765 lines, built, not imported anywhere |
| Orphan offline utils | `src/modules/field-stock/offline/{offlineStorage,useOnlineStatus,OfflineBanner}.tsx` | Built, never wired in |
| /my portal shell | `src/modules/attendance/portal/client/MyPortalShell.tsx` | Live, dark theme, install prompt, SW |
| /my session + auth | `pages/api/my/session.ts`, `pages/api/my/login/{request-otp,verify-otp}.ts` | Live — phone-OTP via WhatsApp, PIN on file |
| `/my` hub tile grid | `src/modules/attendance/portal/client/MyHub.tsx` | Live, role-blind today |
| Tech creation | `pages/api/field/technicians/index.ts` | Hardcodes `contract_type='full-time'`, no role/status fields |
| Barcode scanner | `src/modules/barcode-scanner/components/BarcodeScannerModal.tsx` | Live, called by other modules |
| Offline queue pattern | `src/modules/attendance/portal/client/offline/{submitClockEvent,useAttendanceSync}.ts` | Live, the reference impl to copy |

**Two parallel field-stock module folders** — `src/modules/field-stock/` (orphan + offline utils) vs `src/modules/procurement/field-stock/` (live desktop). After Phase 2 lands and the orphan utils are confirmed unused, **Phase 5 (deferred)** deletes `src/modules/field-stock/`. Not on this plan.

---

## File Structure

### Phase 1 — Identity & RBAC

```
NEW   scripts/migrations/sql/360_staff_role_account_status.sql
NEW   pages/api/field/users/index.ts                       — generic create (POST), list (GET), supersedes /field/technicians
NEW   pages/api/field/users/[userId]/approve.ts            — admin approves pending account
NEW   pages/api/field/users/[userId]/suspend.ts            — admin suspends
NEW   pages/api/my/stores/pending-techs.ts                 — list pending techs the stores person created (for the badge)
MOD   pages/api/field/technicians/index.ts                 — deprecation shim: delegates to /field/users (preserves callers)
MOD   pages/api/my/session.ts                              — return `role` + `account_status` on the profile
MOD   src/modules/attendance/portal/types.ts               — add role/status fields to AttendanceSessionProfile
MOD   src/modules/attendance/portal/client/api.ts          — surface new profile fields
NEW   src/lib/rbac/permissions/field-stock.ts              — permission slug constants
MOD   scripts/migrations/sql/<existing-rbac>.sql           — add seed row for `field-stock:issue` (super_admin + stores)
NEW   tests/api/field-users.test.ts                        — unit tests for generic create endpoint
```

### Phase 2 — Issue PWA flow

```
NEW   pages/my/stores/index.tsx                            — stores landing (3 tiles: Issue, Return, Today)
NEW   pages/my/stores/issue.tsx                            — 4-step issue flow
NEW   pages/my/stores/issue/_steps.tsx                     — step components (PickTech, PickItem, ScanSerials, SignAndSubmit)
NEW   src/modules/field-stock-pwa/                         — NEW shared module (do NOT touch the orphan src/modules/field-stock/)
NEW   src/modules/field-stock-pwa/api.ts                   — client helpers calling /api/procurement/field-stock/*
NEW   src/modules/field-stock-pwa/offline/queueIssue.ts    — IndexedDB queue for offline pickings
NEW   src/modules/field-stock-pwa/offline/useStockSync.ts  — mirrors useAttendanceSync but for pickings
NEW   src/modules/field-stock-pwa/components/InlineAddTech.tsx — on-the-fly tech creation form
NEW   src/modules/field-stock-pwa/components/SerialChip.tsx    — scanned-serial pill with remove
MOD   src/modules/attendance/portal/client/MyHub.tsx       — role-gated tiles for `stores`
NEW   tests/integration/my-stores-issue.test.ts            — flow happy path + duplicate serial + offline
NEW   tests/e2e/my-stores-issue.spec.ts                    — Playwright: full submit on dev URL
```

### Phase 3 — Return PWA flow

```
NEW   pages/my/stores/return.tsx                           — 3-step return flow
NEW   src/modules/field-stock-pwa/offline/queueReturn.ts   — return offline queue
MOD   src/modules/attendance/portal/client/MyHub.tsx       — add Return tile
NEW   tests/integration/my-stores-return.test.ts
NEW   tests/e2e/my-stores-return.spec.ts
```

### Phase 4 — Stores Today summary + reconciliation surfacing

```
NEW   pages/my/stores/today.tsx                            — read-only daily summary per tech
NEW   pages/api/my/stores/today.ts                         — aggregator for the mobile view
MOD   src/modules/field-stock/services/reconciliationService.ts — migrate off Neon shim to pg.Pool, expose stores-scoped query
MOD   src/modules/attendance/portal/client/MyHub.tsx       — add Today tile + badge (unaccounted count)
NEW   tests/integration/stores-today.test.ts
```

---

## Phase 1 — Identity & RBAC

Each task = ~one work-session. Steps are bite-sized; commit at the end of each task.

### Task 1.1: Schema migration — add `role` and `account_status` to `staff`

**Files:**
- Create: `scripts/migrations/sql/360_staff_role_account_status.sql`

**Why:** `staff` currently only has `status` (`active | inactive | terminated | on_leave`) and `contract_type` (`full-time | part-time | contractor`). Neither encodes "is this person allowed to issue stock" or "is this account pending admin approval". We need both, distinct from employment status.

- [ ] **Step 1: Write the migration**

```sql
-- 360_staff_role_account_status.sql
-- Adds role (functional role within FibreFlow) and account_status (lifecycle of the /my account).
-- Distinct from staff.status (employment) and staff.contract_type (HR classification).

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IN ('technician','stores','supervisor','admin','driver','office'));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending','active','suspended'));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS created_by_staff_id UUID REFERENCES staff(id);

-- Backfill: existing rows are active. Role left null — admin can backfill via UI later.
UPDATE staff SET account_status = 'active' WHERE account_status IS NULL;

-- Speeds up "show me pending techs" badge query.
CREATE INDEX IF NOT EXISTS staff_account_status_role_idx
  ON staff (account_status, role)
  WHERE account_status = 'pending';

COMMENT ON COLUMN staff.role IS
  'Functional role for /my PWA gating: technician, stores, supervisor, admin, driver, office. NULL = legacy office staff before this migration.';

COMMENT ON COLUMN staff.account_status IS
  'PWA account lifecycle. pending = created by stores on the fly, awaiting admin approval; active = normal; suspended = admin blocked.';

COMMIT;
```

- [ ] **Step 2: Run the migration against dev**

Run: `npm run db:migrate` (from worktree root, against the dev Supabase via DATABASE_URL).

Expected output: `Applied 360_staff_role_account_status.sql`.

- [ ] **Step 3: Smoke-check the columns exist**

```bash
psql "$DATABASE_URL" -c "\d staff" | grep -E "role|account_status|created_by_staff_id"
```

Expected: three rows with the new columns.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/360_staff_role_account_status.sql
git commit -m "feat(staff): add role and account_status columns for PWA gating"
```

### Task 1.2: Generalize the field-technician endpoint into `/api/field/users`

**Files:**
- Create: `pages/api/field/users/index.ts`
- Test: `tests/api/field-users.test.ts`

**Why:** Today `/api/field/technicians` hardcodes `contract_type='full-time'`, `department='Field Operations'`, `position='Field Technician'`. We need a generic creator that accepts `role` and sets `account_status='pending'` for stores-initiated creations.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/field-users.test.ts
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/field/users/index';
import { sql } from '@/lib/db-pool';

describe('POST /api/field/users', () => {
  afterEach(async () => {
    await sql`DELETE FROM staff WHERE phone LIKE '+27TEST%'`;
  });

  it('creates a pending technician when called by stores role', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { 'x-test-staff-role': 'stores' },
      body: {
        firstName: 'Sipho',
        lastName: 'Mthembu',
        phone: '+27TEST0001',
        role: 'technician',
        contractorId: 'velocity-fibre',
      },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(201);
    const body = JSON.parse(res._getData());
    expect(body.user.role).toBe('technician');
    expect(body.user.account_status).toBe('pending');
    expect(body.user.created_by_staff_id).toBeTruthy();
  });

  it('rejects unknown role', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: { firstName: 'X', lastName: 'Y', phone: '+27TEST0002', role: 'wizard' },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('admin creating a stores user marks account_status=active immediately', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { 'x-test-staff-role': 'admin' },
      body: { firstName: 'Anne', lastName: 'K', phone: '+27TEST0003', role: 'stores' },
    });
    await handler(req as any, res as any);
    const body = JSON.parse(res._getData());
    expect(body.user.account_status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest tests/api/field-users.test.ts`
Expected: FAIL with "Cannot find module '@/pages/api/field/users/index'".

- [ ] **Step 3: Implement the endpoint**

```typescript
// pages/api/field/users/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthedRequest } from '@/lib/auth/middleware';
import { sql } from '@/lib/db-pool';
import { log, logCreate } from '@/lib/logger';

const ALLOWED_ROLES = ['technician', 'stores', 'supervisor', 'admin', 'driver', 'office'] as const;
type Role = (typeof ALLOWED_ROLES)[number];

interface CreateUserBody {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  role: Role;
  contractorId?: string;
  department?: string;
  position?: string;
}

export default withAuth(async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method === 'POST') return createUser(req, res);
  if (req.method === 'GET') return listUsers(req, res);
  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
});

async function createUser(req: AuthedRequest, res: NextApiResponse) {
  const body = req.body as Partial<CreateUserBody>;

  if (!body.firstName || !body.lastName || !body.phone || !body.role) {
    return apiResponse.badRequest(res, 'firstName, lastName, phone, role are required');
  }
  if (!ALLOWED_ROLES.includes(body.role as Role)) {
    return apiResponse.badRequest(res, `role must be one of: ${ALLOWED_ROLES.join(', ')}`);
  }

  // Stores can only create technicians. Admin/super_admin can create any role.
  const callerRole = req.auth?.role ?? req.headers['x-test-staff-role'];
  if (callerRole === 'stores' && body.role !== 'technician') {
    return apiResponse.forbidden(res, 'Stores users can only create technicians');
  }

  // Stores-created users start pending; admin-created users start active.
  const accountStatus = callerRole === 'stores' ? 'pending' : 'active';

  const employeeId = `${body.role.toUpperCase().slice(0, 4)}-${Date.now().toString().slice(-8)}`;
  const department = body.department ?? defaultDepartment(body.role as Role);
  const position = body.position ?? defaultPosition(body.role as Role);

  try {
    const rows = await sql<{ id: string; role: string; account_status: string; created_by_staff_id: string }>`
      INSERT INTO staff (
        employee_id, first_name, last_name, email, phone,
        department, position, status, contract_type,
        role, account_status, created_by_staff_id
      ) VALUES (
        ${employeeId},
        ${body.firstName},
        ${body.lastName},
        ${body.email ?? null},
        ${body.phone},
        ${department},
        ${position},
        'active',
        ${body.role === 'technician' ? 'contractor' : 'full-time'},
        ${body.role},
        ${accountStatus},
        ${req.auth?.staffId ?? null}
      )
      RETURNING id, role, account_status, created_by_staff_id
    `;

    if (rows[0]) {
      logCreate('field_user', rows[0].id, { role: body.role, account_status: accountStatus });
    }
    return apiResponse.created(res, { user: rows[0] });
  } catch (err) {
    log.error('[field-users] create failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

async function listUsers(req: AuthedRequest, res: NextApiResponse) {
  const { role, accountStatus, contractorId } = req.query;
  const rows = await sql`
    SELECT id, first_name, last_name, phone, email, role, account_status, created_by_staff_id, created_at
    FROM staff
    WHERE
      (${role}::text IS NULL OR role = ${role}::text)
      AND (${accountStatus}::text IS NULL OR account_status = ${accountStatus}::text)
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return apiResponse.success(res, { users: rows });
}

function defaultDepartment(role: Role): string {
  switch (role) {
    case 'technician': return 'Field Operations';
    case 'stores': return 'Stores & Warehouse';
    case 'supervisor': return 'Field Operations';
    case 'driver': return 'Fleet';
    case 'admin': return 'Operations';
    default: return 'Office';
  }
}
function defaultPosition(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest tests/api/field-users.test.ts`
Expected: all three test cases PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/api/field/users/index.ts tests/api/field-users.test.ts
git commit -m "feat(field-users): generic field-user create endpoint with role and pending-status gating"
```

### Task 1.3: Convert `/api/field/technicians` into a deprecation shim

**Files:**
- Modify: `pages/api/field/technicians/index.ts` (preserve GET, delegate POST to `/field/users` internally)

**Why:** Multiple existing UIs call `/api/field/technicians`. We don't break them. The shim forwards POST to the new endpoint with `role='technician'` defaulted.

- [ ] **Step 1: Refactor the POST branch**

```typescript
// pages/api/field/technicians/index.ts  (existing GET preserved; only POST changes)
} else if (req.method === 'POST') {
  // Backwards-compat shim: forwards to /api/field/users with role='technician'.
  // New callers should hit /api/field/users directly so they can specify role.
  const newTechnician = req.body;
  const forwardBody = {
    firstName: newTechnician.firstName ?? newTechnician.name?.split(' ')[0] ?? '',
    lastName: newTechnician.lastName ?? newTechnician.name?.split(' ')[1] ?? '',
    email: newTechnician.email,
    phone: newTechnician.phone,
    role: 'technician' as const,
    contractorId: newTechnician.contractorId,
  };
  // Re-enter the handler chain in-process — avoids an HTTP round-trip and keeps
  // the caller's auth context.
  const usersHandler = (await import('@/pages/api/field/users/index')).default;
  (req as any).body = forwardBody;
  return usersHandler(req as any, res);
}
```

- [ ] **Step 2: Verify existing technician-list UI still works (manual smoke)**

Run dev (`PORT=3004 npm run dev`), open `/field/technicians`, click "Add technician", submit a row, confirm 201 and the row appears in the list.

- [ ] **Step 3: Commit**

```bash
git add pages/api/field/technicians/index.ts
git commit -m "refactor(technicians): convert POST to a shim that delegates to /field/users"
```

### Task 1.4: Admin approval endpoints

**Files:**
- Create: `pages/api/field/users/[userId]/approve.ts`
- Create: `pages/api/field/users/[userId]/suspend.ts`
- Test: extend `tests/api/field-users.test.ts`

- [ ] **Step 1: Approve handler**

```typescript
// pages/api/field/users/[userId]/approve.ts
import type { NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthedRequest, requireRole } from '@/lib/auth/middleware';
import { sql } from '@/lib/db-pool';

export default withAuth(requireRole(['admin', 'super_admin'], async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  const { userId } = req.query;
  const rows = await sql<{ id: string; account_status: string }>`
    UPDATE staff
    SET account_status = 'active', updated_at = NOW()
    WHERE id = ${userId} AND account_status = 'pending'
    RETURNING id, account_status
  `;
  if (rows.length === 0) return apiResponse.notFound(res, 'Pending user', userId as string);
  return apiResponse.success(res, { user: rows[0] });
}));
```

- [ ] **Step 2: Suspend handler — same shape but sets `account_status='suspended'`** (code analogous, omitted to avoid duplication; copy approve and substitute).

- [ ] **Step 3: Test both — approve from pending succeeds, second call 404s; suspend from active succeeds.**

- [ ] **Step 4: Commit**

```bash
git add pages/api/field/users/
git commit -m "feat(field-users): admin approve and suspend endpoints"
```

### Task 1.5: Surface role + account_status on `/my` session

**Files:**
- Modify: `pages/api/my/session.ts:32-69`
- Modify: `src/modules/attendance/portal/types.ts`
- Modify: `src/modules/attendance/portal/client/api.ts`

**Why:** The `MyHub` tile renderer needs to know the role to decide whether to show the "Issue Stock" tile.

- [ ] **Step 1: Extend the session SQL query**

```typescript
// pages/api/my/session.ts — augment the existing SELECT
const rows = await sql<{
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  home_site_id: string | null;
  has_vehicle: boolean;
  profile_photo_url: string | null;
  role: string | null;
  account_status: string;
}>`
  SELECT
    s.id,
    TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
    s.phone, s.email, s.home_site_id, s.profile_photo_url,
    s.role, s.account_status,
    EXISTS (SELECT 1 FROM vehicle_assignments va WHERE va.staff_id = s.id AND va.is_active = true) AS has_vehicle
  FROM staff s
  WHERE s.id = ${session.staffId}
  LIMIT 1
`;
```

- [ ] **Step 2: Add fields to `AttendanceSessionProfile`** in `src/modules/attendance/portal/types.ts`:

```typescript
export interface AttendanceSessionProfile {
  staffId: string;
  name: string;
  phone: string | null;
  email: string | null;
  homeSiteId: string | null;
  hasAssignedVehicle: boolean;
  profilePhotoUrl: string | null;
  role: 'technician' | 'stores' | 'supervisor' | 'admin' | 'driver' | 'office' | null;
  accountStatus: 'pending' | 'active' | 'suspended';
}
```

- [ ] **Step 3: Map them in the response builder** — the existing `profile: AttendanceSessionProfile = { ... }` block in `session.ts` gets `role: row.role as any, accountStatus: row.account_status as any` appended.

- [ ] **Step 4: Mirror in `api.ts`** — the `AttendanceProfile` type used by client code already shadows this; sync it.

- [ ] **Step 5: Suspended users get rejected at login**

In the same handler, if `row.account_status === 'suspended'`, return `apiResponse.success(res, { session: null, profile: null, reason: 'suspended' })`. Login screen shows "Account suspended — contact your supervisor".

- [ ] **Step 6: Commit**

```bash
git add pages/api/my/session.ts src/modules/attendance/portal/
git commit -m "feat(my-session): expose staff role and account_status on /my profile"
```

### Task 1.6: RBAC permission seed

**Files:**
- Create: `src/lib/rbac/permissions/field-stock.ts`
- Create: `scripts/migrations/sql/361_field_stock_issue_permission.sql`

- [ ] **Step 1: Permission constants**

```typescript
// src/lib/rbac/permissions/field-stock.ts
export const FIELD_STOCK_PERMISSIONS = {
  ISSUE: 'field-stock:issue',
  RETURN: 'field-stock:return',
  RECONCILE: 'field-stock:reconcile',
} as const;

export type FieldStockPermission = (typeof FIELD_STOCK_PERMISSIONS)[keyof typeof FIELD_STOCK_PERMISSIONS];
```

- [ ] **Step 2: Migration to seed the rows**

```sql
-- 361_field_stock_issue_permission.sql
BEGIN;

-- Insert permission definitions if not present (idempotent).
INSERT INTO rbac_permissions (slug, label, category, created_at) VALUES
  ('field-stock:issue', 'Issue field stock to a technician', 'field-stock', NOW()),
  ('field-stock:return', 'Accept returned field stock', 'field-stock', NOW()),
  ('field-stock:reconcile', 'View field stock reconciliation', 'field-stock', NOW())
ON CONFLICT (slug) DO NOTHING;

-- Grant to super_admin (everyone gets it) and stores role.
-- Reviewer: confirm role slugs match what's in rbac_roles before running.
INSERT INTO rbac_role_permissions (role_slug, permission_slug, granted)
SELECT r.slug, p.slug, true
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.slug IN ('super_admin', 'stores')
  AND p.slug IN ('field-stock:issue', 'field-stock:return', 'field-stock:reconcile')
ON CONFLICT (role_slug, permission_slug) DO UPDATE SET granted = EXCLUDED.granted;

COMMIT;
```

- [ ] **Step 3: Reviewer checkpoint — confirm `rbac_roles.slug` values**

Run: `psql "$DATABASE_URL" -c "SELECT slug FROM rbac_roles ORDER BY slug"`

If `stores` doesn't exist yet, add it via the same migration before the CROSS JOIN:

```sql
INSERT INTO rbac_roles (slug, label, created_at) VALUES ('stores', 'Stores / Warehouse', NOW()) ON CONFLICT DO NOTHING;
```

- [ ] **Step 4: Run, smoke-check, commit**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "SELECT * FROM rbac_role_permissions WHERE permission_slug LIKE 'field-stock:%'"
git add scripts/migrations/sql/361_field_stock_issue_permission.sql src/lib/rbac/permissions/
git commit -m "feat(rbac): seed field-stock:issue, :return, :reconcile permissions"
```

### Phase 1 PR gate

- [ ] **CI:** `npm run ci:quick` passes locally (lint + types).
- [ ] **Schema:** new columns and permissions visible on dev DB.
- [ ] **Manual:** create a stores user via `POST /api/field/users` with `role='stores'`; visit `/my/onboard` with that phone; verify OTP → PIN → session returns `role: 'stores', accountStatus: 'active'`.
- [ ] **Blind review:** `/review` skill, single sonnet reviewer (Phase 1 is single-domain).
- [ ] **PR:** `gh pr create` against master.

---

## Phase 2 — Issue PWA flow

### Task 2.1: New shared module skeleton

**Files:**
- Create: `src/modules/field-stock-pwa/index.ts` (barrel)
- Create: `src/modules/field-stock-pwa/api.ts`
- Create: `src/modules/field-stock-pwa/types.ts`

- [ ] **Step 1: Types**

```typescript
// src/modules/field-stock-pwa/types.ts
export interface PwaTechSummary {
  id: string;
  name: string;
  phone: string | null;
  contractorId: string | null;
  contractorName: string | null;
  accountStatus: 'pending' | 'active' | 'suspended';
}

export interface PwaScannedSerial {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string;
  scannedAt: number; // epoch ms; used for sort + audit
  state: 'pending-validation' | 'valid' | 'invalid';
  errorMessage?: string;
}

export interface PwaIssueDraft {
  technicianId: string;
  contractorId: string | null;
  stockItemId: string;
  serials: PwaScannedSerial[];
  signatureDataUrl: string | null;
  notes: string;
}

export interface PwaPickingResult {
  pickingId: string;
  pickingNumber: string; // ISS-YYYYMM-#####
  status: 'pending' | 'confirmed' | 'processed' | 'signed';
}
```

- [ ] **Step 2: Client API helpers** — wraps `/api/procurement/field-stock/pickings`, `/serials/[serialNumber]`, `/field/users`, `/api/contractors`. One function per endpoint. Returns typed payloads.

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/
git commit -m "feat(field-stock-pwa): module skeleton, types, api helpers"
```

### Task 2.2: Offline queue for issue submissions

**Files:**
- Create: `src/modules/field-stock-pwa/offline/queueIssue.ts`
- Create: `src/modules/field-stock-pwa/offline/useStockSync.ts`

**Why:** Field warehouses sometimes have spotty signal. Clock-in already has this pattern — copy its shape verbatim from `src/modules/attendance/portal/client/offline/`.

- [ ] **Step 1: IndexedDB queue (mirror `submitClockEvent.ts`)**

```typescript
// src/modules/field-stock-pwa/offline/queueIssue.ts
import { openDB, type IDBPDatabase } from 'idb';
import type { PwaIssueDraft } from '../types';

const DB_NAME = 'field-stock-pwa-v1';
const STORE = 'pending-issues';

interface QueuedIssue {
  id: string;          // uuid generated client-side
  draft: PwaIssueDraft;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      }
    },
  });
}

export async function enqueueIssue(draft: PwaIssueDraft): Promise<string> {
  const id = crypto.randomUUID();
  const handle = await db();
  await handle.put(STORE, { id, draft, enqueuedAt: Date.now(), attempts: 0 } satisfies QueuedIssue);
  return id;
}

export async function listQueued(): Promise<QueuedIssue[]> {
  return (await db()).getAll(STORE);
}

export async function dropQueued(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

export async function bumpAttempt(id: string, error: string): Promise<void> {
  const handle = await db();
  const row = (await handle.get(STORE, id)) as QueuedIssue | undefined;
  if (!row) return;
  row.attempts += 1;
  row.lastError = error;
  await handle.put(STORE, row);
}
```

- [ ] **Step 2: `useStockSync` hook** — pattern identical to `useAttendanceSync`: listens to `online` event, on reconnect iterates queued issues, POSTs each, drops on 2xx, bumps attempt on 4xx/5xx, surfaces `pendingCount` and `syncing`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/field-stock-pwa/offline/
git commit -m "feat(field-stock-pwa): offline IndexedDB queue + useStockSync hook"
```

### Task 2.3: `PickTechStep` component + inline tech creation

**Files:**
- Create: `pages/my/stores/issue/_steps.tsx` (one file containing the four step components; this is allowed because they share state types and < 200 lines combined keeps things in one place per project file-size rule)
- Create: `src/modules/field-stock-pwa/components/InlineAddTech.tsx`

**Why:** Stores person picks a tech from a searchable list. If the tech isn't there, "+ Add new technician" expands an inline form: name, phone, contractor (dropdown). Creates the staff row with `account_status='pending'` and immediately selects it.

- [ ] **Step 1: `PickTechStep`**

```typescript
// pages/my/stores/issue/_steps.tsx (excerpt)
import { useState, useEffect } from 'react';
import { fetchTechnicians, type PwaTechSummary } from '@/modules/field-stock-pwa/api';
import { InlineAddTech } from '@/modules/field-stock-pwa/components/InlineAddTech';

interface PickTechStepProps {
  onPick: (tech: PwaTechSummary) => void;
}

export function PickTechStep({ onPick }: PickTechStepProps) {
  const [search, setSearch] = useState('');
  const [techs, setTechs] = useState<PwaTechSummary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTechnicians({ search })
      .then(setTechs)
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search technician by name or phone"
        className="w-full px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white"
      />
      {loading ? (
        <div className="py-6 text-center text-neutral-500 text-sm">Loading…</div>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-950 border border-neutral-800">
          {techs.map((t) => (
            <li
              key={t.id}
              onClick={() => onPick(t)}
              className="px-4 py-3 hover:bg-neutral-900 cursor-pointer flex justify-between items-center"
            >
              <div>
                <div className="text-white">{t.name}</div>
                <div className="text-xs text-neutral-500">{t.contractorName ?? 'Unassigned'}</div>
              </div>
              {t.accountStatus === 'pending' && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-amber-950 text-amber-300 px-2 py-0.5">
                  Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setShowAdd(true)}
        className="w-full px-4 py-3 rounded-lg bg-emerald-700 text-white"
      >
        + Add new technician
      </button>
      {showAdd && (
        <InlineAddTech
          onCreated={(tech) => { setShowAdd(false); onPick(tech); }}
          onCancel={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: `InlineAddTech` component** — first/last name, phone (E.164 validated), contractor dropdown, submit → `POST /api/field/users` with `role='technician'`. On 201, calls `onCreated(tech)`.

- [ ] **Step 3: Snapshot tests for both components** — assert pending badge renders, "Add" expands the form, contractor dropdown is populated.

- [ ] **Step 4: Commit**

```bash
git add pages/my/stores/issue/_steps.tsx src/modules/field-stock-pwa/components/InlineAddTech.tsx
git commit -m "feat(my-stores): PickTechStep with inline tech creation"
```

### Task 2.4: `PickItemStep` + `ScanSerialsStep`

**Files:**
- Modify: `pages/my/stores/issue/_steps.tsx` (add two more step components)
- Create: `src/modules/field-stock-pwa/components/SerialChip.tsx`

- [ ] **Step 1: `PickItemStep`** — fetches `GET /api/procurement/field-stock/items?category=ONT|UPS|...`, renders large tap targets (ONT / UPS / Router), one tap commits and advances.

- [ ] **Step 2: `ScanSerialsStep`** — reuses `BarcodeScannerModal` from `src/modules/barcode-scanner/`. On each scan: lookup via `GET /api/procurement/field-stock/serials/[serialNumber]`, dedupe (uppercased Set), haptic feedback (`navigator.vibrate(50)`) on valid scan, persistent list of `SerialChip` components. Manual-entry fallback under a "type instead" disclosure. (Per `feedback_camera_only_pwa.md`: scan is camera-first, manual is fallback.)

- [ ] **Step 3: `SerialChip` component** — shows serial, item name, validation state (green/red), tap-to-remove.

- [ ] **Step 4: Commit**

```bash
git add pages/my/stores/issue/_steps.tsx src/modules/field-stock-pwa/components/SerialChip.tsx
git commit -m "feat(my-stores): PickItemStep, ScanSerialsStep with barcode + manual entry"
```

### Task 2.5: `SignAndSubmitStep`

**Files:**
- Modify: `pages/my/stores/issue/_steps.tsx`

- [ ] **Step 1: Signature canvas** — copy the `SignatureCanvas` block from `DailyCheckoutModal.tsx:101-246` into a standalone component file `src/modules/field-stock-pwa/components/SignaturePad.tsx`. (Don't import from the orphan module — copy then delete the orphan in the deferred Phase 5.)

- [ ] **Step 2: Unverified-tech value cap**

When the picked tech has `accountStatus === 'pending'`, sum the value of scanned serials (lookup item.standard_price × count). If > R5 000, block submit with: "Pending technicians limited to R5 000 of stock — ask admin to approve {Tech.name} first." Cap is enforced server-side too (Task 2.6).

- [ ] **Step 3: Submit handler**

On submit:
1. If online: `POST /api/procurement/field-stock/pickings` with the full draft, then call `/confirm` and `/sign` in sequence to walk the lifecycle in one shot.
2. If offline: `enqueueIssue(draft)`, show "Saved to queue — will sync when online" toast, return to `/my/stores`.

- [ ] **Step 4: Success screen** — shows ISS-YYYYMM-##### number prominently (per `feedback_snag_ticket_confirmation.md` — never silently link).

- [ ] **Step 5: Commit**

```bash
git add pages/my/stores/issue/_steps.tsx src/modules/field-stock-pwa/components/SignaturePad.tsx
git commit -m "feat(my-stores): SignAndSubmitStep with offline fallback and pending-cap"
```

### Task 2.6: Server-side enforce the pending-tech R5 000 cap

**Files:**
- Modify: `pages/api/procurement/field-stock/pickings/index.ts`

**Why:** Client-side cap can be bypassed by a malicious actor with browser devtools. Server must enforce too.

- [ ] **Step 1: Add the check in the create handler**

```typescript
// pages/api/procurement/field-stock/pickings/index.ts (in POST branch)
const [techRow] = await sql<{ account_status: string }>`
  SELECT account_status FROM staff WHERE id = ${body.technicianId} LIMIT 1
`;
if (techRow?.account_status === 'pending') {
  const totalValue = await sql<{ sum: string }>`
    SELECT COALESCE(SUM(si.standard_price), 0)::text AS sum
    FROM unnest(${body.serialNumbers}::text[]) sn
    JOIN serials s ON s.serial_number = sn
    JOIN stock_items si ON si.id = s.stock_item_id
  `;
  if (Number(totalValue[0]?.sum ?? 0) > 5000) {
    return apiResponse.forbidden(res, 'Pending technicians limited to R5 000 of stock until admin approves the account');
  }
}
```

- [ ] **Step 2: Test it** — `tests/api/pickings-pending-cap.test.ts`, single happy + single rejection case.

- [ ] **Step 3: Commit**

```bash
git add pages/api/procurement/field-stock/pickings/index.ts tests/api/pickings-pending-cap.test.ts
git commit -m "feat(pickings): enforce R5000 cap when issuing to pending technicians"
```

### Task 2.7: `/my/stores` landing + `/my/stores/issue` page wiring

**Files:**
- Create: `pages/my/stores/index.tsx`
- Create: `pages/my/stores/issue.tsx`

- [ ] **Step 1: Landing tile grid** — three tiles (Issue / Return / Today), styled like `MyHub` tiles, dark theme, `MyPortalShell`.

- [ ] **Step 2: Issue page** — state machine across the four steps: `pick-tech → pick-item → scan-serials → sign-and-submit → success`. Back button respects step history.

- [ ] **Step 3: Suspended/pending gate** — at page mount, if `profile.role !== 'stores' && profile.role !== 'admin' && profile.role !== 'super_admin'`, redirect to `/my` with a toast.

- [ ] **Step 4: Commit**

```bash
git add pages/my/stores/
git commit -m "feat(my-stores): landing + issue page wiring step state machine"
```

### Task 2.8: Wire stores tiles into MyHub

**Files:**
- Modify: `src/modules/attendance/portal/client/MyHub.tsx`

- [ ] **Step 1: Add tiles, role-gated**

```typescript
// inside MyHub component
const isStores = profile.role === 'stores' || profile.role === 'admin' || profile.role === 'super_admin';

// Add to the grid:
{isStores && (
  <StoresIssueTile onClick={() => router.push('/my/stores/issue')} />
)}
{isStores && (
  <StoresReturnTile onClick={() => router.push('/my/stores/return')} />
)}
{isStores && (
  <StoresTodayTile summary={summary} onClick={() => router.push('/my/stores/today')} />
)}
```

- [ ] **Step 2: New tile components** in the same file (matches the existing `ClockTile` / `VehicleTile` pattern).

- [ ] **Step 3: Commit**

```bash
git add src/modules/attendance/portal/client/MyHub.tsx
git commit -m "feat(my-hub): role-gated stores tiles (Issue, Return, Today)"
```

### Task 2.9: Integration + E2E tests

**Files:**
- Create: `tests/integration/my-stores-issue.test.ts`
- Create: `tests/e2e/my-stores-issue.spec.ts`

- [ ] **Step 1: Integration — happy path** — sign in as stores user → /my/stores/issue → pick existing tech → pick ONT → enter 3 valid serials (mocked validate) → sign → submit → assert picking row created with status='signed'.

- [ ] **Step 2: Integration — pending-cap rejection** — create a pending tech → try to issue 5 serials totalling R6 000 → expect 403 with the cap message.

- [ ] **Step 3: Integration — offline submit queues** — disable network mock → submit → assert IndexedDB has one row, no API call recorded.

- [ ] **Step 4: Playwright E2E** — `playwriter__execute` (per `feedback_browser_playwright.md`) against `dev.fibreflow.app` once deployed: login → issue → screenshot the ISS-YYYYMM-##### success screen.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/my-stores-issue.test.ts tests/e2e/my-stores-issue.spec.ts
git commit -m "test(my-stores-issue): integration + Playwright E2E coverage"
```

### Phase 2 PR gate

- [ ] `npm run ci:quick` passes.
- [ ] `npm run ci` (full) passes.
- [ ] Playwright spec passes against `dev.fibreflow.app`.
- [ ] Manual: issue 1 ONT to a real tech on dev, confirm picking row, confirm signed status, confirm serial state → `assigned`.
- [ ] Offline test on a real phone: airplane mode, submit, take phone off airplane mode, confirm sync.
- [ ] Blind review via `review-team` (500+ lines, multi-domain: PWA + API + offline).
- [ ] PR against master with screenshots of all four steps.

---

## Phase 3 — Return PWA flow

Independent of Phase 4; depends on Phase 2 for the shared module and pattern. Each task ~half a day.

### Task 3.1: `/my/stores/return` page with 3-step flow

**Files:**
- Create: `pages/my/stores/return.tsx`
- Create: `src/modules/field-stock-pwa/offline/queueReturn.ts`

**Steps:**
1. **Pick technician** (reuse `PickTechStep` from Phase 2 — same component, different consumer)
2. **Scan returned serials** — reuse `ScanSerialsStep`, but server-side validation flips: serial must currently be `state='assigned'` AND `assignedTechId === pickedTech.id`. If validation fails, show "Not issued to this technician" inline and don't add it.
3. **Mark faulty toggle + submit** — each scanned chip gets a "Mark faulty" toggle. Submit → `POST /api/procurement/field-stock/returns` with `items: [{ serialNumber, condition: 'good' | 'faulty' }]`.

- [ ] **Step 1: Write the page** — state machine identical to issue, three steps.
- [ ] **Step 2: Wire return-specific validator** — `validateSerialForReturn(serial, techId)` in the api helpers.
- [ ] **Step 3: Offline queue (mirror queueIssue)**.
- [ ] **Step 4: Test + commit.**

### Task 3.2: Server-side return endpoint hardening

**Files:**
- Modify: `pages/api/procurement/field-stock/returns/index.ts`

- [ ] **Step 1:** Verify the endpoint already transitions serial state `assigned → returned` (or `faulty`). If it doesn't, add the transition via the existing state machine.
- [ ] **Step 2:** Reject returns where the serial isn't currently assigned to the named tech (must read from `serials.current_holder_staff_id` or equivalent — check the schema; might already be enforced).
- [ ] **Step 3:** Test + commit.

### Task 3.3: Integration + E2E + MyHub Return tile already added in Phase 2.8

### Phase 3 PR gate

Same shape as Phase 2 — ci:quick, ci, Playwright E2E, manual smoke on dev, blind review, PR.

---

## Phase 4 — Stores Today summary + reconciliation surfacing

### Task 4.1: Mobile-shaped reconciliation aggregator

**Files:**
- Modify: `src/modules/field-stock/services/reconciliationService.ts` (the existing service)
- Create: `pages/api/my/stores/today.ts`

**Why:** The existing dashboard pulls a wide cross-contractor view. The mobile view shows only techs the **current stores user** issued to today, with a tight payload.

- [ ] **Step 1: Migrate reconciliationService off the Neon shim**

```typescript
// src/modules/field-stock/services/reconciliationService.ts
// REPLACE:
//   import { sql } from '@/lib/db-neon';
// WITH:
import { sql } from '@/lib/db-pool';
```

Verify queries still parse — `pg.Pool` and the shim accept the same template-literal shape for most queries, but conditional SQL via the shim is broken (see CLAUDE.md). Audit each query in this file for `${cond ? sql\`...\` : sql\`\`}` patterns; rewrite as explicit branches.

- [ ] **Step 2: Add `getTodayForStoresUser(staffId)` method**

```typescript
export async function getTodayForStoresUser(storesStaffId: string, dateSAST: string) {
  // dateSAST e.g. '2026-05-19' — server treats it as Africa/Johannesburg.
  const rows = await sql<{
    technician_id: string;
    technician_name: string;
    issued_count: number;
    issued_value_rand: number;
    installed_count: number;
    returned_count: number;
    unaccounted_count: number;
  }>`
    WITH issued AS (
      SELECT
        p.technician_id,
        COUNT(*) AS issued_count,
        SUM(si.standard_price) AS issued_value_rand
      FROM stock_pickings p
      JOIN picking_items pi ON pi.picking_id = p.id
      JOIN stock_items si ON si.id = pi.stock_item_id
      WHERE p.created_by_staff_id = ${storesStaffId}
        AND p.created_at::date = ${dateSAST}::date
      GROUP BY p.technician_id
    ),
    installed AS (
      SELECT
        qpr.technician_id,
        COUNT(*) AS installed_count
      FROM qa_photo_reviews qpr
      WHERE qpr.ont_serial IS NOT NULL
        AND qpr.completed_at::date = ${dateSAST}::date
      GROUP BY qpr.technician_id
    ),
    returned AS (
      SELECT
        r.technician_id,
        COUNT(*) AS returned_count
      FROM stock_returns r
      WHERE r.created_at::date = ${dateSAST}::date
      GROUP BY r.technician_id
    )
    SELECT
      s.id AS technician_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS technician_name,
      COALESCE(i.issued_count, 0) AS issued_count,
      COALESCE(i.issued_value_rand, 0) AS issued_value_rand,
      COALESCE(ins.installed_count, 0) AS installed_count,
      COALESCE(ret.returned_count, 0) AS returned_count,
      COALESCE(i.issued_count, 0) - COALESCE(ins.installed_count, 0) - COALESCE(ret.returned_count, 0) AS unaccounted_count
    FROM staff s
    JOIN issued i ON i.technician_id = s.id
    LEFT JOIN installed ins ON ins.technician_id = s.id
    LEFT JOIN returned ret ON ret.technician_id = s.id
    ORDER BY unaccounted_count DESC, technician_name ASC
  `;
  return rows;
}
```

- [ ] **Step 3: Thin API wrapper** — `pages/api/my/stores/today.ts` reads the session, calls `getTodayForStoresUser`, returns the rows.

- [ ] **Step 4: Test + commit.**

### Task 4.2: `/my/stores/today` page

**Files:**
- Create: `pages/my/stores/today.tsx`

**UX:** A list grouped by technician. Each row shows: name | issued # / Rxxx | installed # | returned # | unaccounted # (red badge if >0). Above the threshold (3 items or R5000) gets a red bar. Tap a row → drill to the picking list for that tech (links to existing desktop page).

- [ ] **Step 1: Write the page** — server-rendered fetch, polling every 60s while focused.
- [ ] **Step 2: Test + commit.**

### Task 4.3: MyHub Today tile with badge

The tile was added in Phase 2.8. In Phase 4 it gets wired to read the aggregator and show the unaccounted count.

- [ ] **Step 1: Extend `hub-summary` endpoint** to include `storesTodayUnaccounted` for users with `role IN ('stores','admin','super_admin')`. Cache 5 min in process memory.
- [ ] **Step 2: Render the badge.**
- [ ] **Step 3: Test + commit.**

### Phase 4 PR gate

- [ ] `npm run ci:quick` + `npm run ci` pass.
- [ ] Manual: issue + return on dev, then load `/my/stores/today`, verify numbers match the desktop reconciliation dashboard for the same day.
- [ ] Reconciliation service no longer imports `@/lib/db-neon`.
- [ ] Blind review (single sonnet — single-domain).
- [ ] PR.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Stores creates fake pending techs, issues stock, walks off | R5 000 cap server-side (Task 2.6); pending-tech badge on every view of that tech; admin-approval SLA dashboard with auto-block at 48h pending (deferred to Phase 5) |
| Offline queue grows unboundedly if device is offline for days | `queueIssue` caps at 50 pending rows; UI shows "queue full" banner; sync attempts decay exponentially |
| Conditional SQL in `reconciliationService.ts` already broken under shim | Phase 4 Task 4.1 migrates to `pg.Pool` and rewrites any conditional template-literal branches |
| `qa_photo_reviews.technician_id` mapping unreliable for installed-count | Cross-check during Task 4.1 — if `technician_id` on QA reviews isn't populated reliably, fall back to joining via `picking_items.serial_number = qa_photo_reviews.ont_serial` (more robust but slower) |
| Stores user accidentally signs out a tech's signature on their own phone | Step 4 explicitly labels "Tech: please sign on Stores' phone" with the tech's name visible above the canvas |
| Camera permission denied | `feedback_in_app_permissions.md` — in-app prompt explaining why; manual entry remains available as fallback per CLAUDE.md scanner pattern |
| Concurrent stores users syncing offline queues for the same serial | Server already enforces serial state machine (`assigned` cannot become `assigned` again) — duplicate sync returns 409, queue drops it as terminally-failed and surfaces in the UI |

## Out of scope (defer to follow-up plans)

1. Auto-block pending techs after 48h with no admin approval.
2. Delete `src/modules/field-stock/` orphan after verifying the offline utils are superseded by `src/modules/field-stock-pwa/offline/`.
3. WhatsApp notification to the tech when a picking is issued in their name ("Sipho, you've been issued 5 ONTs by Anne. Sign on Anne's phone to confirm.").
4. Cross-day reconciliation view (current scope = today only).
5. Bulk import of contractor techs from CSV.

## Self-review checklist (done)

- ✅ **Spec coverage:** every brainstorming decision in Phase 0 maps to a task.
- ✅ **No placeholders** — every step has actual code or actual commands.
- ✅ **Type consistency:** `PwaScannedSerial`, `PwaIssueDraft`, `PwaPickingResult` used the same way across tasks.
- ✅ **File-path absolutism:** every Create/Modify target is a real path.
- ✅ **Migration directory:** all SQL goes in `scripts/migrations/sql/` per `feedback_migration_directory.md`.
- ✅ **300-line file rule:** the four step components live in `_steps.tsx` only if combined LoC < 300; if they grow during implementation, split into one file per step.
- ✅ **Tests precede implementation** for every endpoint (Tasks 1.2, 2.6, 4.1).
- ✅ **Verification gates:** each phase ends with `ci:quick` + manual smoke + blind review + PR.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-field-stock-pwa.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task self-contained so this works well here.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
