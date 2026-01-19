# Final Audit - Production Readiness Testing

**Purpose:** Comprehensive end-to-end testing skill that validates EVERY feature, button, modal, API, form, theme, and function before going live. This is the ultimate QA gate for FibreFlow.

## USE WHEN
- Before deploying to production
- After major feature releases
- When user says "final audit", "production ready test", "go-live test"
- When comprehensive E2E validation is needed

## Quick Reference

```bash
/final-audit                    # Full audit (all modules, both themes)
/final-audit --module=activate  # Single module audit
/final-audit --theme=dark       # Theme-specific audit
/final-audit --quick            # Critical paths only (smoke test)
```

---

## PRE-FLIGHT CHECKS

Before any testing, verify:

```
1. Server running: PORT=3005 npm start (or staging URL)
2. Database connectivity: GET /api/health/db
3. Authentication: User logged in with appropriate role
4. Browser: Chrome with claude-in-chrome extension
5. Theme: Toggle accessible in header
```

### Health Check Endpoints
| Service | Endpoint | Expected |
|---------|----------|----------|
| App Health | `/api/health` | `{ status: "ok" }` |
| Database | `/api/health/db` | Connection success |
| Activate | `/api/activate/health-check` | 5 services green |
| WA Monitor | `/api/wa-monitor-health` | Bridge + Sender OK |

---

## MODULE INVENTORY

| Module | Pages | APIs | Priority | Status |
|--------|-------|------|----------|--------|
| Activate | 5 | 28 | P0 - Critical | ✅ PASS (Jan 2026) |
| Procurement | 21 | 45+ | P0 - Critical | ✅ PASS (Jan 2026) |
| Fleet | 16 | 55+ | P1 - High | ✅ PASS (9/9 tests) |
| Projects | 7 | 20+ | P1 - High | ✅ PASS (8/8 tests) |
| Staff | 5 | 15+ | P1 - High | ✅ PASS (Jan 2026) |
| Suppliers | 2 | 10+ | P2 - Medium | ✅ PASS (11 suppliers) |
| Ticketing | 8 | 40+ | P2 - Medium | ✅ PASS (7/7 tests) |
| Contractors | 4 | 15+ | P2 - Medium | ✅ PASS (Jan 2026) |
| Clients | 4 | 5+ | P3 - Low | ✅ PASS (Jan 2026) |
| Assets | 10 | 20+ | P3 - Low | ✅ PASS (Jan 2026) |

### Latest Audit Results (Jan 19, 2026)

**Environment:** vf.fibreflow.app (Staging)

| Module/Page | Status | Notes |
|-------------|--------|-------|
| Fleet Dashboard | ✅ PASS | All 9 navigation links working |
| Projects | ✅ PASS | 8/8 after removing dead links (Drop Dashboard, Home Installations) |
| Ticketing | ✅ PASS | 7/7 pages accessible |
| People (Staff) | ✅ PASS | List loads correctly |
| Clients | ✅ PASS | List loads correctly |
| Contractors | ✅ PASS | List loads correctly |
| Assets | ✅ PASS | Dashboard loads correctly |
| Suppliers | ✅ PASS | 11 suppliers displayed |
| Procurement Dashboard | ✅ PASS | Stats and actions visible |
| BOQ | ✅ PASS | 3 BOQs displayed |
| RFQ | ✅ PASS | Empty state (no RFQs) |
| Requisitions | ✅ PASS | 3 requisitions (after rebuild) |
| Purchase Orders | ✅ PASS | 49 POs (after rebuild) |
| GRN | ✅ PASS | Goods receipt working (after rebuild) |
| Approvals | ✅ PASS | Approvals list loads |
| Stock Management | ✅ PASS | Stock overview loads |
| Field Stock | ✅ PASS | Field stock list loads |
| Analytics Dashboard | ✅ PASS | Charts render |
| Enhanced KPIs | ✅ PASS | Route: `/enhanced-kpis` |
| Activate Dashboard | ✅ PASS | VLM integration working |
| WA Monitor | ✅ PASS | Dashboard loads |
| Settings | ✅ PASS | Route: `/settings` |

**Issues Fixed During Audit:**
1. **Sidebar Dead Links** - Removed "Drop Dashboard" and "Home Installations" (commit `ef828631`)
2. **500 Errors on Procurement Pages** - Requisitions, POs, GRN returned 500 due to stale build. Fixed by rebuild.

