# RBAC Confidential Data Audit Report

**Date:** 2026-04-01
**Auditor:** Claude (automated)
**Scope:** All FibreFlow modules containing financial, compensation, or personally identifiable data

---

## Executive Summary

FibreFlow has a **well-designed RBAC system** with database-driven permissions at module/page/tab/action granularity. However, there is a critical gap: **API routes for sensitive modules do not enforce permission checks server-side** — they rely only on `withAuth()` (authenticated user = access granted). The sidebar correctly hides modules based on permissions, but a determined user could call the APIs directly.

### Risk Rating

| Area | Rating | Notes |
|------|--------|-------|
| Authentication | **STRONG** | JWT + session validation, expiry checks |
| Sidebar/UI Filtering | **STRONG** | `filterNavigationItemsRBAC()` correctly hides modules |
| Staff Sensitive Data | **STRONG** | Dedicated `staffAccessService` with field-level filtering |
| Accounting API Routes | **DECOMMISSIONED** | Blocked via middleware 2026-04-01 |
| Conduit API Routes | **CRITICAL** | Uses `auth-mock` — NO REAL AUTH, hardcoded demo user |
| Tracker API Routes | **CRITICAL** | Uses `auth-mock` — NO REAL AUTH, no DB permissions exist |
| Contractor API Routes | **HIGH** | `withAuth` only, returns bank account numbers |
| Project Finance API Routes | **HIGH** | Finance dashboard uses `withAuth` only |
| Assets API Routes | **HIGH** | `requireAuth` only, exposes purchase prices & depreciation |
| Billing API Routes | **MEDIUM** | 2/5 routes have `withRole('manager')`, 3/5 use `withAuth` only |
| Procurement API Routes | **STRONG** | Granular RBAC with 30+ permission keys |

---

## 1. RBAC System Architecture

### How It Works

```
User logs in -> JWT token -> withAuth() verifies session
                          -> Sidebar filters items via rbacKey + can()
                          -> API routes SHOULD check withPermission() but mostly don't
```

**Database Tables:**
- `access_permissions` — 80+ permission keys (module/page/tab/action hierarchy)
- `role_permissions` — maps roles to permission keys with CRUD actions
- `user_permission_overrides` — per-user grants/revokes (override role defaults)

### Roles (10 defined)

| Role | Level | Active Users |
|------|-------|-------------|
| `super_admin` | 6 | 9 (Hein, Handre, JP, Lester, Lew, Marco, Melanie, Janice, Zander) |
| `system` | 5 | 1 (system@fibreflow.app) |
| `admin` | 4 | 4 (admin@fibreflow.com, admin@velocityfibre.com, Lizelle, Mishke) |
| `manager` | 3 | 16 (Cecelia, Ettiene, Frans, Hanro, Hartwig, Jacques, Jaun, Jody, Johan, Johann, Kobus, Louis E, Michael, Sello, Vivian, Warwick) |
| `storeman` | 2 | 0 |
| `technician` | 2 | 5 (Byron, Gladwell, Lindani, tech@fibreflow.com, Zain) |
| `viewer` | 1 | 31 (field staff, site managers, general workers) |
| `contractor` | - | 0 active |
| `project_manager` | - | 0 active |
| `site_supervisor` | - | 0 active |
| `client` | - | 0 active |

---

## 2. Sensitive Data Inventory

### Module: Accounting (120 API routes)

**Data exposed:** Bank transactions, journal entries, supplier payments, customer invoices, bank reconciliations, VAT returns, trial balance, balance sheet, cash flow, budgets, cost centres, write-offs, credit notes, batch payments, audit trail

**Sensitivity:** CRITICAL — Full company financial records

**API Auth:**
- All 120 routes use `withAuth()` only
- **ZERO** routes use `withPermission()` or `withRole()`

**Sidebar RBAC:** `rbacKey: 'accounting'` — correctly filtered

**Who has access (via role_permissions):**

