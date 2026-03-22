# Conduit Module — Product Requirements Document

**Module:** Conduit  
**Version:** 1.0.0  
**Status:** Shipped (Production)  
**Commit:** d8a2b440  
**Author:** VelocityFibre  
**Date:** 2026-03-21

---

## Overview

**Conduit** is a financial scenario modelling tool for infrastructure projects. It enables project managers and financial analysts to forecast revenue, costs, and profitability for fibre network builds before execution.

### Purpose

Replace static Excel-based project forecasting with a dynamic, version-controlled, collaborative planning tool that:
- Models project financials (revenue, costs, profit margins)
- Tracks baseline vs. scenario variations
- Supports portfolio-level planning across multiple builds
- Integrates with FibreFlow's RBAC and audit systems

---

## Business Context

### Problem Statement

Infrastructure projects (e.g., Lawley fibre build) require detailed financial forecasting before approval:
- **Revenue projections** based on uptake rate × subscription fee × forecast activations
- **Cost of Services** (permissions, pole installation, stringing, optical, activation labour)
- **Stock costs** (poles, cable, optical equipment, activation hardware)
- **Monthly expenses** (ad-hoc costs, casuals, fuel, overheads, sales)
- **Profitability analysis** (gross profit %, cost per home passed)

Currently done in Excel → no version control, no collaboration, no audit trail, prone to copy-paste errors.

### Target Users

| Role | Use Case | Permissions |
|---|---|---|
| **Hein** | Project approval, portfolio review | View, Create, Edit |
| **Lew** | Financial modelling, scenario planning | View, Create, Edit |
| **Hanro** | Read-only access to approved scenarios | View only |

---

## Features (v1.0.0)

### 1. Project Scenario Management

**Capability:** Create, view, and update project scenarios with financial inputs.

**Data Model:**
- **Scope:** Poles count, stringing metres, PON (Points of Network)
- **Rates:** Service rates (per-pole, per-metre, per-PON, activation), stock rates (poles, cable, optical, activation hardware)
- **Uptake:** Forecasted subscription uptake % (e.g., 60%)
- **Monthly Expenses:** Ad-hoc costs, casuals, fuel, overheads, sales
- **Build Timeline:** Start date, build duration (months)

**Calculations (derived, not stored):**
- `fc_activation` = Forecast activations (PON × uptake)
- `revenue` = fc_activation × subscription rate × build duration
- `cos_services` = Sum of all service labour costs
- `cos_stock` = Sum of all stock/hardware costs
- `cos_expenses` = Sum of monthly expenses × build duration
- `cos_total` = cos_services + cos_stock + cos_expenses
- `profit` = revenue - cos_total
- `gross_profit_pct` = (profit / revenue) × 100
- `cost_per_home` = cos_total / (PON count × uptake)

**UI Component:** `PortfolioTable.tsx` — Displays all projects in tabular format with calculated metrics

### 2. Version Control (Baseline Lock)

**Purpose:** Prevent accidental modification of approved scenarios.

**Behavior:**
- Projects can be marked `is_baseline_locked = true` → prevents edits to inputs
- Locked projects can still be cloned to create scenario variations
- Future enhancement: `conduit_project_versions` table will store full version history

### 3. API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/conduit/projects` | GET | List all projects |
| `/api/conduit/projects` | POST | Create new project |
| `/api/conduit/projects/[id]` | GET | Fetch single project by ID |
| `/api/conduit/projects/[id]` | PATCH | Update project inputs |
| `/api/conduit/projects/[id]` | DELETE | Delete project (soft-delete) |

**RBAC Enforcement:** All endpoints check `conduit` module permission via middleware.

### 4. Database Schema

**Tables:**
- `conduit_projects` — One row per project scenario
  - `id` (uuid, PK)
  - `name` (text) — Project name (e.g., "Lawley")
  - `po_count` (integer) — Number of properties/homes passed
  - `start_date` (date) — Build start date
  - `build_duration_months` (integer) — Build timeline
  - `inputs_json` (jsonb) — All financial inputs (see Data Model above)
  - `is_baseline_locked` (boolean) — Prevents edits
  - `created_at`, `updated_at` (timestamptz)
  