---

## THEME TESTING PROTOCOL

### For EVERY page:

```
1. Navigate to page
2. Screenshot in current theme
3. Toggle to opposite theme
4. Screenshot in new theme
5. Check for:
   - [ ] Background color consistency (compare to /suppliers reference)
   - [ ] Text readability (contrast)
   - [ ] Card/panel backgrounds
   - [ ] Form input styling
   - [ ] Modal backgrounds
   - [ ] Status badge visibility
   - [ ] Hover states
6. Check console for hydration errors
```

### Color Reference (Dark Mode)
| Element | Variable | Hex | Visual |
|---------|----------|-----|--------|
| Page background | `--ff-bg-primary` | `#0f172a` | Dark navy |
| Cards/panels | `--ff-bg-secondary` | `#1e293b` | Slate |
| Inputs/headers | `--ff-bg-tertiary` | `#334155` | Light slate |
| Primary text | `--ff-text-primary` | `#f1f5f9` | Off-white |
| Secondary text | `--ff-text-secondary` | `#cbd5e1` | Light gray |

### Anti-Pattern Check
```tsx
// WRONG - Creates lighter background
<div className="min-h-screen bg-[var(--ff-bg-tertiary)]">

// CORRECT - Inherits from AppLayout
<div className="p-6 space-y-6">
```

---

## CONSOLE & NETWORK AUDIT

### For EVERY page:

```javascript
// Check console for errors
mcp__claude-in-chrome__read_console_messages({
  tabId: T,
  pattern: "error|warning|fail|exception",
  onlyErrors: true
})

// Check network for failed requests
mcp__claude-in-chrome__read_network_requests({
  tabId: T,
  urlPattern: "/api/"
})
```

### Expected: Zero Errors
- No JavaScript exceptions
- No failed API calls (4xx, 5xx)
- No React hydration warnings
- No missing resources (404)
- No CORS errors

---

## MODULE TEST PROTOCOLS

### MODULE: ACTIVATE (P0 - Critical)

**Pages:**
- `/activate` - DR Summary & QA Centre
- `/activate/[dropNumber]` - 5-Phase QA Wizard
- `/activate/monitoring` - Health Dashboard
- `/activate/qa-centre` - QA List
- `/activate/qa-centre/[dropNumber]` - Detail View

**Test Protocol:**

```markdown
TC-ACT-001: DR List Page
  1. Navigate to /activate
  2. Verify tabs: DR Summary, QA Centre, Reports, OES Import, Manual Entry
  3. Click QA Centre tab
  4. Verify: Search, filters (status, project, date), pagination
  5. Search for existing DR number
  6. Verify: Results update, count changes
  7. Export to Excel → Verify download
  8. Screenshot both themes

TC-ACT-002: DR Summary Stats
  1. Click DR Summary tab
  2. Verify: Project cards with stats
  3. Click Zone drill-down → Verify PON breakdown
  4. Screenshot both themes

TC-ACT-003: 5-Phase QA Wizard
  1. Click on a DR to open detail view
  2. Phase 1 (Prerequisites):
     - Verify photo thumbnails load
     - Verify step coverage display
     - Click "Proceed" or see validation errors
  3. Phase 2 (Photo Review):
     - Verify photo gallery
     - Test reassign photo to different step
     - Click approve/override
  4. Phase 3 (Data Validation):
     - Verify power meter value display
     - Verify ONT serial comparison (Step 6 vs Step 9 vs OneMap)
     - Test correction input
  5. Phase 4 (Final Decision):
     - Click PASS/FAIL/REWORK_NEEDED
     - Select reason codes
     - Add notes
     - Submit decision
  6. Phase 5 (Feedback):
     - Verify feedback message generated
     - Test "Send to WhatsApp" button
     - Verify confirmation toast

TC-ACT-004: Manual DR Entry
  1. Click Manual Entry tab
  2. Fill form: DR Number, Project, Photos
  3. Submit → Verify success
  4. Find in QA Centre list

TC-ACT-005: OES Import
  1. Click OES Import tab
  2. Upload test Excel file
  3. Verify: Preview, column mapping
  4. Import → Verify success count

TC-ACT-006: Reports
  1. Click Reports tab
  2. Test each report type:
     - Trends (date range)
     - Funnel (conversion)
     - Team Performance
     - Serial Validation
     - Discrepancy
     - Resubmissions
     - User Attribution
     - Daily Counts
  3. Change filters → Verify data updates
  4. Export each report

TC-ACT-007: Health Monitoring
  1. Navigate to /activate/monitoring
  2. Verify 5 service cards:
     - Database (green)
     - VLM (green)
     - WhatsApp Bridge (green)
     - WA Feedback (green)
     - OneMap (green)
  3. Verify benchmark results display
```