| Role | accounting (view) | Notes |
|------|-------------------|-------|
| super_admin | Yes | Full CRUD |
| admin | Yes | Full CRUD |
| manager | Yes | View + Edit + Create (no delete) |
| contractor | No | Blocked |
| storeman | No | Blocked |
| technician | No role entry | Falls through to denied |
| viewer | No role entry | Falls through to denied |

**User-level overrides on accounting:**

| User | Role | Override |
|------|------|----------|
| Warwick Woodiwiss | manager | **GRANTED** full CRUD (all accounting pages) |
| Louis Ellis | manager | REVOKED (all accounting pages blocked) |
| Lester Vergie | super_admin | REVOKED (all accounting pages blocked) |
| Reynard (inactive?) | manager | REVOKED (all accounting pages blocked) |

**Risk:** Any `manager` can call `/api/accounting/*` endpoints directly and get data, even if their sidebar hides the module. The permission check only happens at UI level, not API level.

---

### Module: Staff / HR (18 API routes)

**Data exposed:**
- **Employment Tab:** Salary amount, hourly rate, salary grade, benefits package
- **Documents Tab:** SA ID numbers, passport numbers, driver's licenses
- **Compliance Tab:** Tax numbers, UIF numbers
- **Export:** Bank account numbers, bank branch codes, emergency contacts

**Sensitivity:** CRITICAL — PII + compensation data

**API Auth:** `withAuth()` only on all routes

**Frontend Protection:** **STRONG** — `StaffDetail.tsx` checks `canViewSensitive` via `staffAccessService`:
- `people.staff.sensitive` permission key controls access
- Field-level filtering via `filterStaffFields()` — sensitive fields stripped for `limited` access
- Self-view allowed (staff can see own data)
- Export columns filtered by access level

**Who can view staff sensitive data (`people.staff.sensitive`):**

| User | Role | Access |
|------|------|--------|
| Hein van Vuuren | super_admin | Full CRUD (explicit grant) |
| Melanie Odendaal | super_admin | Full CRUD (explicit grant) |
| Mishke Tauber | admin | Full CRUD (explicit grant) |
| Hanro Oosthuizen | manager | View + Edit + Create (explicit grant) |
| Handre van Niekerk | super_admin | View only (explicit grant) |
| Lizelle Mouton | admin | Edit + Create + Delete but **NO view** (likely misconfigured) |
| All other super_admins | super_admin | Bypasses RBAC entirely (code grants all) |
| Jacques Langenhoven | manager | Explicitly blocked |
| Warwick Woodiwiss | manager | Explicitly blocked |
| Lester Vergie | super_admin | Explicitly blocked |

**Anomaly:** Lizelle has `{edit: true, view: false}` on `people.staff.sensitive` — she can edit but not view? This looks like a misconfiguration.

**Risk:** MEDIUM — Frontend is well-protected, but the `/api/staff/[staffId]` endpoint itself only uses `withAuth()`. A manager who is blocked from the UI could still call the API directly and get raw data including salary fields. The `staffAccessService` filtering only happens when the service layer is called — direct SQL queries in API routes may not filter.

---

### Module: Project Finance (1 dedicated route + in-project tabs)

**Data exposed:**
- Contract values, total invoiced, total outstanding
- Profit margins, margin percentages
- Income vs expenses breakdown
- Budget vs actual spend
- Client PO values

**Sensitivity:** HIGH — Project profitability data

**API Auth:** `/api/projects/[projectId]/finance/dashboard` — `withAuth()` only

**Frontend Protection:** NONE — `FinanceDashboardTab.tsx` and `ProjectIncomeTab.tsx` have no `usePermission()` checks

**Who has access (via `projects` permission):**

| Role | projects (view) |
|------|----------------|
| super_admin | Yes |
| admin | Yes |
| manager | Yes |
| contractor | Yes (view only) |
| technician | Yes (view only) |
| viewer | Yes (view only) |