- `conduit_project_versions` — Version history snapshots (future use)
  - `id` (uuid, PK)
  - `project_id` (uuid, FK → conduit_projects)
  - `version_label` (text) — e.g., "Baseline", "Scenario A"
  - `inputs_snapshot` (jsonb) — Full inputs at time of versioning
  - `created_by` (uuid, FK → auth.users)
  - `created_at` (timestamptz)

**Migration:** 249_conduit_module.sql

---

## Use Cases

### UC1: Create New Project Scenario (Lew)

1. Navigate to Conduit module (`/conduit`)
2. Click "New Project"
3. Enter project name (e.g., "Lawley Phase 2")
4. Input scope: poles, stringing metres, PON count
5. Input service rates, stock rates, monthly expenses
6. Set uptake forecast (%), start date, build duration
7. Save → System calculates and displays:
   - Forecast activations
   - Revenue projection
   - Cost breakdown (services, stock, expenses)
   - Gross profit %
   - Cost per home
8. Review calculated metrics, adjust inputs if needed
9. Lock baseline when approved

### UC2: Portfolio Review (Hein)

1. Navigate to Conduit module (`/conduit`)
2. View table of all projects:
   - Project name
   - PO count
   - Start date
   - Build duration
   - Revenue forecast
   - Profit
   - Gross profit %
   - Cost per home
3. Sort by profit margin to prioritize builds
4. Click project row to view detailed inputs and calculations
5. Compare scenarios side-by-side

### UC3: Read-Only Access (Hanro)

1. Navigate to Conduit module (`/conduit`)
2. View portfolio table (read-only)
3. Click project to view detailed inputs
4. Cannot create, edit, or delete projects (RBAC enforced)

---

## Non-Goals (v1.0.0)

- **Multi-user real-time collaboration** — Not supported; last-write-wins
- **Export to Excel/PDF** — Future enhancement
- **Integration with FibreFlow Projects module** — Not linked to actual project execution
- **Actuals tracking** — Conduit is forecasting only; does not track actual costs vs. forecast
- **Advanced scenario comparison UI** — Version history table exists but UI not yet built

---

## Technical Implementation

### Frontend
- **Framework:** Next.js 14 (App Router)
- **UI Components:**
  - `/app/(main)/conduit/page.tsx` — Portfolio table page
  - `/src/modules/conduit/components/PortfolioTable.tsx` — Main table component
  - `/src/modules/conduit/hooks/useConduitCalc.ts` — Financial calculation hook
- **State Management:** React Query (server state), React hooks (UI state)

### Backend
- **API Routes:** `/app/api/conduit/projects/*`
- **Database:** PostgreSQL (Neon serverless)
- **ORM:** Raw SQL (Neon SDK)
- **Auth:** Mock auth (getAuth from @/lib/auth-mock)

### Types
- **Location:** `/src/modules/conduit/types/index.ts`
- **Exports:**
  - `ScopeInputs` — Poles, stringing, PON
  - `ServiceRates` — Labour rates per unit
  - `StockRates` — Hardware costs per unit
  - `ExpensesPerMonth` — Monthly cost buckets
  - `ConduitProjectInputs` — Full input schema
  - `ConduitProject` — DB row schema
  - `ConduitCalcResult` — Calculated outputs

---

## Security & RBAC

**Permission Key:** `conduit`

**Actions:**
- `view` — View portfolio table and project details
- `create` — Create new projects
- `edit` — Modify existing projects (blocked if `is_baseline_locked = true`)
- `delete` — Soft-delete projects (not implemented in v1.0.0)

**Role Assignments (Migration 249):**
| User | view | create | edit | delete |
|---|---|---|---|---|
| Hein | ✓ | ✓ | ✓ | ✗ |
| Lew | ✓ | ✓ | ✓ | ✗ |
| Hanro | ✓ | ✗ | ✗ | ✗ |

**Middleware:** `/api/conduit/*` routes check `auth.userId` and `conduit` permission before processing.

---