**APIs to Test:**
| Endpoint | Method | Test |
|----------|--------|------|
| `/api/activate/drops` | GET | List with pagination |
| `/api/activate/summary` | GET | Single DR summary |
| `/api/activate/fetch-photos` | POST | Photo fetch |
| `/api/activate/categorize-photos` | POST | VLM categorization |
| `/api/activate/extract-data` | POST | VLM extraction |
| `/api/activate/validate-prerequisites` | POST | Phase 1 |
| `/api/activate/human-review` | POST | Phase 2 corrections |
| `/api/activate/final-decision` | POST | Phase 4 decision |
| `/api/activate/send-feedback` | POST | Phase 5 WhatsApp |
| `/api/activate/health-check` | GET | Service health |
| `/api/activate/export` | GET | Excel export |
| `/api/activate/reporting/*` | GET | All 8 report types |

---

### MODULE: PROCUREMENT (P0 - Critical)

**Pages:**
- `/procurement` - Dashboard
- `/procurement/boq` - Bill of Quantities
- `/procurement/boq/new` - Create BOQ
- `/procurement/boq/[id]` - BOQ Detail
- `/procurement/rfq` - Request for Quote
- `/procurement/rfq/new` - Create RFQ
- `/procurement/rfq/[id]` - RFQ Detail
- `/procurement/purchase-orders` - PO List
- `/procurement/purchase-orders/new` - Create PO
- `/procurement/purchase-orders/[id]` - PO Detail
- `/procurement/grn` - Goods Received
- `/procurement/requisitions` - Requisitions
- `/procurement/approvals` - Approvals
- `/procurement/stock` - Stock Management
- `/procurement/stock-items` - Stock Items Catalog
- `/procurement/field-stock` - Field Stock
- `/procurement/field-stock/reconciliation` - Reconciliation

**Test Protocol:**

```markdown
TC-PROC-001: Dashboard
  1. Navigate to /procurement
  2. Verify: Stats cards, recent activity
  3. Click each quick action → Verify navigation
  4. Screenshot both themes

TC-PROC-002: BOQ CRUD
  1. Navigate to /procurement/boq
  2. Verify: List loads, filters work
  3. Click "Create BOQ"
  4. Fill form:
     - Select project
     - Add line items (use Stock Item Selector modal)
     - Enter quantities, costs
  5. Save → Verify in list
  6. Click to view detail
  7. Edit → Change values → Save
  8. Verify changes persisted

TC-PROC-003: Stock Item Selector Modal
  1. From BOQ/RFQ creation, click "Add Item"
  2. Modal opens (check portal renders correctly)
  3. Search for existing item
  4. Verify: Results appear, can select
  5. Create new item via modal
  6. Verify: Item added to form

TC-PROC-004: RFQ Workflow
  1. Navigate to /procurement/rfq
  2. Click "Create RFQ"
  3. Fill form:
     - Select project
     - Enter title, deadline
     - Add line items
     - Select suppliers (checkbox selection)
  4. Save as Draft → Verify in list
  5. View detail → Verify sections
  6. Convert to PO → Fill delivery details → Submit
  7. Navigate to /procurement/purchase-orders
  8. Verify: New PO created

TC-PROC-005: Approvals Workflow
  1. Navigate to /procurement/approvals
  2. Verify: Pending items display
  3. Click item to review
  4. Approve → Add comment → Submit
  5. Verify: Status updates

TC-PROC-006: Field Stock
  1. Navigate to /procurement/field-stock
  2. Verify: Location stats
  3. Test stock issuance flow
  4. Test return flow
  5. Navigate to reconciliation
  6. Verify: Variance display
```