**Risk:** HIGH — There is NO `projects.finance` permission key. Anyone who can view a project can see its financial data including margins and profitability. Contractors and viewers can see project contract values if they can access the Finance tab.

---

### Module: Procurement (22+ API routes)

**Data exposed:** PO values, quote amounts, unit prices, supplier pricing, BOQ costs, GRN values

**Sensitivity:** HIGH — Supplier pricing and purchase costs

**API Auth:** All routes use `withAuth()` **plus** the procurement module has its own RBAC middleware with 30+ granular permissions (`boq:read`, `rfq:create`, `stock:adjust`, etc.)

**Who has access:**

| Role | procurement (view) |
|------|-------------------|
| super_admin | Yes (full) |
| admin | Yes (full) |
| manager | Yes (edit/create) |
| storeman | Yes — **has access to procurement including financial, purchasing, POs, quotes** |
| contractor | No |
| technician | No role entry |
| viewer | No role entry |

**User overrides:**
- Jacques Langenhoven (manager) — GRANTED full procurement access
- Warwick, Lester, Louis E, Reynard, Janice — REVOKED

**Risk:** LOW — Best-protected sensitive module. Has both middleware-level and granular permission checks.

---

### Module: Billing / FT Billing (5 API routes)

**Data exposed:** Weekly billing amounts, reconciliation data, DR billing history

**Sensitivity:** HIGH — Revenue data

**API Auth:**
- `upload-weekly.ts` — `withAuth` + `withRole('manager')` 
- `reconcile.ts` — `withAuth` + `withRole('manager')`
- `weekly.ts` — `withAuth` only
- `status.ts` — `withAuth` only
- `dr-history.ts` — `withAuth` only

**Risk:** MEDIUM — Read endpoints (weekly, status, dr-history) accessible to any authenticated user.

---

### Module: Analytics / KPI

**Data exposed:** Project performance metrics, financial reports, operations reports

**Sensitivity:** MEDIUM-HIGH — Aggregated financial data

**Who has access (via `analytics` permission):**

| Role | analytics (view) |
|------|-----------------|
| super_admin | Yes |
| admin | Yes |
| manager | Yes |
| contractor | No |
| storeman | No |
| technician | No role entry |
| viewer | No role entry |

**Note:** `analytics.reports.financial` is a defined permission key, which is good. But enforcement depends on whether the API route checks it.

---

### Module: Clients

**Data exposed:** Credit limits, total revenue per client, outstanding balances, tax numbers, registration numbers, payment terms

**Sensitivity:** HIGH — Client financial relationship data

**Frontend:** `ClientFinancialSection.tsx` — NO permission checks, displays all financial data

**Who has access:**

| Role | clients (view) |
|------|---------------|
| super_admin | Yes |
| admin | Yes |
| manager | Yes |
| contractor | No |
| storeman | No |
| technician | Yes (view only) |
| viewer | Yes (view only) |

**Risk:** HIGH — Technicians and viewers can see client financial data (credit limits, revenue, outstanding balances). No separate permission for sensitive client financial data.

---

### Module: Conduit (Project Financial Scoping) — 15 API routes

**Data exposed:** Revenue per project, cost of service (COS) breakdown (services, materials, OPEX, lump costs), gross profit, gross profit %, cost per home, ARPU rates, all service rates (pole plant, permissions, stringing, optical, activation, wayleave), all material rates, monthly OPEX (casuals, fuel, overheads, sales, ad hoc), wayleave lump sums

**Sensitivity:** CRITICAL — Complete project profitability and unit economics

**API Auth:** ALL 15 routes use `getAuth()` from `lib/auth-mock.ts` which is a **hardcoded mock** that always returns `{ userId: 'demo-user-123', role: 'admin' }`. **There is NO real authentication on any Conduit route.** Any HTTP request to `/api/conduit/*` is accepted without a token.

