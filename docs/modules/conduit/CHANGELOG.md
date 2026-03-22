# Conduit Module Changelog

All notable changes to the FibreFlow Conduit (Project Scenario Modelling) module are documented here. This changelog tracks new features, improvements, bug fixes, and breaking changes.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Planned
- Version comparison UI (baseline vs. scenario A/B side-by-side)
- Excel export for project inputs and calculated metrics
- PDF executive summary reports for project approvals
- Actuals integration with FibreFlow Projects module (forecast vs. actual cost tracking)
- Multi-currency support (USD, EUR)
- Advanced sensitivity analysis (vary uptake %, rates, duration → see impact on profit)
- Portfolio dashboard (aggregate revenue, avg profit margin across all projects)

---

## [1.0.0] – 2026-03-21

### Added – Initial Release

**Commit:** `d8a2b440feat(conduit): Module B v1 — Lawley test case (#212)`  
**Author:** VelocityFibre  
**Size:** 1,076 lines, 6 files changed  
**Status:** Shipped to Production

#### Core Features

**1. Project Scenario Modelling**
- Financial forecasting tool for infrastructure builds (fibre network projects)
- Input-driven model: scope, rates, expenses → calculated revenue, costs, profit
- Portfolio table view with all projects and calculated metrics
- Single project detail view with full input/output breakdown

**2. Financial Calculation Engine**
- **Inputs:**
  - Scope: Poles count, stringing metres, PON (Points of Network)
  - Service rates: Permissions/pole, poles each, stringing/m, optical/PON, activation each
  - Stock rates: Pole unit cost, cable/m, optical hardware, activation hardware
  - Monthly expenses: Ad-hoc, casuals, fuel, overheads, sales
  - Project params: Subscription rate, uptake %, start date, build duration (months)
- **Calculated Outputs:**
  - Forecast activations (`PON × uptake`)
  - Revenue (`fc_activation × rate × build_duration`)
  - Cost of Services (`sum of all service labour costs`)
  - Cost of Stock (`sum of all stock/hardware costs`)
  - Cost of Expenses (`sum of monthly expenses × build_duration`)
  - Total Cost (`COS + stock + expenses`)
  - Profit (`revenue - total_cost`)
  - Gross Profit % (`(profit / revenue) × 100`)
  - Cost per Home (`total_cost / (PON × uptake)`)

**3. Baseline Locking**
- Projects can be marked `is_baseline_locked = true` to prevent accidental modification
- Locked projects cannot be edited (enforced at API level)
- Future enhancement: Clone locked project to create scenario variations

**4. Version History Table (Schema Only)**
- `conduit_project_versions` table created for future version control
- Stores snapshots of project inputs with version labels
- UI not yet implemented (v1.0.0 = schema foundation only)

#### API Endpoints

All endpoints available under `/api/conduit/`

| Endpoint | Method | Purpose | RBAC |
|---|---|---|---|
| `/api/conduit/projects` | GET | List all projects | `conduit:view` |
| `/api/conduit/projects` | POST | Create new project | `conduit:create` |
| `/api/conduit/projects/[id]` | GET | Fetch single project by ID | `conduit:view` |
| `/api/conduit/projects/[id]` | PATCH | Update project inputs | `conduit:edit` |
| `/api/conduit/projects/[id]` | DELETE | Delete project | `conduit:delete` (not enforced in v1.0.0) |

**Authentication:** All endpoints require valid `auth.userId` (401 if missing)

**Authorization:** Enforced via `access_permissions` and `user_permission_overrides` tables

#### Database Schema

**Tables Created:**
- `conduit_projects` — Main project scenarios table
  - Fields: `id`, `name`, `po_count`, `start_date`, `build_duration_months`, `inputs_json`, `is_baseline_locked`, `created_at`, `updated_at`
  - Trigger: `trg_conduit_projects_updated_at` (auto-updates `updated_at` on row modification)
  
- `conduit_project_versions` — Version history snapshots
  - Fields: `id`, `project_id`, `version_label`, `inputs_snapshot`, `created_by`, `created_at`
  - Index: `idx_conduit_project_versions_project_id`

**Migration:** `scripts/migrations/sql/249_conduit_module.sql`

#### RBAC Permissions

**Permission Key:** `conduit`

**Actions:**
- `view` — View portfolio table and project details
- `create` — Create new projects
- `edit` — Modify existing projects (blocked if `is_baseline_locked = true`)
- `delete` — Soft-delete projects (not implemented in UI)

**User Assignments (Migration 249):**

| User | view | create | edit | delete |
|---|---|---|---|---|
| Hein (`28ab98c1...`) | ✓ | ✓ | ✓ | ✗ |
| Lew (`7d84184b...`) | ✓ | ✓ | ✓ | ✗ |
| Hanro (`dfb080fa...`) | ✓ | ✗ | ✗ | ✗ |

