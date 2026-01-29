# Projects Module Comprehensive Restructure Design

**Date:** 2026-01-28
**Status:** Draft for Review

---

## Overview

This document designs a holistic restructure of the Projects module covering:
1. Module-level navigation (procurement-style tabs + sub-tabs)
2. Project detail page organization
3. Budget integration (bidirectional linking with Procurement)
4. Edit functionality (currently broken)

---

## Part 1: Module Navigation Structure

### Current State (Flat)
```
[Dashboard] [Project List] [Pipeline] [Tasks] [Progress] [Health & Safety]
```

### Proposed State (Hierarchical)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PROJECTS                                                                    │
│  Manage and track fiber optic projects                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Dashboard] [Projects ▼] [Pipeline ▼] [Execution ▼] [H&S ▼] [Reports]     │
├─────────────────────────────────────────────────────────────────────────────┤
│              ○ All  ○ Active  ○ Completed  ○ + New                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tab Configuration

| Main Tab | Sub-Tabs | Path | Description |
|----------|----------|------|-------------|
| **Dashboard** | - | `/projects` | Portfolio overview, KPIs, quick actions |
| **Projects** | All Projects | `/projects/list` | Full project list |
| | Active | `/projects/list?status=active` | Filtered to active |
| | Completed | `/projects/list?status=completed` | Filtered to completed |
| | + New Project | `/projects/new` | Create new project |
| **Pipeline** | Overview | `/projects/pipeline` | Kanban/pipeline view |
| | Authorities | `/projects/pipeline/authorities` | Municipal authorities |
| | Alerts | `/projects/pipeline/alerts` | Pipeline alerts |
| **Execution** | Daily Progress | `/projects/daily-progress` | Daily status updates |
| | Tasks | `/projects/tasks` | Task management |
| | Reports | `/projects/progress` | Progress reports |
| **Health & Safety** | Dashboard | `/projects/health-safety` | H&S overview |
| | Incidents | `/projects/health-safety/incidents` | Incident reports |
| | Checklists | `/projects/health-safety/checklists` | Safety checklists |
| **Reports** | - | `/projects/reports` | Analytics & reporting |

---

## Part 2: Project Detail Page (`/projects/[id]`)

### Current 10 Tabs
1. Overview, 2. Team, 3. Procurement, 4. Maintenance, 5. Hierarchy,
6. SOW Data, 7. Agreements, 8. Timeline, 9. Budget, 10. Health & Safety

### Proposed Organization (Grouped into 5 Sections)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PROJECT: Greenfields Phase 2                                    [Edit] [⋮] │
│  Client: Vodacom  |  Status: Active  |  Progress: 67%                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Overview] [Work ▼] [Resources ▼] [Finance ▼] [Compliance ▼]              │
├─────────────────────────────────────────────────────────────────────────────┤
│            ○ SOW Data  ○ BOQ  ○ Timeline  ○ Tasks  ○ Hierarchy             │
└─────────────────────────────────────────────────────────────────────────────┘

Work Section Breakdown:
├── SOW Data      → Physical network scope (drops, poles, fiber)
├── BOQ           → Materials needed (links to Procurement)
├── Timeline      → Activity log + milestones
├── Tasks         → Project tasks
└── Hierarchy     → Parent/child projects