**Frontend note:** Comment in `page.tsx` says "Restricted: internal use only (Hein, Lew, Hanro)" — but this is a code comment, not an enforced check.

**DB permissions:** Only `conduit` (module) and `conduit.main` (tab) exist. No role mappings found — no roles have explicit conduit permissions.

**Sidebar:** `rbacKey: 'conduit'` — sidebar filtering works, but API is wide open.

**Risk:** CRITICAL — **Zero authentication**. Anyone who can reach the server can access all project financial scoping data.

---

### Module: Tracker / PON Tracker (Master Tracker) — 8 API routes

**Data exposed:** Contractor unit rates (pole_rate, civil_rate, stringing_rate, home_rate, activation_rate, optical_rate), invoice numbers, invoice dates, paid/unpaid status per service, all contractor payment tracking

**Sensitivity:** CRITICAL — Contractor pricing and payment data

**API Auth:** ALL 8 routes use `getAuth()` from `lib/auth-mock.ts` — same hardcoded mock as Conduit. **No real authentication.**

**DB permissions:** No `tracker` permission keys exist in `access_permissions` table at all.

**Sidebar:** `rbacKey: 'tracker'` defined but no DB entry to validate against.

**Risk:** CRITICAL — **Zero authentication**. Contractor rates and invoice data accessible without login.

---

### Module: Contractors — 20+ API routes

**Data exposed:**
- `bank_name`, `account_number`, `branch_code` (banking details for payment)
- `registration_number` (business registration)
- `directors` (company director information)
- Contract values via `contractors-projects` routes

**Sensitivity:** HIGH — Banking details and business registration

**API Auth:** All routes use `withAuth()` — real JWT authentication. But NO `withPermission()` or `withRole()` checks.

**Who has access (via `contractors` permission):**

| Role | contractors (view) |
|------|-------------------|
| super_admin | Yes |
| admin | Yes |
| manager | Yes |
| contractor | View only |
| technician | No role entry |
| viewer | No role entry |

**Risk:** HIGH — Bank account numbers returned to any authenticated user. The `/api/contractors/[contractorId]` endpoint returns `bankName`, `accountNumber`, `branchCode` in the response with no field-level filtering.

---

### Module: Assets — 12 API routes

**Data exposed:** `purchase_price`, `salvage_value`, `depreciation_years`, asset category depreciation settings

**Sensitivity:** MEDIUM-HIGH — Asset valuations

**API Auth:** Uses `requireAuth()` from `@/lib/auth/app-router` — real JWT check, but no permission/role validation.

**Sidebar:** `rbacKey: 'assets'` — sidebar filtering works.

**Risk:** MEDIUM — Purchase prices and depreciation visible to any authenticated user. Less sensitive than banking/salary data.

---

### Module: Fleet — 15+ API routes

**Data exposed:** `fuel_rate_per_km`, `depreciation_rate_per_km`, vehicle ownership type (leased/company/rental)

**Sensitivity:** MEDIUM — Operational cost rates

**API Auth:** Uses `withFleetAuth()` which accepts either user JWT or fleet portal plate-based tokens. No RBAC permission checks.

**Risk:** MEDIUM — Cost rates per km visible to fleet portal users.

---

### Modules With No Financial Data (Safe)

| Module | Confirmed Safe |
|--------|---------------|
| NOC | Operational tickets only, no financial data |
| Field Operations | QA workflows, photo processing only |
| Activate | DR review, VLM validation only |
| Communications | WhatsApp messaging, meetings only |

---

## 3. Critical Findings

### Finding 1: Conduit & Tracker Use `auth-mock` — ZERO Real Auth (CRITICAL)

Both Conduit (15 routes) and Tracker (8 routes) import `getAuth()` from `lib/auth-mock.ts`, which is a **hardcoded stub** that always returns `{ userId: 'demo-user-123', role: 'admin' }`. **No JWT, no session, no login required.** Any HTTP request to these endpoints is accepted.

