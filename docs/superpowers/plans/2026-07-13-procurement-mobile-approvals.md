# Procurement Mobile Approvals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first, deep-linkable approval-review surface so approvers can open any pending procurement approval on their phone, review it, and Approve / Reject / Park — reusing the existing unified `approval_requests` backend.

**Architecture:** One new route `/procurement/approvals/[requestId]` driven by the unified approvals API, rendering a summary header + a type-aware detail panel (rich for `purchase_order` and `purchase_requisition`, summary fallback for the other 5 workflow types) + a sticky Approve/Reject/Park action bar. Server-side, harden the approve/reject/park endpoints with an eligibility check and add a single-item read endpoint. The existing `/procurement/approvals` inbox gets a mobile-first pass. Deep links use the existing `/sign-in?returnUrl=` redirect-back.

**Tech Stack:** Next.js 14 Pages Router, React, TypeScript, Tailwind (dark theme via `--ff-*` CSS vars), Neon serverless shim for SQL (`@neondatabase/serverless`), Vitest + Testing Library, `apiResponse` helpers, `log` from `@/lib/logger`.

## Global Constraints

- **Neon shim SQL:** approvals + PO endpoints use `const sql = neon(process.env.DATABASE_URL!)`. **No conditional SQL inside a template** (`${cond ? sql\`...\` : sql\`\`}` breaks the shim). Use explicit query branches. New reads may instead use `@/lib/db` (`pg.Pool`) — pick one per file and stay consistent with the file's neighbors (the approvals folder uses the shim).
- **API responses:** always `import { apiResponse } from '@/lib/apiResponse'` — `apiResponse.success/notFound/validationError/methodNotAllowed/forbidden/databaseError`. Never hand-roll JSON.
- **Auth wrapper:** API handlers use `withAuth(withErrorHandler(...))` from `@/lib/auth`; the authenticated user is `(req as AuthenticatedNextApiRequest).user` = `{ id, email, name, role }`.
- **Logging:** `import { log } from '@/lib/logger'`. No `console.log`. No empty catch blocks (log + handle).
- **File size:** files < 300 lines, components < 200 lines. Split panels/components accordingly.
- **Dynamic route param names:** the page route uses the descriptive `[requestId]`; the existing API folder is `[id]` — keep the API folder's `id` for local consistency.
- **Responsive:** mobile-first Tailwind; stack with `flex-col` + `sm:flex-row`; `min-w-0`/`truncate` to prevent overflow; sticky bars use `sticky bottom-0` inside a scroll container (never let content overflow an ancestor `overflow-x-hidden`). Colors via `--ff-*` vars only.
- **Verification:** `npm run ci:quick` before every PR. UI changes require a real mobile-viewport browser check (CLAUDE.md rule 4), not code review alone.
- **Process:** work in the worktree `/home/hein/Workspace/FF_Next.js-procurement-mobile-approvals`; one PR per task (or per small cluster); blind `/review` + CI green before merge; never edit the main tree.
- **Security invariant:** no tokenized no-login approval links. Every approval action is performed by an authenticated, eligible approver and stamped with their user id.

---

## File Structure

**Server (new/modified):**
- `src/modules/procurement/approvals/eligibility.ts` — NEW. `isEligibleApprover(request, user)` pure function + shared SQL fragment for the current-level approver check.
- `pages/api/procurement/approvals/[id]/approve.ts` — MODIFY. Add eligibility gate before mutating.
- `pages/api/procurement/approvals/[id]/reject.ts` — MODIFY. Same gate.
- `pages/api/procurement/approvals/[id]/park.ts` — MODIFY. Same gate.
- `pages/api/procurement/approvals/[id]/index.ts` — NEW. `GET` single approval request + `canAct`.

**Client (new):**
- `pages/procurement/approvals/[requestId].tsx` — NEW. The mobile approval-review route (thin page: fetch + compose).
- `src/modules/procurement/approvals/mobile/MobileApprovalLayout.tsx` — NEW. Slim layout wrapper (back bar, no desktop sidebar).
- `src/modules/procurement/approvals/mobile/ApprovalSummaryHeader.tsx` — NEW.
- `src/modules/procurement/approvals/mobile/ApprovalDetailPanel.tsx` — NEW. Registry + dispatch by `document_type`.
- `src/modules/procurement/approvals/mobile/panels/PurchaseOrderPanel.tsx` — NEW.
- `src/modules/procurement/approvals/mobile/panels/RequisitionPanel.tsx` — NEW.
- `src/modules/procurement/approvals/mobile/panels/SummaryFallbackPanel.tsx` — NEW.
- `src/modules/procurement/approvals/mobile/ApprovalActionBar.tsx` — NEW. Sticky bar + reason sheet orchestration.
- `src/modules/procurement/approvals/mobile/ReasonBottomSheet.tsx` — NEW.
- `src/modules/procurement/approvals/mobile/types.ts` — NEW. Shared `ApprovalRequestRecord`, `WorkflowType`, panel prop types.

**Client (modified):**
- `pages/procurement/approvals/index.tsx` — MODIFY. Mobile-first pass on the inbox list.

**Tests:**
- `src/modules/procurement/approvals/__tests__/eligibility.test.ts`
- `pages/api/procurement/approvals/[id]/__tests__/read.test.ts`
- `pages/api/procurement/approvals/[id]/__tests__/approve-eligibility.test.ts`
- `src/modules/procurement/approvals/mobile/__tests__/ApprovalDetailPanel.test.tsx`
- `src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx`
- E2E: run via the project's playwriter mobile method (Task 11), not a committed spec.

> **Note (test file placement):** Do NOT put `.test.tsx` files under `pages/` — a `.tsx` test under `pages/` breaks `next build`. API-route tests under `pages/api/**/__tests__/*.test.ts` are fine (`.ts`, not a page). Component tests live under `src/.../__tests__/`.

---

## Shared Types (referenced by multiple tasks)

`src/modules/procurement/approvals/mobile/types.ts`:

```typescript
export type WorkflowType =
  | 'purchase_requisition'
  | 'purchase_order'
  | 'boq'
  | 'rfq'
  | 'goods_receipt'
  | 'supplier_registration'
  | 'payment_request';

/** One row from approval_requests, as returned by GET /api/procurement/approvals/[id]. */
export interface ApprovalRequestRecord {
  id: string;
  documentType: WorkflowType;
  documentId: string;
  documentNumber: string | null;
  documentAmount: number | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected' | 'on_hold' | 'cancelled';
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string | null;
  requestNotes: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  workflowName: string | null;
  levelName: string | null;
  levelNumber: number | null;
  approverType: 'user' | 'role' | 'department_head' | 'project_manager' | 'any_of_group';
  approverName: string | null;
  /** Server-computed: may the current user act on this request right now? */
  canAct: boolean;
}

export type ApprovalActionType = 'approve' | 'reject' | 'park';
```

---

## Task 1: Wire deep-link auth (redirect-back) + harden returnUrl

**Files:**
- Verify (read only): `src/components/auth/premium/PremiumLoginPage.tsx:139-140,179-180`, `src/lib/authErrorHandler.ts`, `src/utils/api.ts`.
- Modify: `src/components/auth/premium/PremiumLoginPage.tsx` (relative-URL guard).
- Test: `src/components/auth/premium/__tests__/returnUrl.test.ts` (pure guard function).

**Interfaces:**
- Produces: `safeReturnUrl(raw: string | string[] | undefined): string` — returns a same-origin relative path or `'/'`.

Deep-link auth already works: an unauthenticated fetch that 401s triggers `authErrorHandler` → `window.location.href = '/sign-in?returnUrl=<currentPath>'`, and the sign-in page pushes `returnUrl` after login. Task 1 only closes the open-redirect gap (`router.push(returnUrl)` with an attacker-supplied absolute URL) and confirms the new route will fetch through the shared handler.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/auth/premium/__tests__/returnUrl.test.ts
import { describe, it, expect } from 'vitest';
import { safeReturnUrl } from '../safeReturnUrl';