Resources Section Breakdown:
├── Team          → Staff assignments
├── Contractors   → Service providers + agreements (labor SOW)
├── Maintenance   → Tickets for this project
└── Procurement   → RFQs, POs, GRNs (created from BOQ)
```

### Tab Groupings

| Section | Sub-Tabs | Content |
|---------|----------|---------|
| **Overview** | - | Info cards, progress, quick stats, key details |
| **Work** | SOW Data | Drops, poles, fiber scope (physical network data) |
| | BOQ | Bill of Quantities - materials needed for project |
| | Timeline | Activity timeline + milestones |
| | Tasks | Project-specific tasks |
| | Hierarchy | Parent/child projects |
| **Resources** | Team | Staff assignments |
| | Contractors | Contractors + service agreements (labor SOW) |
| | Maintenance | Tickets assigned to project |
| | Procurement | RFQ, PO, GRN summary (linked from BOQ) |
| **Finance** | Budget | Budget overview, categories, transactions |
| | Agreements | Cession, wayleave documents |
| **Compliance** | Health & Safety | Audits, incidents, checklists |

### BOQ in Project Context

The **Work → BOQ** tab shows:
- BOQs imported for this project (materials list)
- Status: Draft → Approved → Synced to Budget
- Quick actions: Import BOQ, Sync to Budget, Create RFQ
- Link to full BOQ in Procurement module

### Contractors/Services in Project Context

The **Resources → Contractors** tab shows:
- Contractors assigned to this project
- Service agreements (scope of work per contractor)
- Labor/service budget impact
- Link to Contractor detail page

### Edit Functionality (Currently Broken)

The `ProjectForm` component is a stub. Needs complete rebuild:

**Required Fields:**
- Basic: Name, Code, Description
- Client: Client selection (dropdown)
- Dates: Start date, End date, Deadline
- Financial: Budget, Currency
- Team: Project Manager selection
- Status: Status, Priority, Progress
- Location: Address, Coordinates
- Metadata: Project type, Tags

---

## Part 3: Budget Integration Architecture

### The Problem
Currently budget exists in two places:
- **Project Budget** (`/projects/[id]/budget`) - Per-project view
- **Procurement Financial** (`/procurement/financial`) - Portfolio view

These need bidirectional linking, PLUS two distinct input sources:
1. **BOQ** (Bill of Quantities) = Materials, equipment, consumables
2. **SOW** (Scope of Work) = Services linked to contractors

### Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       COMPLETE BUDGET DATA FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    INPUT SOURCES (Per Project)                       │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                       │    │
│  │  BOQ Import ────────────────┬───► Materials, Equipment, Consumables  │    │
│  │  (Materials/Quantities)      │     → MATERIALS, EQUIPMENT categories │    │
│  │                              │                                        │    │
│  │  SOW/Contractor Services ───┴───► Labor, Subcontract Services        │    │
│  │  (Services/Scope)                 → LABOR, SUBCONTRACT categories    │    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    PROJECT BUDGET                                    │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │  project_budgets ◄──────► Budget Categories                          │    │
│  │       │                   (MATERIALS, LABOR, EQUIPMENT, SUBCONTRACT, │    │
│  │       │                    TRANSPORT, OVERHEAD, CONTINGENCY)         │    │
│  │       ▼                                                               │    │
│  │  project_budget_items ◄──► Budget Transactions                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    PROCUREMENT EXECUTION                             │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │  BOQ Items ─────► RFQ (Quotes) ─────► PO (Orders) ─────► GRN        │    │
│  │                                          │                   │       │    │
│  │                                          │                   │       │    │
│  │                                   (commitment)         (actual)      │    │
│  │                                          │                   │       │    │
│  │                                          └───────┬───────────┘       │    │
│  │                                                  │                   │    │
│  │                                                  ▼                   │    │
│  │                                    budget_transactions               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### BOQ vs SOW Distinction

| Aspect | BOQ (Bill of Quantities) | SOW (Scope of Work) |
|--------|--------------------------|---------------------|
| **Contains** | Materials, equipment, consumables | Services, labor scope |
| **Linked To** | Procurement (RFQ → PO → GRN) | Contractors |
| **Budget Categories** | MATERIALS, EQUIPMENT | LABOR, SUBCONTRACT |
| **Import Path** | `/procurement/boq/new` | Project → Contractors tab |
| **Budget Sync** | `POST /api/projects/[id]/budget/sync-boq` | Contractor agreements |
| **Tracking** | Quantities ordered/received | Service milestones/deliverables |

### BOQ Import Flow (Per Project)

```
1. Upload BOQ Excel ──► Parse & Validate ──► Create BOQ record
                                                    │
2. Map items to material catalog ──────────────────┤
                                                    │
3. Approve BOQ ────────────────────────────────────┤
                                                    │
4. Sync to Project Budget ─────────────────────────┤
   POST /api/projects/[id]/budget/sync-boq          │
   • Creates budget categories                       │
   • Sets allocated amounts                          │
                                                    │
5. Create RFQs from BOQ items ─────────────────────┤
   • Request quotes from suppliers                   │
                                                    │
6. PO Creation ────────────────────────────────────┤
   • Commitment recorded in budget_transactions      │
                                                    │
7. GRN Receipt ────────────────────────────────────┘
   • Actual spend recorded in budget_transactions
```

### SOW/Contractor Services Flow

```
1. Define SOW for Project ──► Scope items, deliverables
                                      │
2. Assign Contractors ────────────────┤
   • Link contractor to project        │
   • Define service agreement          │
                                      │
3. Service Agreement ─────────────────┤
   • Rate per unit/day/deliverable     │
   • Payment milestones                │
                                      │
4. Budget Impact ─────────────────────┤
   • LABOR category allocation         │
   • SUBCONTRACT category allocation   │
                                      │
5. Progress & Payment ────────────────┘
   • Work completion tracking
   • Payment transactions
```

### Database Tables (Existing)

```sql
-- Project budget
project_budgets (
  id, project_id, total_budget, committed_amount, actual_amount,
  available_budget, status, source_type, currency
)

-- Budget line items (from BOQ)
project_budget_items (
  id, project_budget_id, material_id, category_id, quantity,
  unit_price, total_amount, committed_qty, received_qty
)

