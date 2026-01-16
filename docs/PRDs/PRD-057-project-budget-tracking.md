# PRD-057: Project Budget Tracking System

## Document Information
- **PRD Number**: PRD-057
- **Title**: Project Budget Tracking System
- **Author**: Claude (PAI)
- **Created**: 2026-01-16
- **Status**: Draft
- **Priority**: High

---

## 1. Overview

### 1.1 Problem Statement
Currently, FibreFlow has no mechanism to:
- Track project budgets against actual spending
- Prevent over-budget purchases
- Provide visibility into committed vs actual costs
- Alert users when approaching budget limits

The `projects` table has `budget` and `actual_cost` fields that are never updated, leaving project managers blind to financial health.

### 1.2 Solution Summary
Implement a comprehensive budget tracking system that:
- Calculates budgets from approved BOQs or manual entry
- Tracks committed costs (approved POs) vs actual costs (completed GRNs)
- Enforces budget limits with override approval workflow
- Provides real-time budget health visibility with alerts

### 1.3 Success Metrics
- 100% of PO approvals check budget availability
- Budget alerts triggered at 80% and 100% thresholds
- Over-budget POs blocked (unless override approved)
- Budget variance visible on project dashboard

---

## 2. User Stories

### 2.1 Project Manager
```
As a Project Manager
I want to see my project's budget health at a glance
So that I can make informed procurement decisions
```

**Acceptance Criteria:**
- [ ] Budget dashboard shows: Total Budget, Committed, Actual, Available
- [ ] Color-coded health indicator (green/yellow/red)
- [ ] Category breakdown with progress bars
- [ ] Transaction history viewable

### 2.2 Procurement Officer
```
As a Procurement Officer
I want to be warned before creating an over-budget PO
So that I don't accidentally exceed project limits
```

**Acceptance Criteria:**
- [ ] Budget check happens before PO submission
- [ ] Warning shown when utilization > 80%
- [ ] PO blocked when utilization would exceed 100%
- [ ] Override request option available

### 2.3 Finance Admin
```
As a Finance Admin
I want to adjust project budgets with proper audit trail
So that budgets reflect approved changes
```

**Acceptance Criteria:**
- [ ] Manual budget adjustment with reason required
- [ ] All adjustments logged in transaction history
- [ ] Admin-only permission for adjustments
- [ ] Approval required for large adjustments

### 2.4 System
```
As the System
I want to automatically update budget figures when POs/GRNs change status
So that budget tracking is always accurate
```

**Acceptance Criteria:**
- [ ] PO approval → committed_amount increases
- [ ] PO cancellation → committed_amount decreases
- [ ] GRN completion → actual_amount increases
- [ ] All changes create transaction records

---

## 3. Functional Requirements

### 3.1 Budget Creation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1.1 | System SHALL allow creating budget from approved BOQ | Must |
| FR-3.1.2 | System SHALL allow manual budget entry | Must |
| FR-3.1.3 | System SHALL support hybrid (BOQ + manual adjustments) | Should |
| FR-3.1.4 | Budget SHALL have approval workflow before activation | Must |
| FR-3.1.5 | Only one active budget per project | Must |

### 3.2 Budget Categories

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.2.1 | System SHALL provide 7 default categories | Must |
| FR-3.2.2 | Admins SHALL be able to add custom categories | Should |
| FR-3.2.3 | Each category SHALL track allocated/committed/actual | Must |
| FR-3.2.4 | BOQ sync SHALL map BOQ categories to budget categories | Should |

**Default Categories:**
1. MATERIALS - Materials & Consumables
2. EQUIPMENT - Equipment & Tools
3. LABOR - Labor Costs
4. SUBCONTRACT - Subcontractor Work
5. TRANSPORT - Transport & Logistics
6. OVERHEAD - Overhead & Admin
7. CONTINGENCY - Contingency Reserve