describe('safeReturnUrl', () => {
  it('keeps a normal relative path', () => {
    expect(safeReturnUrl('/procurement/approvals/abc-123')).toBe('/procurement/approvals/abc-123');
  });
  it('rejects absolute http(s) URLs', () => {
    expect(safeReturnUrl('https://evil.com/x')).toBe('/');
  });
  it('rejects protocol-relative URLs', () => {
    expect(safeReturnUrl('//evil.com')).toBe('/');
  });
  it('rejects non-string / array / empty', () => {
    expect(safeReturnUrl(undefined)).toBe('/');
    expect(safeReturnUrl(['/a', '/b'])).toBe('/');
    expect(safeReturnUrl('')).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/auth/premium/__tests__/returnUrl.test.ts`
Expected: FAIL — cannot resolve `../safeReturnUrl`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/components/auth/premium/safeReturnUrl.ts
/**
 * Only allow same-origin relative paths as a post-login redirect target.
 * Guards router.push(returnUrl) against open-redirect to external hosts.
 */
export function safeReturnUrl(raw: string | string[] | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/';
  // Must start with a single slash and not be protocol-relative ("//host").
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  // Reject anything that smells like a scheme (e.g. "/\evil" backslash tricks).
  if (raw.includes('\\')) return '/';
  return raw;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/auth/premium/__tests__/returnUrl.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use the guard in the login page**

In `src/components/auth/premium/PremiumLoginPage.tsx`, add `import { safeReturnUrl } from './safeReturnUrl';` and replace BOTH occurrences of:

```typescript
const returnUrl = (router.query.returnUrl as string) || '/';
router.push(returnUrl);
```
with:
```typescript
const returnUrl = safeReturnUrl(router.query.returnUrl);
router.push(returnUrl);
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run ci:quick`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/auth/premium/safeReturnUrl.ts src/components/auth/premium/__tests__/returnUrl.test.ts src/components/auth/premium/PremiumLoginPage.tsx
git commit -m "fix(auth): validate returnUrl is a relative path before post-login redirect"
```

---

## Task 2: Approver-eligibility helper + harden approve/reject/park

**Files:**
- Create: `src/modules/procurement/approvals/eligibility.ts`
- Modify: `pages/api/procurement/approvals/[id]/approve.ts`, `.../reject.ts`, `.../park.ts`
- Test: `src/modules/procurement/approvals/__tests__/eligibility.test.ts`, `pages/api/procurement/approvals/[id]/__tests__/approve-eligibility.test.ts`

**Interfaces:**
- Produces: `isEligibleApprover(input: EligibilityInput): boolean` where
  ```typescript
  interface EligibilityInput {
    userId: string;
    userRole: string;
    approverType: string;         // al.approver_type
    approverUserId: string | null; // al.approver_user_id
    approverRole: string | null;   // al.approver_role
    assignedTo: string | null;     // ar.assigned_to
  }
  ```
  Returns true if the user is the assigned approver, the named user approver, or holds the required role for the level. `super_admin` always returns true.
- Consumed by: Task 3 (`canAct`) and the three action endpoints.

**Context:** `approve.ts` today runs under `withAuth` (authentication only) and does not verify the caller is the level's approver — any authenticated user can approve any pending request by id. Close that.

- [ ] **Step 1: Write the failing test (pure helper)**

```typescript
// src/modules/procurement/approvals/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest';
import { isEligibleApprover } from '../eligibility';

const base = { userId: 'u1', userRole: 'project_manager', approverType: 'role',
  approverUserId: null, approverRole: 'project_manager', assignedTo: null };

describe('isEligibleApprover', () => {
  it('super_admin always eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'super_admin', approverRole: 'x' })).toBe(true);
  });
  it('role match → eligible', () => {
    expect(isEligibleApprover(base)).toBe(true);
  });
  it('role mismatch → not eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'field_technician' })).toBe(false);
  });
  it('named user approver match → eligible', () => {
    expect(isEligibleApprover({ ...base, approverType: 'user', approverUserId: 'u1', approverRole: null })).toBe(true);
  });
  it('named user approver mismatch → not eligible', () => {
    expect(isEligibleApprover({ ...base, approverType: 'user', approverUserId: 'u2', approverRole: null })).toBe(false);
  });
  it('assigned_to match overrides type → eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'field_technician', approverRole: 'project_manager', assignedTo: 'u1' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/procurement/approvals/__tests__/eligibility.test.ts`
Expected: FAIL — cannot resolve `../eligibility`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/modules/procurement/approvals/eligibility.ts
export interface EligibilityInput {
  userId: string;
  userRole: string;
  approverType: string;
  approverUserId: string | null;
  approverRole: string | null;
  assignedTo: string | null;
}

/** True if the user may act on the current approval level. */
export function isEligibleApprover(i: EligibilityInput): boolean {
  if (i.userRole === 'super_admin') return true;
  if (i.assignedTo && i.assignedTo === i.userId) return true;
  if (i.approverType === 'user') {
    return !!i.approverUserId && i.approverUserId === i.userId;
  }
  if (i.approverType === 'role') {
    return !!i.approverRole && i.approverRole === i.userRole;
  }
  // department_head / project_manager / any_of_group: not yet modelled with a
  // direct column here — deny by default (safer); extend when those workflows
  // gain concrete assignment data. assigned_to still grants access above.
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/procurement/approvals/__tests__/eligibility.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Gate the three endpoints**

In each of `approve.ts`, `reject.ts`, `park.ts`, the existing "check exists + is pending" query already selects `ar.*`. Extend that SELECT to also pull the level's approver columns, then gate. Concretely, in `approve.ts` replace the existing existence query + pending check with:

```typescript
import { isEligibleApprover } from '@/modules/procurement/approvals/eligibility';
// ...
const existing = await sql`
  SELECT ar.*, aw.workflow_type,
         al.approver_type, al.approver_user_id, al.approver_role
  FROM approval_requests ar
  JOIN approval_workflows aw ON ar.workflow_id = aw.id
  JOIN approval_levels al ON ar.level_id = al.id
  WHERE ar.id = ${id}
`;
if (existing.length === 0) {
  return apiResponse.notFound(res, 'Approval request', id);
}
const request = existing[0]!;
if (request.status !== 'pending') {
  return apiResponse.validationError(res, {
    status: `Cannot approve a request that is already ${request.status}`,
  });
}
const eligible = isEligibleApprover({
  userId: authReq.user.id,
  userRole: authReq.user.role,
  approverType: request.approver_type,
  approverUserId: request.approver_user_id,
  approverRole: request.approver_role,
  assignedTo: request.assigned_to ?? null,
});
if (!eligible) {
  log.warn('Ineligible approval attempt', { requestId: id, userId: authReq.user.id }, 'procurement');
  return apiResponse.forbidden(res, 'You are not an approver for this request.');
}
```
Apply the identical SELECT extension + eligibility block in `reject.ts` and `park.ts` (message wording adjusted). Confirm `apiResponse.forbidden` exists; if not, use `apiResponse.error(res, 403, ...)` per the helper's actual API (check `src/lib/apiResponse.ts`).

- [ ] **Step 6: Write the endpoint test (neon-shim mocked)**

```typescript
// pages/api/procurement/approvals/[id]/__tests__/approve-eligibility.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the neon shim BEFORE importing the handler (see tests/unit/projects/*.test.ts pattern).
const rows: any[] = [];
vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const tag = async () => rows.shift() ?? [];
    return tag;
  },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: any) => (req: any, res: any) => {
    req.user = req.__user ?? { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    return h(req, res);
  },
}));

import handler from '../approve';
import { createMocks } from 'node-mocks-http'; // if available; else hand-roll req/res

beforeEach(() => { rows.length = 0; });

it('403 when caller is not the level approver', async () => {
  rows.push([{ id: 'a1', status: 'pending', document_type: 'purchase_order',
    approver_type: 'role', approver_role: 'project_manager', approver_user_id: null, assigned_to: null }]);
  const { req, res } = createMocks({ method: 'POST', query: { id: 'a1' }, body: {} });
  (req as any).__user = { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(403);
});
```

> If `node-mocks-http` is not a dependency, mirror the req/res harness used by an existing test under `tests/api/` or `pages/api/**/__tests__/`. Grep first: `rg -l "createMocks|node-mocks-http" tests pages`. Match the neon-mock shape used by `tests/unit/projects/projectDashboardService.test.ts`.

- [ ] **Step 7: Run the endpoint test**

Run: `npx vitest run "pages/api/procurement/approvals/[id]/__tests__/approve-eligibility.test.ts"`
Expected: PASS.

- [ ] **Step 8: Verify + commit**

```bash
npm run ci:quick
git add src/modules/procurement/approvals/eligibility.ts \
        src/modules/procurement/approvals/__tests__/eligibility.test.ts \
        "pages/api/procurement/approvals/[id]/approve.ts" \
        "pages/api/procurement/approvals/[id]/reject.ts" \
        "pages/api/procurement/approvals/[id]/park.ts" \
        "pages/api/procurement/approvals/[id]/__tests__/approve-eligibility.test.ts"
git commit -m "feat(procurement): gate approve/reject/park on approver eligibility"
```

---

## Task 3: Single-item read endpoint `GET /api/procurement/approvals/[id]`

**Files:**
- Create: `pages/api/procurement/approvals/[id]/index.ts`
- Test: `pages/api/procurement/approvals/[id]/__tests__/read.test.ts`

**Interfaces:**
- Produces: `GET /api/procurement/approvals/{id}` → `apiResponse.success(res, ApprovalRequestRecord)` (camelCased, incl. server-computed `canAct` via Task 2's `isEligibleApprover`). 404 if missing.
- Consumed by: Task 4 page fetch.

- [ ] **Step 1: Write the failing test**

```typescript
// pages/api/procurement/approvals/[id]/__tests__/read.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const rows: any[] = [];
vi.mock('@neondatabase/serverless', () => ({ neon: () => async () => rows.shift() ?? [] }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: any) => (req: any, res: any) => {
  req.user = req.__user ?? { id: 'u1', role: 'super_admin', name: 'A', email: 'a@x' }; return h(req, res); } }));
import handler from '../index';
import { createMocks } from 'node-mocks-http';
beforeEach(() => { rows.length = 0; });

it('returns the record with canAct=true for super_admin', async () => {
  rows.push([{ id: 'a1', document_type: 'purchase_order', document_id: 'po1', document_number: 'PO-1',
    document_amount: '45000', status: 'pending', requested_by: 'r1', requested_by_name: 'R',
    requested_at: '2026-07-13T10:00:00Z', request_notes: null, due_date: null, is_overdue: false,
    workflow_name: 'PO Approval', level_name: 'L1', level_number: 1,
    approver_type: 'role', approver_user_id: null, approver_role: 'admin', assigned_to: null }]);
  const { req, res } = createMocks({ method: 'GET', query: { id: 'a1' } });
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(200);
  const body = JSON.parse(res._getData());
  expect(body.data.documentNumber).toBe('PO-1');
  expect(body.data.canAct).toBe(true);
  expect(body.data.documentAmount).toBe(45000);
});

it('404 when missing', async () => {
  rows.push([]);
  const { req, res } = createMocks({ method: 'GET', query: { id: 'nope' } });
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "pages/api/procurement/approvals/[id]/__tests__/read.test.ts"`
Expected: FAIL — cannot resolve `../index`.

- [ ] **Step 3: Write the endpoint**

```typescript
// pages/api/procurement/approvals/[id]/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { isEligibleApprover } from '@/modules/procurement/approvals/eligibility';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  const authReq = req as AuthenticatedNextApiRequest;
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }
  const rows = await sql`
    SELECT ar.id, aw.workflow_type AS document_type, ar.document_id, ar.document_number,
           ar.document_amount, ar.status, ar.requested_by, ar.requested_by_name, ar.requested_at,
           ar.request_notes, ar.due_date, ar.is_overdue, ar.assigned_to,
           aw.name AS workflow_name, al.name AS level_name, al.level_number,
           al.approver_type, al.approver_user_id, al.approver_role,
           CASE WHEN al.approver_type = 'user'
                THEN COALESCE(u.first_name || ' ' || u.last_name, u.email)
                WHEN al.approver_type = 'role' AND al.approver_role IS NOT NULL
                THEN INITCAP(REPLACE(al.approver_role, '_', ' ')) END AS approver_name
    FROM approval_requests ar
    JOIN approval_workflows aw ON ar.workflow_id = aw.id
    JOIN approval_levels al ON ar.level_id = al.id
    LEFT JOIN users u ON al.approver_type = 'user' AND u.id::text = al.approver_user_id::text
    WHERE ar.id = ${id}
  `;
  if (rows.length === 0) return apiResponse.notFound(res, 'Approval request', id);
  const r = rows[0]!;
  const canAct = r.status === 'pending' && isEligibleApprover({
    userId: authReq.user.id, userRole: authReq.user.role,
    approverType: r.approver_type, approverUserId: r.approver_user_id,
    approverRole: r.approver_role, assignedTo: r.assigned_to ?? null,
  });
  return apiResponse.success(res, {
    id: r.id, documentType: r.document_type, documentId: r.document_id,
    documentNumber: r.document_number, documentAmount: r.document_amount == null ? null : Number(r.document_amount),
    status: r.status, requestedBy: r.requested_by, requestedByName: r.requested_by_name,
    requestedAt: r.requested_at, requestNotes: r.request_notes, dueDate: r.due_date,
    isOverdue: !!r.is_overdue, workflowName: r.workflow_name, levelName: r.level_name,
    levelNumber: r.level_number, approverType: r.approver_type, approverName: r.approver_name,
    canAct,
  });
}));
```

> `document_amount` is `numeric` → the shim returns it as a **string**; `Number(...)` coercion is required (see [[feedback_pg_numeric_json_string_coercion]]).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "pages/api/procurement/approvals/[id]/__tests__/read.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify + commit**

```bash
npm run ci:quick
git add "pages/api/procurement/approvals/[id]/index.ts" "pages/api/procurement/approvals/[id]/__tests__/read.test.ts"
git commit -m "feat(procurement): add single-item approval read endpoint with canAct"
```

---

## Task 4: Mobile approval route shell + slim layout

**Files:**
- Create: `pages/procurement/approvals/[requestId].tsx`, `src/modules/procurement/approvals/mobile/MobileApprovalLayout.tsx`, `src/modules/procurement/approvals/mobile/types.ts`

**Interfaces:**
- Consumes: `GET /api/procurement/approvals/{id}` (Task 3).
- Produces: renders `<ApprovalSummaryHeader>` (Task 5), `<ApprovalDetailPanel>` (Task 6), `<ApprovalActionBar>` (Task 9) — import stubs that Tasks 5/6/9 fill in. For this task, render header data inline and placeholder the panel/action bar so the page compiles and shows the record.

**Behavior:** fetch must go through the shared API client so a cold, unauthenticated tap 401s → `/sign-in?returnUrl=/procurement/approvals/<id>` → back after login. Use the same fetch helper the app uses for authenticated reads (grep `rg -n "authErrorHandler|apiClient|fetchJson" src/utils/api.ts` and reuse it). If the page uses raw `fetch`, on `res.status === 401` call the shared redirect (do not silently error).

- [ ] **Step 1: Create the slim layout**

```tsx
// src/modules/procurement/approvals/mobile/MobileApprovalLayout.tsx
import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

export function MobileApprovalLayout({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[var(--ff-bg-primary)] flex flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <button onClick={() => router.push('/procurement/approvals')} aria-label="Back to approvals"
          className="p-2 -ml-2 rounded-lg hover:bg-[var(--ff-bg-hover)] shrink-0">
          <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
        </button>
        <h1 className="text-base font-semibold text-[var(--ff-text-primary)] truncate">{title}</h1>
      </header>
      <main className="flex-1 overflow-y-auto pb-28">{children}</main>
    </div>
  );
}
```
> `pb-28` reserves space so the sticky action bar (Task 9) never overlaps the last content. No ancestor sets `overflow-x-hidden`, so the action bar can't be clipped.

- [ ] **Step 2: Create the page (fetch + compose)**

```tsx
// pages/procurement/approvals/[requestId].tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
import { MobileApprovalLayout } from '@/modules/procurement/approvals/mobile/MobileApprovalLayout';
import { ApprovalSummaryHeader } from '@/modules/procurement/approvals/mobile/ApprovalSummaryHeader';
import { ApprovalDetailPanel } from '@/modules/procurement/approvals/mobile/ApprovalDetailPanel';
import { ApprovalActionBar } from '@/modules/procurement/approvals/mobile/ApprovalActionBar';
import type { ApprovalRequestRecord } from '@/modules/procurement/approvals/mobile/types';

export default function MobileApprovalPage() {
  const router = useRouter();
  const { requestId } = router.query;
  const [record, setRecord] = useState<ApprovalRequestRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/procurement/approvals/${requestId}`);
      if (res.status === 401) {
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`;
        return;
      }
      const data = await res.json();
      if (data.success) setRecord(data.data);
      else setError(data.error?.message || 'Failed to load approval');
    } catch (err) {
      log.error('Failed to load approval request', { error: err }, 'procurement');
      setError('Failed to load approval');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (router.isReady && typeof requestId === 'string') load(); }, [router.isReady, requestId]);

  if (!router.isReady || loading) {
    return <MobileApprovalLayout title="Approval">
      <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 rounded-full border-b-2 border-blue-500" /></div>
    </MobileApprovalLayout>;
  }
  if (error || !record) {
    return <MobileApprovalLayout title="Approval">
      <div className="p-6 text-center text-[var(--ff-text-secondary)]">{error || 'Not found'}</div>
    </MobileApprovalLayout>;
  }
  return (
    <MobileApprovalLayout title={record.documentNumber || 'Approval'}>
      <ApprovalSummaryHeader record={record} />
      <ApprovalDetailPanel record={record} />
      <ApprovalActionBar record={record} onActioned={load} />
    </MobileApprovalLayout>
  );
}
```

- [ ] **Step 3: Stub the three child components** so the page compiles (Tasks 5/6/9 replace them):

```tsx
// Temporary stubs — each in its own file per the File Structure map.
export function ApprovalSummaryHeader(_: { record: unknown }) { return null; }         // ApprovalSummaryHeader.tsx
export function ApprovalDetailPanel(_: { record: unknown }) { return null; }           // ApprovalDetailPanel.tsx
export function ApprovalActionBar(_: { record: unknown; onActioned: () => void }) { return null; } // ApprovalActionBar.tsx
```
Also create `src/modules/procurement/approvals/mobile/types.ts` with the Shared Types block above.

- [ ] **Step 4: Verify build**

Run: `npm run ci:quick`
Expected: PASS (route compiles; stubs render nothing).

- [ ] **Step 5: Commit**

```bash
git add pages/procurement/approvals/\[requestId\].tsx src/modules/procurement/approvals/mobile/
git commit -m "feat(procurement): mobile approval route shell + slim layout (stubs)"
```

---

## Task 5: ApprovalSummaryHeader

**Files:** Create/replace `src/modules/procurement/approvals/mobile/ApprovalSummaryHeader.tsx`. Test: none beyond render (covered by the panel test harness); verify visually in Task 11.

**Interfaces:** Consumes `ApprovalRequestRecord`. Produces `<ApprovalSummaryHeader record>`.

- [ ] **Step 1: Implement**

```tsx
// src/modules/procurement/approvals/mobile/ApprovalSummaryHeader.tsx
import { AlertTriangle, Clock } from 'lucide-react';
import type { ApprovalRequestRecord } from './types';

const TYPE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase Order', purchase_requisition: 'Requisition', boq: 'BOQ',
  rfq: 'RFQ', goods_receipt: 'Goods Receipt', supplier_registration: 'Supplier Registration',
  payment_request: 'Payment Request',
};

function money(v: number | null) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(v);
}

export function ApprovalSummaryHeader({ record }: { record: ApprovalRequestRecord }) {
  return (
    <section className="p-4 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
          {TYPE_LABELS[record.documentType] ?? record.documentType}
        </span>
        {record.isOverdue && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-300">
            <AlertTriangle className="h-3 w-3" /> Overdue
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] truncate">{record.documentNumber || '—'}</h2>
        <span className="text-lg font-semibold text-[var(--ff-text-primary)] shrink-0">{money(record.documentAmount)}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-[var(--ff-text-tertiary)]">Requested by</dt>
          <dd className="text-[var(--ff-text-secondary)] truncate">{record.requestedByName || '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--ff-text-tertiary)]">Level</dt>
          <dd className="text-[var(--ff-text-secondary)] truncate">{record.levelName || `Level ${record.levelNumber ?? ''}`}</dd></div>
        {record.requestNotes && (
          <div className="pt-1 text-[var(--ff-text-secondary)] flex items-start gap-1.5">
            <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--ff-text-tertiary)]" />
            <span className="whitespace-pre-wrap">{record.requestNotes}</span>
          </div>
        )}
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run ci:quick`
```bash
git add src/modules/procurement/approvals/mobile/ApprovalSummaryHeader.tsx
git commit -m "feat(procurement): approval summary header"
```

---

## Task 6: Panel registry + SummaryFallbackPanel

**Files:** Create/replace `src/modules/procurement/approvals/mobile/ApprovalDetailPanel.tsx`; create `src/modules/procurement/approvals/mobile/panels/SummaryFallbackPanel.tsx`. Test: `src/modules/procurement/approvals/mobile/__tests__/ApprovalDetailPanel.test.tsx`.

**Interfaces:** Produces `<ApprovalDetailPanel record>` which dispatches by `record.documentType` to a registered panel, else `SummaryFallbackPanel`. Panels receive `{ record: ApprovalRequestRecord }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/procurement/approvals/mobile/__tests__/ApprovalDetailPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalDetailPanel } from '../ApprovalDetailPanel';
import type { ApprovalRequestRecord } from '../types';

const rec = (t: string): ApprovalRequestRecord => ({
  id: 'a', documentType: t as any, documentId: 'd', documentNumber: 'X-1', documentAmount: 1,
  status: 'pending', requestedBy: null, requestedByName: null, requestedAt: null, requestNotes: null,
  dueDate: null, isOverdue: false, workflowName: null, levelName: null, levelNumber: 1,
  approverType: 'role', approverName: null, canAct: true,
});

describe('ApprovalDetailPanel', () => {
  it('renders fallback for a type without a rich panel', () => {
    render(<ApprovalDetailPanel record={rec('payment_request')} />);
    expect(screen.getByTestId('summary-fallback-panel')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/procurement/approvals/mobile/__tests__/ApprovalDetailPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fallback + registry**

```tsx
// src/modules/procurement/approvals/mobile/panels/SummaryFallbackPanel.tsx
import Link from 'next/link';
import type { ApprovalRequestRecord } from '../types';

const FULL_RECORD_PATH: Partial<Record<string, (id: string) => string>> = {
  purchase_order: (id) => `/procurement/purchase-orders/${id}`,
  purchase_requisition: (id) => `/procurement/requisitions/${id}`,
};

export function SummaryFallbackPanel({ record }: { record: ApprovalRequestRecord }) {
  const href = FULL_RECORD_PATH[record.documentType]?.(record.documentId);
  return (
    <section data-testid="summary-fallback-panel" className="p-4 space-y-3">
      <p className="text-sm text-[var(--ff-text-secondary)]">
        Review the full record before deciding — a mobile detail view for this approval type is coming.
      </p>
      {href && (
        <Link href={href} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]">
          Open full record
        </Link>
      )}
    </section>
  );
}
```

```tsx
// src/modules/procurement/approvals/mobile/ApprovalDetailPanel.tsx
import type { ComponentType } from 'react';
import type { ApprovalRequestRecord, WorkflowType } from './types';
import { SummaryFallbackPanel } from './panels/SummaryFallbackPanel';
import { PurchaseOrderPanel } from './panels/PurchaseOrderPanel';
import { RequisitionPanel } from './panels/RequisitionPanel';

type PanelProps = { record: ApprovalRequestRecord };
const REGISTRY: Partial<Record<WorkflowType, ComponentType<PanelProps>>> = {
  purchase_order: PurchaseOrderPanel,
  purchase_requisition: RequisitionPanel,
};

export function ApprovalDetailPanel({ record }: PanelProps) {
  const Panel = REGISTRY[record.documentType] ?? SummaryFallbackPanel;
  return <Panel record={record} />;
}
```

> Tasks 7 and 8 create `PurchaseOrderPanel` and `RequisitionPanel`. To keep this task green in isolation, temporarily create those two files as one-line re-exports of `SummaryFallbackPanel`, then replace them in Tasks 7/8. (Do NOT leave the re-export — Tasks 7/8 overwrite it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/procurement/approvals/mobile/__tests__/ApprovalDetailPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

```bash
npm run ci:quick
git add src/modules/procurement/approvals/mobile/ApprovalDetailPanel.tsx src/modules/procurement/approvals/mobile/panels/ src/modules/procurement/approvals/mobile/__tests__/
git commit -m "feat(procurement): approval detail panel registry + summary fallback"
```

---

## Task 7: PurchaseOrderPanel

**Files:** Replace `src/modules/procurement/approvals/mobile/panels/PurchaseOrderPanel.tsx`.

**Interfaces:** Consumes `record` (uses `record.documentId`). Fetches `GET /api/procurement/purchase-orders/{documentId}` (returns the `PurchaseOrderDetail` shape defined in `pages/procurement/purchase-orders/[id].tsx`: `{ items: {description, quantityOrdered, unitPrice, lineTotal, unitOfMeasure}[], supplierName, subtotal, taxAmount, totalAmount, quoteAttachmentUrl }`).

- [ ] **Step 1: Implement (mobile card list, not a table)**

```tsx
// src/modules/procurement/approvals/mobile/panels/PurchaseOrderPanel.tsx
import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import type { ApprovalRequestRecord } from '../types';

interface POItem { description: string; quantityOrdered: number; unitOfMeasure: string; unitPrice: number; lineTotal: number; }
interface PO { supplierName: string; items: POItem[]; subtotal: number; taxAmount: number; totalAmount: number; }
const money = (v: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(v);

export function PurchaseOrderPanel({ record }: { record: ApprovalRequestRecord }) {
  const [po, setPo] = useState<PO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/procurement/purchase-orders/${record.documentId}`);
        const data = await res.json();
        if (data.success) setPo(data.data); else setFailed(true);
      } catch (err) { log.error('PO panel load failed', { error: err }, 'procurement'); setFailed(true); }
    })();
  }, [record.documentId]);

  if (failed) return <section className="p-4 text-sm text-[var(--ff-text-secondary)]">Couldn’t load line items. Approve from the summary above, or open the full record.</section>;
  if (!po) return <section className="p-4 text-sm text-[var(--ff-text-tertiary)]">Loading items…</section>;

  return (
    <section className="p-4 space-y-3">
      <p className="text-sm text-[var(--ff-text-tertiary)]">Supplier</p>
      <p className="text-[var(--ff-text-primary)] -mt-2">{po.supplierName}</p>
      <ul className="divide-y divide-[var(--ff-border-light)] rounded-lg border border-[var(--ff-border-light)]">
        {po.items.map((it, i) => (
          <li key={i} className="p-3">
            <p className="text-sm text-[var(--ff-text-primary)]">{it.description}</p>
            <div className="mt-1 flex justify-between text-xs text-[var(--ff-text-secondary)]">
              <span>{it.quantityOrdered} {it.unitOfMeasure} × {money(it.unitPrice)}</span>
              <span className="text-[var(--ff-text-primary)]">{money(it.lineTotal)}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="text-sm space-y-1 pt-1">
        <div className="flex justify-between"><dt className="text-[var(--ff-text-secondary)]">Subtotal</dt><dd className="text-[var(--ff-text-primary)]">{money(po.subtotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--ff-text-secondary)]">VAT</dt><dd className="text-[var(--ff-text-primary)]">{money(po.taxAmount)}</dd></div>
        <div className="flex justify-between pt-1 border-t border-[var(--ff-border-light)]"><dt className="font-semibold text-[var(--ff-text-primary)]">Total</dt><dd className="font-semibold text-[var(--ff-text-primary)]">{money(po.totalAmount)}</dd></div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run ci:quick`
```bash
git add src/modules/procurement/approvals/mobile/panels/PurchaseOrderPanel.tsx
git commit -m "feat(procurement): PO approval detail panel (mobile line items)"
```

---

## Task 8: RequisitionPanel

**Files:** Replace `src/modules/procurement/approvals/mobile/panels/RequisitionPanel.tsx`.

**Interfaces:** Fetches `GET /api/procurement/requisitions/{documentId}` → `{ items: {description, quantity, unitOfMeasure, suggestedSupplierName}[], requestedByName, status }` (shape confirmed in `pages/api/procurement/requisitions/[id].ts`, `result.items.map(...)`).

- [ ] **Step 1: Implement** (same card-list structure as Task 7; fields: `description`, `quantity`, `unitOfMeasure`, `suggestedSupplierName`). Mirror the PO panel's loading/failed handling and Tailwind classes. Keep < 200 lines.

```tsx
// src/modules/procurement/approvals/mobile/panels/RequisitionPanel.tsx
import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import type { ApprovalRequestRecord } from '../types';

interface ReqItem { description: string; quantity: number; unitOfMeasure?: string; suggestedSupplierName?: string; }
interface Requisition { requestedByName: string | null; items: ReqItem[]; }

export function RequisitionPanel({ record }: { record: ApprovalRequestRecord }) {
  const [req, setReq] = useState<Requisition | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/procurement/requisitions/${record.documentId}`);
        const data = await res.json();
        if (data.success) setReq(data.data); else setFailed(true);
      } catch (err) { log.error('Requisition panel load failed', { error: err }, 'procurement'); setFailed(true); }
    })();
  }, [record.documentId]);

  if (failed) return <section className="p-4 text-sm text-[var(--ff-text-secondary)]">Couldn’t load items. Approve from the summary above, or open the full record.</section>;
  if (!req) return <section className="p-4 text-sm text-[var(--ff-text-tertiary)]">Loading items…</section>;

  return (
    <section className="p-4 space-y-3">
      <ul className="divide-y divide-[var(--ff-border-light)] rounded-lg border border-[var(--ff-border-light)]">
        {req.items.map((it, i) => (
          <li key={i} className="p-3">
            <p className="text-sm text-[var(--ff-text-primary)]">{it.description}</p>
            <div className="mt-1 flex justify-between text-xs text-[var(--ff-text-secondary)]">
              <span>{it.quantity} {it.unitOfMeasure ?? ''}</span>
              {it.suggestedSupplierName && <span className="truncate">{it.suggestedSupplierName}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run ci:quick`
```bash
git add src/modules/procurement/approvals/mobile/panels/RequisitionPanel.tsx
git commit -m "feat(procurement): requisition approval detail panel (mobile)"
```

---

## Task 9: ApprovalActionBar + ReasonBottomSheet

**Files:** Replace `src/modules/procurement/approvals/mobile/ApprovalActionBar.tsx`; create `ReasonBottomSheet.tsx`. Test: `src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx`.

**Interfaces:** `<ApprovalActionBar record onActioned>`. Posts to `POST /api/procurement/approvals/{id}/{approve|reject|park}` with `{ notes }`. Reject and Park require a non-empty reason via `ReasonBottomSheet`. Hides entirely when `!record.canAct` (shows a read-only status line). Disables buttons while a request is in flight.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalActionBar } from '../ApprovalActionBar';
import type { ApprovalRequestRecord } from '../types';

const rec = (over: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord => ({
  id: 'a1', documentType: 'purchase_order', documentId: 'd', documentNumber: 'PO-1', documentAmount: 1,
  status: 'pending', requestedBy: null, requestedByName: null, requestedAt: null, requestNotes: null,
  dueDate: null, isOverdue: false, workflowName: null, levelName: null, levelNumber: 1,
  approverType: 'role', approverName: null, canAct: true, ...over,
});

beforeEach(() => { vi.restoreAllMocks(); });

it('hides actions when canAct is false', () => {
  render(<ApprovalActionBar record={rec({ canAct: false })} onActioned={() => {}} />);
  expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
});

it('approve posts to the approve endpoint and calls onActioned', async () => {
  const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
    { ok: true, json: async () => ({ success: true }) } as Response);
  const onActioned = vi.fn();
  render(<ApprovalActionBar record={rec()} onActioned={onActioned} />);
  fireEvent.click(screen.getByRole('button', { name: /approve/i }));
  await waitFor(() => expect(onActioned).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith('/api/procurement/approvals/a1/approve', expect.objectContaining({ method: 'POST' }));
});

it('reject requires a reason before it can submit', async () => {
  render(<ApprovalActionBar record={rec()} onActioned={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /reject/i }));
  const submit = await screen.findByRole('button', { name: /confirm reject/i });
  expect(submit).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ReasonBottomSheet**

```tsx
// src/modules/procurement/approvals/mobile/ReasonBottomSheet.tsx
import { useState } from 'react';

export function ReasonBottomSheet({ title, confirmLabel, onConfirm, onCancel, busy }: {
  title: string; confirmLabel: string; onConfirm: (reason: string) => void; onCancel: () => void; busy: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onCancel}>
      <div className="w-full rounded-t-2xl bg-[var(--ff-bg-secondary)] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-[var(--ff-text-primary)]">{title}</h3>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder="Reason (required)"
          className="w-full px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]" />
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-3 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]">Cancel</button>
          <button onClick={() => onConfirm(reason.trim())} disabled={!valid || busy}
            className="flex-1 py-3 rounded-lg bg-red-600 text-white disabled:opacity-50">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement ApprovalActionBar**

```tsx
// src/modules/procurement/approvals/mobile/ApprovalActionBar.tsx
import { useState } from 'react';
import { CheckCircle, XCircle, Pause } from 'lucide-react';
import { log } from '@/lib/logger';
import { ReasonBottomSheet } from './ReasonBottomSheet';
import type { ApprovalRequestRecord, ApprovalActionType } from './types';

export function ApprovalActionBar({ record, onActioned }: { record: ApprovalRequestRecord; onActioned: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'reject' | 'park'>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!record.canAct) {
    return <div className="fixed bottom-0 inset-x-0 p-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-center text-sm text-[var(--ff-text-secondary)]">
      {record.status === 'pending' ? 'You are not an approver for this request.' : `This request is already ${record.status}.`}
    </div>;
  }

  const act = async (action: ApprovalActionType, notes?: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/procurement/approvals/${record.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (data.success) { setSheet(null); onActioned(); }
      else setErr(data.error?.message || `Failed to ${action}`);
    } catch (e) { log.error(`Approval ${action} failed`, { error: e }, 'procurement'); setErr(`Failed to ${action}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err && <div className="fixed bottom-20 inset-x-0 mx-4 p-2 rounded-lg bg-red-500/20 text-red-300 text-sm text-center">{err}</div>}
      <div className="fixed bottom-0 inset-x-0 flex gap-2 p-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <button onClick={() => setSheet('reject')} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-lg border border-red-500/50 text-red-400 disabled:opacity-50"><XCircle className="h-4 w-4" />Reject</button>
        <button onClick={() => setSheet('park')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] disabled:opacity-50"><Pause className="h-4 w-4" />Park</button>
        <button onClick={() => act('approve')} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-lg bg-green-600 text-white disabled:opacity-50"><CheckCircle className="h-4 w-4" />Approve</button>
      </div>
      {sheet === 'reject' && <ReasonBottomSheet title="Reject request" confirmLabel="Confirm reject" busy={busy} onCancel={() => setSheet(null)} onConfirm={(r) => act('reject', r)} />}
      {sheet === 'park' && <ReasonBottomSheet title="Park request" confirmLabel="Confirm park" busy={busy} onCancel={() => setSheet(null)} onConfirm={(r) => act('park', r)} />}
    </>
  );
}
```

> Confirm the reject/park endpoints read the reason from `req.body.notes` (grep them). If `reject.ts` expects `reason` instead of `notes`, send the key it expects. The park endpoint uses `park_reason` in the DB but the request body key must match its handler.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify + commit**

```bash
npm run ci:quick
git add src/modules/procurement/approvals/mobile/ApprovalActionBar.tsx src/modules/procurement/approvals/mobile/ReasonBottomSheet.tsx src/modules/procurement/approvals/mobile/__tests__/ApprovalActionBar.test.tsx
git commit -m "feat(procurement): sticky approval action bar + reason sheet"
```

---

## Task 10: Mobile-first pass on the `/procurement/approvals` inbox

**Files:** Modify `pages/procurement/approvals/index.tsx`.

**Goal:** the existing inbox list is the secondary entry. Make it usable on a phone: (a) each row links to `/procurement/approvals/{item.id}` (the new mobile route) instead of only exposing inline buttons; (b) the header/filter bar stacks on mobile (same pattern as the PO fix — `flex-col sm:flex-row`, `min-w-0`, `flex-wrap`); (c) status-tab bar scrolls (`overflow-x-auto`) instead of overflowing.

- [ ] **Step 1: Read the current file** to locate the header row, the status-tab bar, and each list item's container.

Run: `sed -n '155,300p' pages/procurement/approvals/index.tsx`

- [ ] **Step 2: Make the header row responsive**

Change the header container (the `flex items-center justify-between` around the title + settings link, ~line 161) to `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`, add `min-w-0` to the title block.

- [ ] **Step 3: Make the status-tab bar scroll**

On the tab bar container (~line 191, `flex items-center gap-1 ...`), add `overflow-x-auto` and `whitespace-nowrap`; keep each tab `shrink-0`.

- [ ] **Step 4: Wrap each list row in a link to the mobile detail route**

Each approval row should navigate to `/procurement/approvals/${item.id}` on tap (use `next/link` or `router.push` in an onClick on the row container), while keeping the existing inline action buttons working on desktop (stop propagation on those buttons so tapping Approve doesn't also navigate).

- [ ] **Step 5: Verify build + lint**

Run: `npm run ci:quick`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pages/procurement/approvals/index.tsx
git commit -m "feat(procurement): mobile-first pass on approvals inbox + link rows to mobile detail"
```

---

## Task 11: Browser E2E on dev (mobile viewport)

**Files:** none committed. Uses the project's playwriter mobile method (see [[feedback_my_offline_browser_e2e_method]] / [[feedback_sitecam_e2e_photo_driving]]).

**Precondition:** merge Tasks 1–10 and deploy to dev (`bash scripts/deploy-local.sh dev`). Have a real `pending`-status approval id (e.g. `SELECT id FROM approval_requests WHERE status='pending' LIMIT 1`) and a signed-in `/sign-in` session in the driving browser.

- [ ] **Step 1: Deep-link + redirect-back** — in a fresh (logged-out) context at viewport 390×844, navigate to `https://dev.fibreflow.app/procurement/approvals/<id>`; assert it lands on `/sign-in?returnUrl=/procurement/approvals/<id>`; sign in; assert it returns to the approval screen.
- [ ] **Step 2: Layout** — assert no horizontal overflow at 360/390/430px (`document.documentElement.scrollWidth <= innerWidth`), and the sticky action bar's Approve button is within the viewport (`rect.right <= innerWidth`).
- [ ] **Step 3: Review + Approve** — assert PO line items render; tap Approve; assert the request leaves `pending` (re-fetch the read endpoint → `canAct=false` / status `approved`). Use a disposable/test approval row; do not approve a real high-value PO. Roll back the row if needed (`UPDATE approval_requests SET status='pending', responded_by=NULL ... WHERE id=<id>`).
- [ ] **Step 4: Reject reason** — on another test row, tap Reject → assert Confirm is disabled until a reason is typed → submit → assert status `rejected`.
- [ ] **Step 5: Record evidence** — capture a mobile screenshot of the review screen with the action bar visible; note results in the PR.

---

## Self-Review (completed)

**Spec coverage:** §2 primary flow → Tasks 1,4,7,9,11. §3 unified surface → Tasks 4,6. §4 component units → Tasks 4–9 (one task per unit). §5 auth/redirect-back → Task 1; approve-eligibility → Task 2. §6 edge handling → Task 9 (`canAct` hide, already-actioned status line), Tasks 7/8 (panel read degrade to fallback). §7 open items → all resolved: single-item read = Task 3; login redirect-back = exists, hardened in Task 1; approve authz = Task 2; requisition shape = confirmed (Task 8); layout = slim layout (Task 4); approver display = Task 5 header. §8 phasing → Tasks 1–11 = Phase 1; Phase 2/3 out of this plan. §9 testing → Tasks 2,3,6,9 unit; Task 11 E2E.

**Placeholder scan:** no "TBD/TODO/handle edge cases" left; every code step shows real code. Two intentional "temporary stub / re-export" notes (Task 4 child stubs, Task 6 panel re-exports) are explicitly replaced by later tasks and called out.

**Type consistency:** `ApprovalRequestRecord` (camelCase) is defined once in `types.ts` and consumed identically by the read endpoint (Task 3 emits it), header (Task 5), panels (Tasks 6–8), and action bar (Task 9). `isEligibleApprover`/`EligibilityInput` signatures match between Task 2 (definition) and Task 3 (consumer). Endpoint action paths `/approve|reject|park` match between Task 2 (handlers) and Task 9 (caller).

**Verify-before-build caveats folded in:** the two "grep to confirm the real key/helper" notes (reject/park body key in Task 9; `apiResponse.forbidden` existence in Task 2; `node-mocks-http` availability in Task 2) are explicit steps, not assumptions.