**Data at risk:** All project revenue, COS, profit margins, unit rates, contractor rates, invoice data.

**Root cause:** These modules were built with the App Router (`app/api/`) and imported a mock auth helper during development that was never replaced with real auth.

### Finding 2: Contractor API Returns Bank Account Numbers (HIGH)

`/api/contractors/[contractorId]` returns `bankName`, `accountNumber`, `branchCode` to any authenticated user. No field-level filtering, no permission check beyond `withAuth()`. All 16 managers + 4 admins + 9 super_admins can see contractor banking details.

### Finding 3: Accounting Module Decommissioned (RESOLVED)

~~120 API routes with `withAuth` only~~ — **Blocked via middleware on 2026-04-01.** All `/api/accounting/*`, `/api/sage/*`, and related cron routes now return 410 Gone. Accounting permissions deactivated in DB.

### Finding 4: No Project Finance Permission Key (HIGH)

There is no `projects.finance` permission key. The Finance tab is visible to anyone with `projects` view access, which includes contractors, technicians, and viewers. They can see contract values, margins, and profitability.

### Finding 5: Client Financial Data Unprotected (HIGH)

`ClientFinancialSection.tsx` displays credit limits, revenue, and outstanding balances with zero permission checks. Technicians and viewers (31 users) who can view clients will see this data.

### Finding 6: No Tracker Permission Keys Exist (HIGH)

The `tracker` module has a sidebar `rbacKey` but **no matching entries in `access_permissions`**. This means the RBAC system cannot control tracker access — it falls through to "no permission found" behavior.

### Finding 7: Assets Expose Purchase Prices (MEDIUM)

Asset API routes use `requireAuth()` only. Purchase prices, salvage values, and depreciation data visible to any authenticated user.

### Finding 8: Lizelle Mouton Permission Anomaly (LOW)

`people.staff.sensitive` override: `{edit: true, view: false}` — can edit sensitive staff data but can't view it. Likely a batch update error.

### Finding 9: 5 Roles Have No Permission Entries (LOW)

`project_manager`, `site_supervisor`, `client`, `contractor` (0 active users each) and `storeman` (0 active) have incomplete or zero permission entries. If users are assigned these roles, they'd have unpredictable access.

---

## 4. Who Can See What — Summary Matrix

| Sensitive Data | super_admin | admin | manager | technician | viewer |
|---------------|-------------|-------|---------|-----------|--------|
| **Accounting** (bank txns, invoices, journals) | Yes | Yes | Yes (unless overridden) | Sidebar hidden, **API accessible** | Sidebar hidden, **API accessible** |
| **Staff Salaries** (employment tab) | Yes | Only with grant | Only with grant | No (frontend blocks) | No (frontend blocks) |
| **Staff PII** (ID, bank, tax numbers) | Yes | Only with grant | Only with grant | No (frontend blocks) | No (frontend blocks) |
| **Project Finance** (margins, contract values) | Yes | Yes | Yes | **Yes** (view) | **Yes** (view) |
| **Client Financials** (credit, revenue) | Yes | Yes | Yes | **Yes** (view) | **Yes** (view) |
| **Procurement Pricing** (PO, quotes, costs) | Yes | Yes | Yes | No | No |
| **Billing** (weekly amounts) | Yes | Yes | Yes | **API accessible** | **API accessible** |

---

## 5. Recommendations (Priority Order)

### P0 — Immediate (This Week)

1. **Replace `auth-mock` with real auth in Conduit & Tracker** (23 routes)
   - Replace `import { getAuth } from '@/lib/auth-mock'` with `import { requireAuth } from '@/lib/auth/app-router'`
   - This is the single highest-risk item — these routes have ZERO authentication

2. **Strip bank details from contractor list/detail API responses**
   - Add field-level filtering: only return `bankName`, `accountNumber`, `branchCode` to users with `contractors.banking` permission (new key)
   - Or: remove banking fields from default response, add separate `/api/contractors/[id]/banking` endpoint with `withPermission`