### 3.3 Budget Tracking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.3.1 | committed_amount SHALL update on PO approval | Must |
| FR-3.3.2 | committed_amount SHALL reverse on PO cancellation | Must |
| FR-3.3.3 | actual_amount SHALL update on GRN completion | Must |
| FR-3.3.4 | available_budget SHALL be calculated (total - committed) | Must |
| FR-3.3.5 | variance_percent SHALL be calculated automatically | Must |
| FR-3.3.6 | All changes SHALL create transaction records | Must |

### 3.4 Budget Enforcement

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.4.1 | PO creation SHALL check budget availability | Must |
| FR-3.4.2 | System SHALL block over-budget POs by default | Must |
| FR-3.4.3 | System SHALL allow override with approval | Must |
| FR-3.4.4 | enforce_budget flag SHALL be configurable per project | Should |
| FR-3.4.5 | Category-level enforcement SHALL be optional | Could |

### 3.5 Budget Alerts

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.5.1 | Alert SHALL trigger at 80% utilization (warning) | Must |
| FR-3.5.2 | Alert SHALL trigger at 100% utilization (critical) | Must |
| FR-3.5.3 | Alerts SHALL be acknowledgeable | Should |
| FR-3.5.4 | Alert thresholds SHALL be configurable | Could |

### 3.6 Budget Adjustments

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.6.1 | Admin users SHALL be able to adjust budgets | Must |
| FR-3.6.2 | Adjustments SHALL require reason | Must |
| FR-3.6.3 | All adjustments SHALL be logged | Must |
| FR-3.6.4 | Large adjustments SHALL require approval | Should |

---

## 4. Technical Design

### 4.1 Database Schema

#### 4.1.1 New Tables

**project_budgets**
```sql
CREATE TABLE project_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) UNIQUE,
    source_type VARCHAR(30) NOT NULL, -- 'manual', 'boq', 'hybrid'
    boq_id UUID REFERENCES boqs(id),

    total_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'ZAR',

    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,

    available_budget DECIMAL(15,2) GENERATED ALWAYS AS
        (total_budget - committed_amount) STORED,
    variance_amount DECIMAL(15,2) GENERATED ALWAYS AS
        (total_budget - actual_amount) STORED,
    variance_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN total_budget > 0
            THEN ((total_budget - actual_amount) / total_budget * 100)
            ELSE 0
        END
    ) STORED,

    status VARCHAR(30) DEFAULT 'draft',
    enforce_budget BOOLEAN DEFAULT true,
    allow_override BOOLEAN DEFAULT true,

    alert_threshold_warning DECIMAL(5,2) DEFAULT 80,
    alert_threshold_critical DECIMAL(5,2) DEFAULT 100,

    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**budget_categories**
```sql
CREATE TABLE budget_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id),

    category_code VARCHAR(50) NOT NULL,
    category_name VARCHAR(255) NOT NULL,

    allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,

    available_amount DECIMAL(15,2) GENERATED ALWAYS AS
        (allocated_amount - committed_amount) STORED,

    is_custom BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(project_budget_id, category_code)
);
```

**budget_transactions**
```sql
CREATE TABLE budget_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id),
    category_id UUID REFERENCES budget_categories(id),

    transaction_type VARCHAR(30) NOT NULL,
    -- 'allocation', 'adjustment', 'commitment', 'commitment_reversal', 'receipt'

    source_type VARCHAR(50),
    source_id UUID,
    source_number VARCHAR(100),

    amount DECIMAL(15,2) NOT NULL,
    tax_amount DECIMAL(15,2) DEFAULT 0,

    running_committed DECIMAL(15,2),
    running_actual DECIMAL(15,2),

    description TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**budget_alerts**