**Key Modals:**
- `StockItemSelector` - Item selection for BOQ/RFQ
- `ConvertToPOModal` - RFQ to PO conversion
- `POCreateModal` - Purchase order creation
- `StockReceiptModal` - Warehouse GRN
- `DailyCheckoutModal` - Stock issuance with signature

---

### MODULE: FLEET (P1 - High)

**Pages:**
- `/fleet` - Dashboard
- `/fleet/vehicles` - Vehicle List
- `/fleet/vehicles/[id]` - Vehicle Detail
- `/fleet/drivers` - Driver List
- `/fleet/drivers/[staffId]` - Driver Detail
- `/fleet/check-in` - Vehicle Check-in
- `/fleet/check-in/history` - Check-in History
- `/fleet/check-in/templates` - Check-in Templates
- `/fleet/fuel` - Fuel Tracking
- `/fleet/maintenance` - Maintenance
- `/fleet/investigation` - GPS Investigation
- `/fleet/investigation/[jobId]` - Investigation Detail
- `/fleet/analytics` - Fleet Analytics
- `/fleet/locations` - Vehicle Locations
- `/fleet/portal` - Driver Portal

**Test Protocol:**

```markdown
TC-FLEET-001: Dashboard
  1. Navigate to /fleet
  2. Verify: Vehicle count stats
  3. Verify: Recent investigations
  4. Click quick actions → Verify navigation

TC-FLEET-002: Vehicle CRUD
  1. Navigate to /fleet/vehicles
  2. Verify: List with filters
  3. View vehicle detail
  4. Verify tabs: Overview, Maintenance, Fuel, Documents
  5. Update odometer
  6. Upload license disc → Verify VLM extraction

TC-FLEET-003: Check-in Flow
  1. Navigate to /fleet/check-in
  2. Select vehicle
  3. Complete checklist items
  4. Take/upload photo
  5. Submit → Verify saved
  6. Check history → Verify record

TC-FLEET-004: Fuel Tracking
  1. Navigate to /fleet/fuel
  2. Verify: Summary stats
  3. Record fuel transaction
  4. Check anomalies → Verify detection

TC-FLEET-005: Investigation
  1. Navigate to /fleet/investigation
  2. Upload GPS data file
  3. Start investigation
  4. View results → Verify trip analysis
```

**Key VLM Integrations:**
- License disc extraction (expiry, plate)
- Odometer photo extraction
- Fuel gauge reading

---

### MODULE: PROJECTS (P1 - High)

**Pages:**
- `/projects` - Project List
- `/projects/new` - Create Project
- `/projects/[id]` - Project Detail
- `/projects/[id]/edit` - Edit Project
- `/projects/[id]/tracker` - Progress Tracker
- `/projects/[id]/budget` - Budget Management

**Test Protocol:**

```markdown
TC-PROJ-001: Project List
  1. Navigate to /projects
  2. Verify: Grid/table view
  3. Test: Search, filters (status, client)
  4. Sort by different columns

TC-PROJ-002: Project CRUD
  1. Click "Create Project"
  2. Fill form: Name, location, dates, budget
  3. Save → Verify in list
  4. Click to view detail
  5. Edit → Change values → Save

TC-PROJ-003: Project Tracker
  1. Open project → Click Tracker tab
  2. Verify: Gantt chart / task view
  3. Add task → Verify created
  4. Update progress → Verify saved

TC-PROJ-004: Budget Management
  1. Open project → Click Budget tab
  2. Verify: Budget overview, categories
  3. Add transaction → Verify total updates
  4. Check alerts for over-budget
  5. Sync with BOQ → Verify linked
```

---

### MODULE: STAFF (P1 - High)

**Pages:**
- `/staff` - Staff List
- `/staff/new` - Create Staff
- `/staff/[id]` - Staff Detail
- `/staff/[id]/edit` - Edit Staff
- `/staff/import` - Bulk Import

**Test Protocol:**