## Data Quality & Validation

**Input Validation:**
- `po_count` ≥ 0 (integer)
- `build_duration_months` ≥ 1 (integer)
- `uptake` ∈ [0, 1] (decimal)
- `rate` ≥ 0 (subscription fee)
- All rates and costs ≥ 0
- `start_date` format: YYYY-MM-DD

**Error Handling:**
- Missing required fields → 400 Bad Request
- Invalid JSON structure → 400 Bad Request
- Unauthorized access → 401 Unauthorized
- Database errors → 500 Internal Server Error (logged to console)

---

## Migration & Deployment

**Migration:** 249_conduit_module.sql

**Pre-Deployment Checklist:**
- [x] Migration tested on staging DB
- [x] RBAC permissions verified
- [x] Seed data inserted (Lawley baseline)
- [x] API endpoints tested
- [x] UI tested with Hein, Lew, Hanro accounts

**Rollback Plan:**
- Drop tables: `DROP TABLE conduit_project_versions, conduit_projects CASCADE;`
- Remove permissions: `DELETE FROM access_permissions WHERE key = 'conduit';`
- Remove user overrides: `DELETE FROM user_permission_overrides WHERE permission_key = 'conduit';`

---

## Success Metrics

**Adoption:**
- 3+ projects created within first week
- Hein uses Conduit for next project approval decision

**Accuracy:**
- Forecast variance ≤10% when actual costs become available (tracked manually)

**Usability:**
- Lew can create a project scenario in <5 minutes
- Zero reported calculation errors in first month

---

## Future Enhancements (Backlog)

1. **Version Comparison UI** — Side-by-side view of baseline vs. scenarios
2. **Excel Export** — Export project inputs and calculations to XLSX
3. **PDF Reports** — Generate executive summary PDFs for project approvals
4. **Actuals Integration** — Link to FibreFlow Projects module to track forecast vs. actual
5. **Multi-Currency Support** — Support USD, EUR pricing
6. **Advanced Sensitivity Analysis** — Vary uptake %, build duration, rates to see impact on profitability
7. **Portfolio Dashboard** — Aggregate metrics across all projects (total revenue, avg profit margin, etc.)

---

## Glossary

| Term | Definition |
|---|---|
| **PON** | Point of Network — A network termination point serving multiple homes |
| **Uptake** | Forecasted subscription rate (% of homes passed that subscribe) |
| **Cost of Services (COS)** | Labour costs for network construction |
| **Stringing** | Cable installation along poles (measured in metres) |
| **Activation** | Service connection to a home (labour + hardware) |
| **Gross Profit %** | (Revenue - Total Costs) / Revenue × 100 |
| **Cost per Home** | Total project cost ÷ (PON count × uptake) |

---

## Appendix: Lawley Seed Data

**Project:** Lawley (default scenario)

**Inputs:**
- **Rate:** R2,700/month
- **Uptake:** 60%
- **Scope:**
  - Poles: 4,471
  - Stringing: 110,000 m
  - PON: 159
- **Service Rates:**
  - Permissions: R10/pole
  - Poles: R600 each
  - Stringing: R10/m
  - Optical: R9,000/PON
  - Activation: R155 each
- **Stock Rates:**
  - Pole: R993.19
  - Cable: R11.73/m
  - Optical: R4,422.61
  - Activation: R191.68
- **Monthly Expenses:**
  - Ad-hoc: R168,021
  - Casuals: R488,480
  - Fuel: R350,993
  - Overheads: R2,996,992
  - Sales: R0
- **Build Duration:** 16 months
- **Start Date:** 2025-01-01
- **PO Count:** 15,111

**Calculated Results (seed):**
- Forecast Activations: 9,066 (159 × 0.6)
- Revenue: R391,651,200 (9,066 × R2,700 × 16)
- Cost of Services: (calculated by useConduitCalc)
- Gross Profit %: (calculated by useConduitCalc)
- Cost per Home: (calculated by useConduitCalc)

---

**Document Version:** 1.0  
**Last Updated:** 2026-03-22  
**Maintained By:** Scribe (Documentation)