-- Transactions (PO commits, GRN receipts)
budget_transactions (
  id, project_budget_id, transaction_type, amount, source_type,
  source_id, source_number, category_id
)
```

### Integration Points

#### 1. Purchase Order → Project Budget
When PO is created/approved for a project:
- Create `budget_transaction` with `type='commitment'`
- Update `project_budgets.committed_amount`
- Update `project_budget_items.committed_qty`

#### 2. GRN Receipt → Project Budget
When GRN is received for a project:
- Create `budget_transaction` with `type='receipt'`
- Update `project_budgets.actual_amount`
- Update `project_budget_items.received_qty`

#### 3. Project Budget → Procurement Views
Procurement Financial page should show:
- All projects with budgets
- Click project → goes to `/projects/[id]/budget`
- Aggregated metrics across projects

#### 4. Procurement Item → Project Link
Every procurement item (BOQ, RFQ, PO, GRN) should:
- Display project name/link in list views
- Have "View Project" action
- Show project budget impact

### UI Links Required

| From | To | Link Type |
|------|-----|-----------|
| Project Budget page | Procurement Financial | "View in Procurement" button |
| Project Procurement tab | Project Budget tab | "View Budget" button |
| Procurement PO list | Project detail | Project name link |
| Procurement GRN list | Project detail | Project name link |
| Procurement Financial | Project Budget | Project row click |
| BOQ list | Project detail | Project name link |
| RFQ list | Project detail | Project name link |

---

## Part 4: Implementation Plan

### Phase 1: Navigation Config (Day 1)
1. Update `projects.config.ts` with new tab structure
2. Add sub-tabs to main tabs
3. Test navigation flow

### Phase 2: Page Wrappers (Day 1-2)
1. Wrap all project pages with `ModulePage`
2. Ensure consistent header/tabs across pages
3. Handle sub-tab highlighting

### Phase 3: Project Detail Refactor (Day 2-3)
1. Group existing tabs into sections
2. Add section-level tab navigation
3. Maintain URL-based tab state

### Phase 4: Edit Form Rebuild (Day 3-4)
1. Design comprehensive project form
2. Implement all required fields
3. Add validation with Zod
4. Connect to API

### Phase 5: Budget Integration (Day 4-5)
1. Add bidirectional links in UI
2. Verify transaction flow (PO → Budget)
3. Add project links to procurement lists
4. Test end-to-end budget flow

---

## Design Decisions (Confirmed)

1. **Tab Naming:** "Execution" ✓

2. **Project Edit:** Full page (more space for all fields) ✓

3. **Budget Display:** Summary card in detail page → click to open full budget page ✓

4. **Timeline Tab:** Both activity log AND milestone tracking ✓

5. **Project Statuses:** Pipeline → Planned → Active → FAC (Complete)

6. **Zone Maintenance Trigger:** Zones automatically transition to maintenance at 80% penetration

7. **Bidirectional Linking:** All project data links to/from relevant modules

---

## Part 5: Project Status Lifecycle

### Status Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ PIPELINE │ ──►│ PLANNED  │ ──►│  ACTIVE  │ ──►│   FAC    │
│          │    │          │    │          │    │(Complete)│
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │                              │
     │                              ▼
     │                    ┌─────────────────┐
     │                    │  ZONE → MAINT   │
     │                    │  (80% penetr.)  │
     │                    └─────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ Pipeline Module: Authorities, Approvals, Planning        │
└──────────────────────────────────────────────────────────┘
```

### Status Definitions

| Status | Description | Typical Duration |
|--------|-------------|------------------|
| **Pipeline** | In planning/approval stage, managed via Pipeline module | Weeks to months |
| **Planned** | Approved, resources allocated, ready to start | Days to weeks |
| **Active** | Construction in progress | Months |
| **FAC** | Final Acceptance Certificate issued, project complete | - |

### Zone Maintenance Trigger

When a zone reaches **80% penetration** (homes connected / homes passed):
1. Zone status changes to "In Maintenance"
2. Maintenance tickets for that zone are enabled
3. Zone appears in Maintenance module dashboard
4. Project remains Active until all zones complete

---

## Part 6: Bidirectional Module Linking

### Core Principle
Every piece of data belongs to a project and should be accessible from both:
- The project detail page (aggregated view)
- The relevant module (full functionality)

### Link Matrix