```markdown
TC-STAFF-001: Staff List
  1. Navigate to /staff
  2. Verify: Table with pagination
  3. Test: Search, filters (department, status)

TC-STAFF-002: Staff CRUD
  1. Click "Add Staff"
  2. Fill form: Name, position, department
  3. Save → Verify in list
  4. View detail → Verify tabs
  5. Edit → Change values → Save

TC-STAFF-003: Staff Edit Tabs
  1. Open staff member edit
  2. Test each tab:
     - Overview (basic info)
     - Employment (history)
     - Compliance (documents)
     - Vehicles (assignments)
     - Disciplinary (incidents)

TC-STAFF-004: Exit Employee Modal
  1. From staff detail, click "Exit Employee"
  2. Modal opens
  3. Select exit type
  4. Enter reason (min 10 chars)
  5. Submit → Verify status changes

TC-STAFF-005: Bulk Import
  1. Navigate to /staff/import
  2. Upload Excel file
  3. Map columns
  4. Preview → Verify data
  5. Import → Verify count
```

**Key Modals:**
- `ExitEmployeeModal` - Employee termination

---

### MODULE: SUPPLIERS (P2 - Medium)

**Pages:**
- `/suppliers` - Supplier List (REFERENCE PAGE for styling)
- `/suppliers/[id]` - Supplier Detail

**Test Protocol:**

```markdown
TC-SUP-001: Supplier List (REFERENCE)
  1. Navigate to /suppliers
  2. This is the STYLING REFERENCE PAGE
  3. Screenshot for comparison with other pages
  4. Verify: Stats cards, card grid layout
  5. Test: Search, filters

TC-SUP-002: Supplier CRUD
  1. Click "Add Supplier"
  2. Fill form: Company name, contact, categories
  3. Save → Verify in list
  4. View detail → Verify sections
  5. Edit → Change values → Save
```

---

### MODULE: TICKETING (P2 - Medium)

**Pages:**
- `/ticketing` - Dashboard
- `/ticketing/tickets` - Ticket List
- `/ticketing/tickets/new` - Create Ticket
- `/ticketing/tickets/[id]` - Ticket Detail
- `/ticketing/teams` - Team Management
- `/ticketing/escalations` - Escalations
- `/ticketing/risks` - Risk Management
- `/ticketing/data-sync` - QContact Sync

**Test Protocol:**

```markdown
TC-TICK-001: Ticket CRUD
  1. Navigate to /ticketing/tickets
  2. Create ticket → Fill form → Save
  3. View detail → Add note
  4. Update status → Verify saved

TC-TICK-002: Escalations
  1. Navigate to /ticketing/escalations
  2. View pending escalations
  3. Resolve escalation → Add notes → Submit

TC-TICK-003: QContact Sync
  1. Navigate to /ticketing/data-sync
  2. Verify: Sync status
  3. Trigger manual sync
  4. Verify: Imported tickets
```

---

### MODULE: CONTRACTORS (P2 - Medium)

**Pages:**
- `/contractors` - List
- `/contractors/[id]` - Detail
- `/contractors/[id]/onboarding` - Onboarding
- `/contractors/rag-dashboard` - Health Dashboard

**Test Protocol:**

```markdown
TC-CONT-001: Contractor CRUD
  1. Navigate to /contractors
  2. Create contractor
  3. View detail → Upload documents
  4. Verify document expiry tracking

TC-CONT-002: Onboarding Flow
  1. Open contractor onboarding
  2. Complete each stage
  3. Upload required documents
  4. Mark complete → Verify status

TC-CONT-003: RAG Dashboard
  1. Navigate to /contractors/rag-dashboard
  2. Verify: Red/Amber/Green status cards
  3. Click card → View contractor list
```

---

### MODULE: CLIENTS (P3 - Low)

**Pages:**
- `/clients` - List
- `/clients/new` - Create
- `/clients/[id]` - Detail
- `/clients/[id]/edit` - Edit

**Test Protocol:**

```markdown
TC-CLI-001: Client CRUD
  1. Navigate to /clients
  2. Create client → Save
  3. View detail
  4. Edit → Change values → Save
```

---

### MODULE: ASSETS (P3 - Low)

**Pages:**
- `/assets` - Asset List
- `/assets/new` - Create Asset
- `/assets/[id]` - Asset Detail
- `/assets/[id]/edit` - Edit Asset
- `/assets/categories` - Categories
- `/assets/calibration` - Calibration Due
- `/assets/maintenance` - Maintenance Due
- `/assets/checkin` - Check In
- `/assets/checkout` - Check Out
- `/assets/list` - List View

**Test Protocol:**