```sql
CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id),

    alert_type VARCHAR(30) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    threshold_percent DECIMAL(5,2),
    current_percent DECIMAL(5,2),

    title VARCHAR(255) NOT NULL,
    message TEXT,

    status VARCHAR(20) DEFAULT 'active',
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 4.1.2 Schema Modifications

**purchase_orders** - Add columns:
- `budget_category_id UUID REFERENCES budget_categories(id)`
- `budget_override_approved BOOLEAN DEFAULT false`
- `budget_override_by VARCHAR(255)`
- `budget_override_reason TEXT`

**projects** - Add columns:
- `budget_status VARCHAR(30)` -- 'not_set', 'draft', 'approved', 'over_budget'
- `budget_health VARCHAR(20)` -- 'healthy', 'warning', 'critical'
- `budget_utilization DECIMAL(5,2) DEFAULT 0`

### 4.2 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/[id]/budget` | Get budget summary |
| POST | `/api/projects/[id]/budget` | Create budget |
| PUT | `/api/projects/[id]/budget` | Update budget |
| POST | `/api/projects/[id]/budget/sync-boq` | Sync from BOQ |
| POST | `/api/projects/[id]/budget/adjust` | Manual adjustment |
| GET | `/api/projects/[id]/budget/categories` | List categories |
| POST | `/api/projects/[id]/budget/categories` | Add category |
| GET | `/api/projects/[id]/budget/transactions` | Transaction history |
| GET | `/api/projects/[id]/budget/alerts` | Get alerts |
| POST | `/api/budget/check` | Check availability |

### 4.3 Database Functions

**check_budget_availability(project_id, amount, category_id)**
- Returns: `{allowed, reason, available, shortfall, allow_override}`

**check_budget_thresholds(budget_id)**
- Creates alerts at warning/critical thresholds
- Updates project.budget_health

**sync_boq_to_budget(project_id, boq_id, created_by)**
- Creates budget from approved BOQ
- Maps categories

### 4.4 Database Triggers

**update_budget_on_po_approval()**
- ON purchase_orders UPDATE
- When status → 'approved': Add to committed
- When status → 'cancelled': Reverse commitment

**update_budget_on_grn_completion()**
- ON goods_receipt_notes UPDATE
- When status → 'completed': Add to actual

---

## 5. User Interface

### 5.1 Budget Dashboard Widget
- Location: Project detail page
- Shows: Total, Committed, Actual, Available
- Donut chart visualization
- Health indicator (color-coded)
- Link to full budget page

### 5.2 Budget Management Page
- Route: `/projects/[id]/budget`
- Sections:
  - Overview card (total, source, status)
  - Category breakdown table
  - Transaction history
  - Alerts panel
  - Actions (Sync BOQ, Adjust, Lock)

### 5.3 PO Creation Budget Check
- Location: PO create form
- Shows available budget
- Warning banner at 80%+
- Block modal at 100%+ with override option

---

## 6. Testing Requirements

### 6.1 Unit Tests
- [ ] Budget calculation functions
- [ ] Threshold checking logic
- [ ] Category allocation validation

### 6.2 Integration Tests
- [ ] Budget creation from BOQ
- [ ] PO approval updates committed amount
- [ ] GRN completion updates actual amount
- [ ] Budget check API returns correct availability

### 6.3 E2E Tests
- [ ] Create budget manually
- [ ] Sync budget from BOQ
- [ ] Create PO within budget (success)
- [ ] Create over-budget PO (blocked)
- [ ] Request and approve override

---

## 7. Migration Plan

### Phase 1: Schema (Migration 056)
1. Create all new tables
2. Add columns to existing tables
3. Create functions and triggers
4. Seed default categories

### Phase 2: API
1. Budget CRUD endpoints
2. Budget check endpoint
3. Category management

### Phase 3: Integration
1. Modify PO creation flow
2. Add GRN budget recording
3. BOQ sync functionality

### Phase 4: UI
1. Budget dashboard widget
2. Budget management page
3. PO creation warnings

---

## 8. Dependencies

- PRD-050: Procurement Portal (purchase_orders, grn tables)
- BOQ system (boqs, boq_items tables)
- Approval workflows (approval_requests table)

---

## 9. Out of Scope

- Invoice tracking (future phase)
- Non-procurement expenses (schema included, UI deferred)
- Multi-currency conversion
- Budget forecasting/projections

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Trigger performance on high-volume POs | Medium | Index optimization, async processing |
| Existing POs have no budget link | Low | Migration script to backfill |
| BOQ category mismatch | Low | Allow manual category mapping |

---

## 11. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Tech Lead | | | |
| QA Lead | | | |