| Module | In Project Detail | Links To | Links Back |
|--------|-------------------|----------|------------|
| **Staff** | Team tab shows assigned staff | Staff profile page | Staff → Projects tab |
| **Contractors** | Contractors tab shows service providers | Contractor detail page | Contractor → Projects tab |
| **BOQ** | Work → BOQ tab shows materials list | `/procurement/boq/[id]` | BOQ → Project link |
| **Procurement** | Procurement tab shows RFQ/PO/GRN | Procurement item pages | PO/GRN → Project link |
| **Budget** | Finance tab shows summary | Full budget page | Budget → Project header |
| **Maintenance** | Maintenance tab shows tickets | Maintenance ticket detail | Ticket → Project link |
| **H&S** | Compliance tab shows audits | H&S incident/audit pages | Incident → Project link |
| **Pipeline** | (Pipeline status projects) | Pipeline project detail | Pipeline → Main project |
| **Clients** | Header shows client | Client detail page | Client → Projects tab |

### BOQ ↔ Project ↔ Procurement Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  PROJECT        │     │  BOQ            │     │  PROCUREMENT    │
│  Work → BOQ tab │◄───►│  /procurement/  │◄───►│  RFQ → PO → GRN │
│                 │     │  boq/[id]       │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                    PROJECT BUDGET                                  │
│  • BOQ sync creates MATERIALS/EQUIPMENT allocations                │
│  • PO creates commitment transaction                               │
│  • GRN creates actual spend transaction                            │
└───────────────────────────────────────────────────────────────────┘
```

### Contractor ↔ Project ↔ Budget Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  PROJECT        │     │  CONTRACTOR     │     │  SERVICE        │
│  Resources →    │◄───►│  /contractors/  │◄───►│  AGREEMENT      │
│  Contractors    │     │  [id]           │     │  (rate, scope)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                    PROJECT BUDGET                                  │
│  • Service agreement creates LABOR/SUBCONTRACT allocations         │
│  • Work completion creates actual spend transaction                │
└───────────────────────────────────────────────────────────────────┘
```

### UI Implementation

#### Project Detail → Module Links
Each tab should have a "View in [Module]" action:
```
┌─────────────────────────────────────────────────────────┐
│ Team                                    [View in Staff →]│
├─────────────────────────────────────────────────────────┤
│ • John Smith (Project Manager)          [View Profile]   │
│ • Jane Doe (Site Engineer)              [View Profile]   │
│ • Contractor: ABC Constructions         [View Details]   │
└─────────────────────────────────────────────────────────┘
```

#### Module → Project Links
Every list item should show project context:
```
┌─────────────────────────────────────────────────────────┐
│ Maintenance Tickets                                      │
├─────────────────────────────────────────────────────────┤
│ #MT-001 | Fiber break at pole 42                        │
│         | Project: Greenfields Phase 2 [View Project →] │
│         | Zone: Zone A (85% penetration - Maintenance)  │
└─────────────────────────────────────────────────────────┘
```

### Required Changes by Module

#### Staff Module
- Add "Projects" tab to staff detail page
- Show all projects where staff is assigned
- Include role on each project

#### Maintenance Module
- Add project link to ticket list columns
- Add project link to ticket detail header
- Filter tickets by project

#### Procurement Module
- Add project column to BOQ/RFQ/PO/GRN lists
- Add project link to item detail pages
- Show project budget impact on PO approval

#### Health & Safety Module
- Add project link to incident list
- Add project link to audit list
- Filter by project

#### Clients Module
- Add "Projects" tab to client detail page
- Show all projects for client with status

---

## Appendix: File Changes Required

### Navigation Config
- `src/modules/navigation/config/modules/projects.config.ts` - **REWRITE**

### Page Wrappers (Add ModulePage)
- `pages/projects/index.tsx`
- `pages/projects/list.tsx`
- `pages/projects/new.tsx`
- `pages/projects/pipeline/index.tsx`
- `pages/projects/pipeline/authorities.tsx`
- `pages/projects/pipeline/alerts.tsx`
- `pages/projects/tasks.tsx`
- `pages/projects/progress.tsx`
- `pages/projects/daily-progress.tsx`
- `pages/projects/health-safety/index.tsx`
- `pages/projects/health-safety/incidents/index.tsx`
- `pages/projects/health-safety/checklists/index.tsx`
- `pages/projects/reports.tsx`

### Project Detail
- `src/pages/ProjectDetail.tsx` - **REFACTOR** (add section tabs)
- `src/pages/detail/ProjectTabs.tsx` - **REFACTOR** (grouped tabs)
- `src/pages/detail/ProjectTimelineTab.tsx` - **IMPLEMENT** (currently stub)

### Project Form
- `src/modules/projects/components/ProjectForm.tsx` - **REWRITE**
- `pages/projects/[id]/edit.tsx` - **UPDATE**

### Budget Integration
- `pages/projects/[id]/budget.tsx` - Add procurement links
- `pages/procurement/financial/index.tsx` - Add project links
- Various procurement list pages - Add project name links