```markdown
TC-ASS-001: Asset CRUD
  1. Navigate to /assets
  2. Create asset → Fill form → Save
  3. View detail → Check tabs
  4. Check out asset → Assign to staff
  5. Check in asset → Update condition

TC-ASS-002: Maintenance
  1. Navigate to /assets/maintenance
  2. View due maintenance
  3. Record maintenance → Save
```

---

## INTERACTIVE COMPONENTS CHECKLIST

### Modals (Must Test Open/Close/Submit)

| Modal | Location | Test Actions |
|-------|----------|--------------|
| `StockItemSelector` | BOQ/RFQ | Open, Search, Select, Create new |
| `ConvertToPOModal` | RFQ | Open, Review, Submit |
| `POCreateModal` | PO | Open, Fill, Submit |
| `StockReceiptModal` | GRN | Open, Scan, Submit |
| `DailyCheckoutModal` | Field Stock | Open, Select, Sign, Submit |
| `ExitEmployeeModal` | Staff | Open, Fill, Submit |
| `BarcodeScannerModal` | Multiple | Open camera, Scan, Close |
| `OcrResultsModal` | Documents | Review, Toggle fields, Apply |
| `WorkflowAssignmentModal` | Projects | 3-step wizard |
| `ScheduleMeetingModal` | LiveKit | Fill, Submit |
| `BudgetAdjustmentModal` | Budget | Fill, Submit |
| `TaskDialog` | Field App | View, Update status |
| `QuoteSubmissionModal` | RFQ | Fill quote, Submit |
| `CreateReturnModal` | Field Stock | Select items, Submit |

### Forms (Must Test Validation)

| Form | Validations |
|------|-------------|
| Staff Form | Required fields, email format |
| Project Form | Dates, budget > 0 |
| Client Form | Required fields |
| Contractor Form | Required fields |
| Ticket Form | Title required |
| BOQ Form | At least 1 line item |
| RFQ Form | Deadline, suppliers |

### Filters/Search (Must Test Updates)

| Component | Location | Test |
|-----------|----------|------|
| GlobalSearch | Header | Search across modules |
| StaffFilters | Staff | Filter by department |
| ProjectFilters | Projects | Filter by status |
| DropsFilters | Activate | Filter by status/project |
| BOQListFilters | BOQ | Filter by project |

---

## REPORT TEMPLATE

```markdown
# Final Audit Report
## Application: FibreFlow
## Date: [YYYY-MM-DD HH:MM]
## Tester: Claude Code
## Environment: [localhost:3005 | vf.fibreflow.app]

---

## Executive Summary
- **Overall Status:** [PASS | FAIL | BLOCKED]
- **Modules Tested:** X/Y
- **Tests Passed:** X/Y
- **Critical Issues:** X
- **Theme Issues:** X

---

## Pre-Flight Checks
| Check | Status |
|-------|--------|
| Server | ✓ Running |
| Database | ✓ Connected |
| Auth | ✓ Logged in |
| Theme Toggle | ✓ Working |

---

## Module Results

### [MODULE NAME]
| Test Case | Dark | Light | Status |
|-----------|------|-------|--------|
| TC-XXX-001 | PASS | PASS | ✓ |
| TC-XXX-002 | PASS | FAIL | ⚠️ |

Issues Found:
1. [ID] [Severity] Description

---

## Theme Audit
| Page | Dark Mode | Light Mode | Notes |
|------|-----------|------------|-------|
| /activate | ✓ | ✓ | |
| /procurement/rfq | ✓ | ✓ | Fixed: bg wrapper |

---

## Console Errors
| Page | Error | Count |
|------|-------|-------|
| /activate | None | 0 |

---

## API Failures
| Endpoint | Status | Error |
|----------|--------|-------|
| None | - | - |

---

## Recommendations
1. [Priority] Issue → Fix

---

## Verdict
[ ] READY FOR PRODUCTION
[ ] NEEDS FIXES (X critical, Y medium)
[ ] BLOCKED (critical failures)

---

## Sign-off
- Tester: Claude Code
- Date: [YYYY-MM-DD]
```

---

## RELATED FILES

- Theme Variables: `src/styles/design-system.css`
- AppLayout: `src/components/layout/AppLayout.tsx`
- Theme Context: `src/contexts/ThemeContext.tsx`
- E2E Command: `.claude/commands/e2e.md`
- Dark Mode Skill: `.claude/skills/archive/ff-dark-mode/skill.md`