**Permission Record:**
```sql
INSERT INTO access_permissions (type, key, label, description, sort_order, is_active)
VALUES ('module', 'conduit', 'Conduit', 'Conduit — project scenario modelling', 25, true);

INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order, is_active)
VALUES ('tab', 'conduit.main', 'conduit', 'Portfolio', 'Conduit portfolio table', 1, true);
```

#### Frontend Components

**Page:** `/app/(main)/conduit/page.tsx`
- Route: `/conduit`
- Displays portfolio table with all projects
- Protected by RBAC (`conduit:view`)

**Component:** `/src/modules/conduit/components/PortfolioTable.tsx`
- Renders tabular view of all projects
- Columns: Name, PO Count, Start Date, Build Duration, Revenue, Profit, Gross Profit %, Cost/Home
- Row click → navigate to project detail view
- Create button → open new project form

**Hook:** `/src/modules/conduit/hooks/useConduitCalc.ts`
- Accepts project inputs as parameters
- Returns calculated financial metrics (revenue, costs, profit, etc.)
- Pure calculation logic (no side effects, no API calls)
- Reusable across components

**Types:** `/src/modules/conduit/types/index.ts`
- TypeScript interfaces for all data structures
- Exports: `ScopeInputs`, `ServiceRates`, `StockRates`, `ExpensesPerMonth`, `ConduitProjectInputs`, `ConduitProject`, `ConduitCalcResult`

#### Sidebar Navigation

**Menu Entry:** Analytics section (expanded)
- Label: "Conduit"
- Icon: Calculator (or similar)
- Route: `/conduit`
- RBAC: Visible only if user has `conduit:view` permission

**Config File:** `src/modules/layout/sidebar/config/analyticsSection.ts`

#### Seed Data

**Lawley Project** (default scenario)
- ID: `a1b2c3d4-0000-4000-8000-000000000001`
- Name: "Lawley"
- PO Count: 15,111
- Start Date: 2025-01-01
- Build Duration: 16 months
- Uptake: 60%
- Rate: R2,700/month
- Scope: 4,471 poles, 110,000m stringing, 159 PON
- Service Rates: Permissions R10/pole, Poles R600 each, Stringing R10/m, Optical R9,000/PON, Activation R155 each
- Stock Rates: Pole R993.19, Cable R11.73/m, Optical R4,422.61, Activation R191.68
- Monthly Expenses: Ad-hoc R168,021, Casuals R488,480, Fuel R350,993, Overheads R2,996,992, Sales R0

**Calculated Results (seed):**
- Forecast Activations: 9,066 (159 × 0.6)
- Revenue: R391,651,200 (9,066 × R2,700 × 16)
- (Other metrics calculated by `useConduitCalc`)

#### Files Changed (Summary)

- **API Routes:** 2 new route files (`/api/conduit/projects/route.ts`, `/api/conduit/projects/[id]/route.ts`)
- **Pages:** 1 new page (`/app/(main)/conduit/page.tsx`)
- **Components:** 1 new component (`PortfolioTable.tsx`)
- **Hooks:** 1 new hook (`useConduitCalc.ts`)
- **Types:** 1 new types file (`types/index.ts`)
- **Database:** 1 SQL migration file (`249_conduit_module.sql`)
- **Navigation:** Updated analytics sidebar config

#### Non-Goals (Deferred to Future Releases)

- Version comparison UI — Table exists, UI not built
- Excel/PDF export — Not implemented
- Actuals tracking — Forecast only, no integration with actual project costs
- Multi-currency support — ZAR (Rands) only
- Advanced sensitivity analysis — Manual input variation only
- Portfolio dashboard — No aggregate metrics view

#### Breaking Changes

None. Conduit is a new module with no dependencies on existing modules.

#### Migration Path

**For Users:**
1. Navigate to `/conduit` (visible in Analytics menu if RBAC grants `conduit:view`)
2. View Lawley seed project
3. Create new projects via "New Project" button (if RBAC grants `conduit:create`)

**For Developers:**
1. Run migration: `psql -d fibreflow < scripts/migrations/sql/249_conduit_module.sql`
2. Restart Next.js dev server (types are auto-imported)
3. Test RBAC enforcement: Create test users with/without `conduit` permissions

---

## Notes for Maintainers

- **Calculation Logic:** All financial metrics are derived from inputs (never stored). If calculation logic changes, update `useConduitCalc.ts` hook.
- **RBAC Enforcement:** All `/api/conduit/*` endpoints check `auth.userId` and `conduit` permission. Do not bypass middleware.
- **Baseline Locking:** When `is_baseline_locked = true`, PATCH requests should return 403 Forbidden. Verify enforcement in `/api/conduit/projects/[id]/route.ts`.
- **Version History:** `conduit_project_versions` table exists but UI not implemented. Do not delete this table — it's reserved for future version control feature.
- **Seed Data:** Lawley project is seeded with realistic values for testing. Do not delete this row in production (used for training/demos).
- **Database Trigger:** `update_conduit_projects_updated_at()` function auto-updates `updated_at` timestamp. Do not remove this trigger.

---

**Format Version:** 1.0  
**Last Updated:** 2026-03-22  
**Maintained By:** Scribe (Documentation)