3. **Create `tracker` permission keys in DB**
   - Add `tracker` (module), `tracker.master` (page), `tracker.pon` (page)
   - Assign to super_admin, admin, manager only

### P1 — This Sprint

4. **Add `withPermission('projects.finance')` check to finance dashboard API**
   - Create `projects.finance` permission key in `access_permissions`
   - Block contractors, technicians, viewers from project financial data

5. **Add permission check to client financial endpoints**
   - Create `clients.financial` permission key
   - Only grant to super_admin, admin, manager

6. **Add `withRole('manager')` to remaining billing read endpoints**
   - `weekly.ts`, `status.ts`, `dr-history.ts` need role checks

7. **Fix Lizelle's permission anomaly**
   - `people.staff.sensitive`: `{edit: true, view: false}` should probably be `{edit: true, view: true}`

### P2 — Next Sprint

8. **Add `requireAuth` to all Assets API routes** and create `assets.financial` permission key

9. **Add `analytics.reports.financial` enforcement** to analytics API routes

10. **Audit and remove unused roles** (`project_manager`, `site_supervisor`, `client`) or populate their permissions

11. **Add API access audit logging** — log when users access sensitive endpoints for compliance

### Resolved

- ~~Accounting API Routes (120 routes)~~ — **DECOMMISSIONED 2026-04-01** via middleware block + DB permission deactivation

---

## Appendix A: Users With Sensitive Data Access

### Accounting Access (effective)

| User | Role | Access Level |
|------|------|-------------|
| Hein van Vuuren | super_admin | Full (bypasses RBAC) |
| Handre van Niekerk | super_admin | Full (bypasses RBAC) |
| JP Terblanche | super_admin | Full (bypasses RBAC) |
| Lew Hofmeyr | super_admin | Full (bypasses RBAC) |
| Marco Devenier | super_admin | Full (bypasses RBAC) |
| Melanie Odendaal | super_admin | Full (bypasses RBAC) |
| Zander van Vuuren | super_admin | Full (bypasses RBAC) |
| Lester Vergie | super_admin | **BLOCKED** (override revokes all) |
| Janice George | super_admin | Full (bypasses RBAC — no accounting override) |
| Lizelle Mouton | admin | Full CRUD (role default) |
| Mishke Tauber | admin | Full CRUD (role default) |
| Warwick Woodiwiss | manager | **GRANTED** full CRUD (override) |
| All other managers | manager | View + Edit + Create (role default) |
| Louis Ellis | manager | **BLOCKED** (override revokes all) |

### Staff Sensitive Data Access (effective)

| User | Access | Method |
|------|--------|--------|
| All super_admins (except Lester) | Full | RBAC bypass |
| Lester Vergie | **BLOCKED** | Override revokes |
| Hein van Vuuren | Full CRUD | Explicit grant |
| Melanie Odendaal | Full CRUD | Explicit grant |
| Mishke Tauber | Full CRUD | Explicit grant |
| Hanro Oosthuizen | View + Edit + Create | Explicit grant |
| Handre van Niekerk | View only | Explicit grant |
| Lizelle Mouton | Edit/Create/Delete, **no view** | Likely misconfigured |
| All other managers/admins | **No access** | No role default for `people.staff.sensitive` |

### Procurement Financial Access (effective)

| User | Access |
|------|--------|
| All super_admins (except Janice, Lester) | Full |
| Janice George | **BLOCKED** (super_admin but override revokes) |
| Lester Vergie | **BLOCKED** |
| All admins | Full CRUD |
| Jacques Langenhoven | **GRANTED** full CRUD |
| All other managers | View + Edit + Create (role default) |
| Warwick, Louis E, Reynard | **BLOCKED** |

---

*Report generated from live database query and codebase analysis on 2026-04-01.*
