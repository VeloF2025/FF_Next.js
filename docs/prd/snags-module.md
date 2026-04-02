# PRD: Snags Module — Field Ops / Civil QA

| Field | Value |
|-------|-------|
| **Author** | Hein van Vuuren |
| **Date** | 2026-04-02 |
| **Status** | Draft |
| **Module** | Civil QA (Field Ops) |
| **Priority** | High |
| **Target** | `/field-ops/snags` |

---

## 1. Problem Statement

Tera Fibre (FibreTime's QA arm) conducts weekly quality audits across all Velocity Fibre projects. These audits produce **TQR (Tera Quality Report)** PDFs containing numbered findings (snags), categorised photos with pole references, and audit scores.

Currently these reports live in a SharePoint folder with no structured tracking. There is no mechanism to:
- Track which snags have been fixed
- Assign field teams to specific snags
- Collect before/during/after photo evidence of repairs
- Measure resolution time or repeat offender patterns
- Link snags to existing FibreFlow project data (zones, PONs, poles, DRs)

This results in snags falling through the cracks, no accountability, and no data-driven quality improvement.

---

## 2. Objectives

1. **Centralised snag tracking** — Import TQR findings into FibreFlow with full lifecycle management
2. **Photo evidence chain** — Before (from TQR) -> During (field team) -> After (proof of fix)
3. **NOC integration** — Auto-create one NOC ticket per snag for field team assignment and tracking
4. **Data linkage** — Connect snags to existing zones, PONs, poles, and DRs in the database
5. **Desktop QA verification** — Internal team verifies fixes via photo review (VLM-assisted in future)
6. **Reporting** — Contractor scorecards, resolution trends, audit score progression
7. **Historical backfill** — Import all existing 2025/2026 TQR reports to populate the database

---

## 3. Source Data Analysis

### 3.1 SharePoint Structure

```
Velocity_Manco / Shared Documents / Velocity_Quality_Assurance / Tera QA reports /
├── Etwatwa POP 2/
│   ├── 1. 2025/                         # Year folders
│   └── 2. 2026/
│       ├── 7. 08-01-2026/               # Sequential weekly inspections
│       ├── 8. 22-01-2026/
│       ├── ...
│       └── 16. 24-03-2026/
│           └── Etwatwa POP 2 TQR 00182026.pdf
├── Lawley/
├── Mamelodi/
├── Mohadin/
├── Tembida 3/
├── Tembisa 1/
└── Tembisa 2/
```

**7 projects**, weekly reports, ~10 reports per project in 2026 so far.

### 3.2 TQR PDF Structure (9 pages typical)

| Page | Content | Extractable Data |
|------|---------|-----------------|
| 1 | Cover page | Site name (e.g. ETW.02.797012), Client (Fibertime), Contractor (Velocity Fibre), Address (Etwatwa POP 2), Audit date, Report number (TQR 0018/2026) |
| 2 | Findings table | Numbered list of snags (1-16+), category tags (Quality/Health/Safety/Environment/Traffic), text descriptions |
| 2-6 | Photo evidence grid | 3-column grid, each cell: snag number, pole reference (PH258B), before photo with red arrow annotations, Fix/Pending status columns |
| 7-8 | General compliance photos | Pole reference labels, general installation quality shots, "Any Comments" section |
| 8 | Quality Audit Results chart | Bar chart: Assurance vs Non-Conformance counts per category |
| 9 | Recommendations & sign-off | Auditor name, signature, date, advisory notes |

### 3.3 Key Data Points Per Snag

- **Snag number** (sequential within report: 1, 2, 3...)
- **Category** (Quality, Health, Safety, Environment, Traffic)
- **Description** (free text, e.g. "The HDPE pipes is a tripping hazard for pedestrians")
- **Pole reference(s)** (e.g. PH258B, PH256, PH753 — maps to FibreFlow poles table)
- **Before photo(s)** (annotated with red arrows showing the issue)
- **Fix status** (Pending / Fixed — in the TQR itself)

---

## 4. Data Model

### 4.1 New Tables

```sql
-- ============================================================
-- Table: snag_reports
-- Weekly TQR audit report container
-- ============================================================
CREATE TABLE snag_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            INTEGER NOT NULL REFERENCES projects(id),
  report_number         TEXT NOT NULL,              -- 'TQR 0018/2026'
  site_name             TEXT,                       -- 'ETW.02.797012'
  client                TEXT DEFAULT 'Fibertime',
  contractor            TEXT DEFAULT 'Velocity Fibre',
  audit_date            DATE NOT NULL,
  auditor               TEXT,                       -- 'Fabian Redcliffe/Ronel Kahts'
  source_pdf_url        TEXT,                       -- VF Storage URL
  source_pdf_filename   TEXT,                       -- Original filename

  -- Audit scores (from Quality Audit Results chart)
  quality_assurance     INTEGER DEFAULT 0,
  quality_nc            INTEGER DEFAULT 0,
  health_assurance      INTEGER DEFAULT 0,
  health_nc             INTEGER DEFAULT 0,
  safety_assurance      INTEGER DEFAULT 0,
  safety_nc             INTEGER DEFAULT 0,
  environment_assurance INTEGER DEFAULT 0,
  environment_nc        INTEGER DEFAULT 0,
  traffic_assurance     INTEGER DEFAULT 0,
  traffic_nc            INTEGER DEFAULT 0,

  -- Metadata
  total_findings        INTEGER DEFAULT 0,
  import_status         TEXT DEFAULT 'pending',     -- pending/processing/complete/failed
  import_notes          TEXT,
  imported_by           INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(report_number)
);

-- ============================================================
-- Table: snags
-- Individual findings from TQR reports
-- ============================================================
CREATE TABLE snags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES snag_reports(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id),
  snag_number       INTEGER NOT NULL,               -- Finding number within report (1-16+)

  -- Classification
  category          TEXT NOT NULL,                   -- quality/health/safety/environment/traffic
  severity          TEXT DEFAULT 'major',            -- critical/major/minor
  description       TEXT NOT NULL,                   -- Finding description from TQR

  -- Location linkage
  pole_references   TEXT[],                          -- Array: ['PH258B', 'PH256']
  pole_ids          INTEGER[],                       -- Resolved FK array to poles table
  zone_id           INTEGER REFERENCES zones(id),
  pon_id            INTEGER,                         -- Resolved from pole location
  drop_id           INTEGER,                         -- If linked to a specific drop/DR

  -- Lifecycle
  status            TEXT DEFAULT 'open',
    -- open -> assigned -> in_progress -> fixed -> verified -> closed
    -- also: wont_fix, duplicate
  noc_ticket_id     INTEGER,                         -- FK to noc_tickets
  assigned_to       INTEGER REFERENCES users(id),
  assigned_at       TIMESTAMPTZ,
  fix_deadline      TIMESTAMPTZ,                     -- SLA based on severity
  fixed_at          TIMESTAMPTZ,
  fixed_by          INTEGER REFERENCES users(id),
  verified_at       TIMESTAMPTZ,
  verified_by       INTEGER REFERENCES users(id),
  verification_notes TEXT,
  closed_at         TIMESTAMPTZ,

  -- Repeat tracking
  is_repeat         BOOLEAN DEFAULT FALSE,
  repeat_of_snag_id UUID REFERENCES snags(id),
  repeat_count      INTEGER DEFAULT 0,
  reopen_count      INTEGER DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(report_id, snag_number)
);

-- ============================================================
-- Table: snag_photos
-- Photo evidence for each snag (before/during/after)
-- ============================================================
CREATE TABLE snag_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id         UUID NOT NULL REFERENCES snags(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL,                     -- before/during/after
  photo_url       TEXT NOT NULL,                     -- VF Storage URL
  thumbnail_url   TEXT,                              -- Resized thumbnail
  pole_reference  TEXT,                              -- Pole shown in photo
  caption         TEXT,                              -- Description or annotation
  source          TEXT NOT NULL,                     -- tqr_import/noc_upload/manual/whatsapp
  vlm_assessment  JSONB,                             -- Future: VLM analysis result

  uploaded_by     INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(snag_id, phase, photo_url)
);

-- Indexes
CREATE INDEX idx_snags_project_status ON snags(project_id, status);
CREATE INDEX idx_snags_report ON snags(report_id);
CREATE INDEX idx_snags_noc_ticket ON snags(noc_ticket_id);
CREATE INDEX idx_snags_category ON snags(category);
CREATE INDEX idx_snag_photos_snag ON snag_photos(snag_id);
CREATE INDEX idx_snag_reports_project ON snag_reports(project_id);
CREATE INDEX idx_snag_reports_audit_date ON snag_reports(audit_date);
```

### 4.2 Data Linkage Strategy

Pole references in TQR reports (e.g. "PH258B") must be resolved against the FibreFlow `poles` table:

```
TQR pole ref "PH258B"
  -> poles.pole_number ILIKE '%258B%' WHERE project_id = X
  -> Resolves zone_id, pon from poles table
  -> If pole has linked DRs in drops table, cross-reference
```

Fuzzy matching required because TQR naming may not exactly match FibreFlow pole naming conventions. The import process should:
1. Attempt exact match on pole_number
2. Fall back to suffix/prefix matching
3. Flag unresolved poles for manual mapping

### 4.3 Cross-Report Repeat Detection

When a new TQR report is imported, the system MUST check for repeat snags — i.e., a snag at the same pole with the same category that appeared in a previous report and was either still open or was marked as fixed but not verified.

**Detection algorithm:**

```
For each snag S in new report:
  Find existing snags E WHERE:
    E.project_id = S.project_id
    AND E.category = S.category
    AND E.pole_references && S.pole_references  (array overlap)
    AND E.status NOT IN ('verified', 'closed')
    AND E.report_id != S.report_id

  IF match found:
    S.is_repeat = TRUE
    S.repeat_of_snag_id = E.id
    E.repeat_count += 1

    IF E.status = 'fixed' (was marked fixed but reappeared):
      E.status = 'reopened'  -- Reopen the original
      E.reopen_count += 1
      Add timeline entry: "Snag reappeared in TQR {new_report_number}"
      Escalate severity one level (minor->major, major->critical)

    IF E.status IN ('open', 'assigned', 'in_progress'):
      -- Original still open, new report just confirms it's still a problem
      Add timeline entry: "Still unresolved — flagged again in TQR {new_report_number}"
      IF E.repeat_count >= 3:
        Auto-escalate to critical severity
        Flag for management attention
```

**Additional status value needed:**

```sql
-- Add 'reopened' to snag status options:
-- open -> assigned -> in_progress -> fixed -> verified -> closed
-- fixed -> reopened (if reappears in next TQR)
-- reopened -> assigned -> in_progress -> fixed -> verified -> closed
```

**Repeat tracking fields on snags table (already included in schema):**

```sql
is_repeat         BOOLEAN DEFAULT FALSE,
repeat_of_snag_id UUID REFERENCES snags(id),
repeat_count      INTEGER DEFAULT 0,
-- Add:
reopen_count      INTEGER DEFAULT 0,
```

**UI indicators for repeats:**
- Repeat badge on snag card: "Repeat x2" / "Repeat x3" with escalating warning colours
- Reopened snags get a distinct red pulsing border in the grid
- Filter option: "Show repeats only" to surface persistent problems
- Report: "Repeat snag analysis" showing which poles/categories keep recurring

---

## 5. User Interface

### 5.1 Tab Placement

Add "Snags" tab between "OTDR Testing" and "Reports" in the Civil QA module navigation.

```typescript
// construction-qa.config.ts — new tab
{
  id: 'snags',
  label: 'Snags',
  shortLabel: 'Snags',
  icon: AlertTriangle,  // from lucide-react
  path: '/field-ops/snags',
  rbacKey: 'construction-qa.snags',
}
```

Route: `pages/field-ops/snags.tsx`
Component: `src/modules/construction-qa/components/snags/SnagsPage.tsx`

### 5.2 Level 1 — Project Dashboard (default view)

Card grid identical in style to the QA Centre dashboard. One card per project.

**Each card shows:**
- Project name + total snag count
- Status breakdown bar (red=open, yellow=in progress, green=resolved)
- Latest TQR report number + date
- Audit score trend sparkline (last 6 reports)
- Counts: open / in progress / fixed / verified

**Top bar:**
- "Import TQR Report" button (primary action)
- View toggle: Grid / Map / Timeline
- Filters: project, status, category, date range

### 5.3 Level 2 — Snag Grid (click into project)

Photo-first card grid showing individual snags. Cards are grouped by TQR report with a collapsible report header.

**Report header row:**
```
TQR 0018/2026 — 24 Mar 2026 — 16 findings (12 open, 4 fixed)  [Expand/Collapse]
```

**Each snag card (compact):**
- Before photo thumbnail (from TQR)
- Snag number + category badge (colour-coded)
- Severity indicator (border colour: red=critical, orange=major, grey=minor)
- Pole reference
- Zone + PON (resolved from DB)
- Truncated description (1 line)
- Status pill (Open / Assigned / In Progress / Fixed / Verified / Closed)
- Photo progress indicator: [Before: check] [During: ?] [After: ?]

**Card states by status:**
- Open: red left border, no overlay
- Assigned: orange left border, assignee avatar
- In Progress: yellow left border
- Fixed: blue left border, awaiting verification badge
- Verified: green left border, checkmark overlay
- Closed: muted/greyed card

### 5.4 Level 3 — Expanded Snag Detail (inline expand)

Clicking a snag card expands it inline below the row (accordion pattern, same as NOC ticket expand). Does NOT navigate to a new page.

**Layout (3-column photo comparison):**

```
┌─────────────────────────────────────────────────────────────┐
│ Snag #1 — HDPE pipes is a tripping hazard for pedestrians  │
│ Quality | Major | PH258B | Zone 3 | PON ETW-02-Z3-P12     │
│ NOC Ticket: #3847 → Thabo M. | Deadline: 27 Mar 2026      │
├───────────────────┬───────────────────┬─────────────────────┤
│    BEFORE         │    DURING         │    AFTER            │
│ ┌───────────────┐ │ ┌───────────────┐ │ ┌───────────────┐  │
│ │  TQR photo    │ │ │  Drop zone    │ │ │  Drop zone    │  │
│ │  (imported)   │ │ │  or import    │ │ │  or import    │  │
│ │               │ │ │  from NOC     │ │ │  from NOC     │  │
│ └───────────────┘ │ └───────────────┘ │ └───────────────┘  │
│ 24 Mar — TQR      │ [Upload] [NOC]    │ [Upload] [NOC]     │
│ import             │                   │                    │
├────────────────────┴───────────────────┴────────────────────┤
│ Actions: [Assign ▾] [Status ▾] [Create NOC Ticket]         │
│          [Mark Verified] [Link DR] [Flag Repeat]            │
├─────────────────────────────────────────────────────────────┤
│ Timeline:                                                   │
│ 24 Mar 14:00 — Imported from TQR 0018/2026                 │
│ 25 Mar 08:30 — NOC ticket #3847 created → Thabo M.         │
│ 28 Mar 11:15 — During photo uploaded (via NOC)              │
│ 29 Mar 09:00 — After photo uploaded, status → Fixed         │
└─────────────────────────────────────────────────────────────┘
```

**Photo upload behaviour:**
- Drag-and-drop zones for During and After columns
- "Import from NOC" button pulls photos attached to the linked NOC ticket
- Multiple photos per phase supported (carousel/grid within column)
- Photo lightbox on click (full-screen with zoom)

### 5.5 Dynamic Ticket Types

When creating a NOC ticket from a snag, the ticket template adapts based on snag category:

| Category | Ticket Template | Default SLA | Required Evidence |
|----------|----------------|-------------|-------------------|
| Quality | Civil Repair | 72 hours | Before + After photo of specific defect |
| Safety | Safety Incident (urgent) | 24 hours | Before + After, hazard elimination proof |
| Health | General Maintenance | 1 week | Before + After, site cleanliness |
| Environment | Environmental Remediation | 1 week | Before + After, clearance measurement |
| Traffic | Traffic Management | 48 hours | Before + After, route clearance |

Each ticket auto-populates:
- Snag description as ticket body
- Pole reference and location
- Category-specific checklist of required actions
- Photo upload requirements based on category
- SLA deadline calculated from severity + category

### 5.6 Future Views

**Map View (Phase 4):**
- Plot snags on network GIS map by pole GPS coordinates
- Colour-coded pins by status
- Click pin -> snag detail popup
- Heatmap mode showing snag density by area

**Timeline View:**
- Horizontal timeline of TQR reports
- Vertical snag bars showing open/closed progression
- Useful for tracking improvement trends

---

## 6. Import Workflow

### 6.1 Phase 1 — Manual Upload

1. User clicks "Import TQR Report" on the Snags dashboard
2. Upload dialog:
   - Select project (dropdown)
   - Upload PDF file
   - System extracts cover page metadata (report number, audit date, site name)
   - User confirms/corrects extracted metadata
3. System creates `snag_report` record
4. **Manual snag entry** (Phase 1 MVP):
   - User enters findings from PDF (number, category, description, pole references)
   - User uploads before photos per snag (extracted from PDF or screenshot)
   - System attempts pole reference resolution against DB
   - Flags unresolved poles for manual mapping
5. Import complete -> snags appear in grid

### 6.2 Phase 3 — PDF Auto-Parsing

1. Upload PDF
2. VLM + PDF text extraction pipeline:
   - Page 1: OCR cover page -> report metadata
   - Page 2: Extract findings table -> numbered snag list with categories
   - Pages 2-6: Extract photo grid -> individual snag photos with pole references
   - Page 8: Extract audit score chart -> assurance/NC numbers
3. Present extracted data for user confirmation
4. One-click import of all snags + photos

### 6.3 Phase 4 — SharePoint Automation

1. Microsoft Graph API polls `Tera QA reports` folder on schedule
2. Detects new PDFs (compare against `snag_reports.source_pdf_filename`)
3. Downloads PDF to VF Storage
4. Runs Phase 3 auto-parsing pipeline
5. Creates snag records automatically
6. Notifies team via WhatsApp/FibreFlow notification

---

## 7. NOC Integration

### 7.1 Ticket Creation

From a snag, user clicks "Create NOC Ticket":
- Auto-populates ticket from snag data
- Category-specific template applied
- Assigns to configured team/person based on project + zone
- Sets SLA deadline
- Links `snags.noc_ticket_id` to new ticket

Bulk action: "Create tickets for all open snags in report" creates one ticket per snag.

### 7.2 Bidirectional Sync

**NOC -> Snag:**
- When photos are uploaded to the NOC ticket, they flow to `snag_photos` (source: 'noc_upload')
- When NOC ticket status changes, snag status updates:
  - NOC "In Progress" -> Snag "in_progress"
  - NOC "Resolved" -> Snag "fixed" (pending verification)
  - NOC "Closed" -> Snag "closed" (if already verified)

**Snag -> NOC:**
- When snag is verified in the Snags module, NOC ticket moves to "Resolved"
- Verification notes sync to NOC ticket comments

### 7.3 Lifecycle

```
TQR PDF imported
  ├── snag_report created
  └── snags created (status: open)
        ├── NOC ticket created (status: open)
        │     ├── Assigned to field team
        │     ├── Field team uploads during photos -> snag_photos
        │     ├── Field team uploads after photos -> snag_photos
        │     └── NOC ticket resolved -> snag status: fixed
        ├── Desktop QA reviews before/after photos
        │     ├── VLM assessment (future) -> snag_photos.vlm_assessment
        │     └── Human verification -> snag status: verified
        └── Snag closed
              └── NOC ticket closed
```

---

## 8. Reporting

### 8.1 Reports Sub-Section (within Snags tab or on Reports tab)

| Report | Description |
|--------|-------------|
| **Snag Summary** | Open/closed/verified counts per project, trend over time |
| **Resolution Time** | Average time from open to verified, by project/category/severity |
| **Audit Score Trends** | Assurance vs NC scores per project over time (from TQR data) |
| **Contractor Scorecard** | Snags per contractor, repeat rates, avg resolution time |
| **Category Breakdown** | Which snag types are most common, which take longest to fix |
| **Repeat Offenders** | Poles/zones with recurring snags across reports |
| **SLA Compliance** | Percentage of snags fixed within SLA deadline |
| **Team Performance** | Resolution stats per assigned team/person |

### 8.2 Excel Export

All report views exportable to Excel following the existing FibreFlow export pattern.

---

## 9. RBAC Permissions

| Permission Key | Description | Default Roles |
|----------------|-------------|---------------|
| `construction-qa.snags` | View snags tab | Project Manager, QA Manager, Admin |
| `construction-qa.snags.import` | Import TQR reports | QA Manager, Admin |
| `construction-qa.snags.manage` | Edit snags, change status, assign | Project Manager, QA Manager, Admin |
| `construction-qa.snags.verify` | Mark snags as verified | QA Manager, Admin |
| `construction-qa.snags.create-ticket` | Create NOC tickets from snags | Project Manager, QA Manager, Admin |
| `construction-qa.snags.reports` | Access snag reports | Project Manager, QA Manager, Admin |

---

## 10. Phased Delivery

### Phase 1 — MVP (Target: 1 week)
- [x] Snags tab in Civil QA navigation
- [ ] Database migration (snag_reports, snags, snag_photos tables)
- [ ] Manual TQR report import (metadata entry + PDF upload)
- [ ] Manual snag entry per report (number, category, description, pole refs)
- [ ] Manual before-photo upload per snag
- [ ] Project dashboard cards with snag counts
- [ ] Snag grid view with expandable detail
- [ ] 3-column photo layout (before/during/after) with upload zones
- [ ] Basic status workflow (open -> assigned -> in_progress -> fixed -> verified -> closed)
- [ ] Pole reference resolution against poles table (zone/PON linkage)
- [ ] API routes: CRUD for reports, snags, photos

### Phase 2 — NOC Integration (Target: +3 days)
- [ ] "Create NOC Ticket" action from snag
- [ ] Category-specific ticket templates with SLA
- [ ] Bidirectional status sync (NOC <-> Snag)
- [ ] Photo import from NOC ticket to snag
- [ ] Bulk ticket creation per report

### Phase 3 — PDF Auto-Parsing (Target: +1 week)
- [ ] VLM-based cover page OCR (metadata extraction)
- [ ] Findings table extraction (snag list + categories)
- [ ] Photo grid extraction (individual snag photos with pole refs)
- [ ] Audit score chart extraction
- [ ] One-click import with confirmation UI
- [ ] Historical backfill tool for all 2025/2026 reports

### Phase 4 — Automation & Intelligence (Target: +2 weeks)
- [ ] SharePoint Graph API polling for new TQR reports
- [ ] VLM verification of after-photos (issue resolved check)
- [ ] Repeat snag auto-detection across reports
- [ ] Map view with snag pins on GIS
- [ ] Contractor scorecards
- [ ] Audit score trending charts
- [ ] WhatsApp notification on new snag import

---

## 11. Implementation: Agent Team Structure

All implementation MUST follow a **multi-agent team workflow** where no single agent handles the full lifecycle. This improves output quality, catches errors earlier, and enforces separation of concerns.

### 11.1 Team Composition

| Role | Agent | Responsibility |
|------|-------|----------------|
| **Implementer** | Sonnet (worktree) | Writes production code: components, API routes, services, migrations, types |
| **Reviewer** | Sonnet (worktree) | Reviews implementer output: code quality, FibreFlow patterns, security, CLAUDE.md compliance, edge cases |
| **Evaluator** | Opus | Validates architecture decisions, ensures feature completeness against PRD, checks data model integrity |
| **UI Reviewer** | Sonnet (browser) | Loads the page in browser, takes screenshots, validates visual output against the PRD wireframes, checks responsiveness |

### 11.2 Workflow Per Phase

```
1. PLAN (Opus)
   └── Break phase into implementation tasks
       └── Identify files to create/modify
           └── Define acceptance criteria per task

2. IMPLEMENT (Sonnet — worktree isolation)
   └── Write code for each task
       └── Run type-check + lint
           └── Mark task complete

3. REVIEW (Sonnet — separate worktree)
   └── Read all changed files
       └── Check against FibreFlow patterns:
           - apiResponse usage
           - Logger (not console.log)
           - File size < 300 lines
           - Type coverage 100%
           - No conditional SQL fragments
       └── Check against PRD requirements
       └── Report issues -> Implementer fixes

4. EVALUATE (Opus)
   └── Verify feature completeness against PRD checklist
       └── Validate data model matches specification
           └── Check edge cases (empty states, error handling)
               └── Sign off or request changes

5. UI VALIDATE (Sonnet — browser)
   └── Deploy to dev
       └── Navigate to /field-ops/snags
           └── Screenshot each view state
               └── Compare against PRD wireframes
                   └── Report visual issues
```

### 11.3 Rules

1. **No single agent writes AND reviews its own code.** The implementer never reviews; the reviewer never implements.
2. **Worktree isolation is mandatory** for implementation and review agents to prevent interference.
3. **Browser validation is mandatory** before any PR is created. Code-only review is insufficient (per existing feedback: "never claim done from code alone").
4. **Evaluator runs last** and has veto power. If the evaluator rejects, the cycle restarts at step 2.
5. **All agents receive the PRD** as context so they measure against the same specification.
6. **Parallel where possible**: Implementer can work on Phase 1 Task 2 while Reviewer reviews Task 1.

### 11.4 Invocation Pattern

```bash
# Phase kickoff — Opus plans, then spawns team
/auto docs/prd/snags-module.md

# Or manual orchestration:
# 1. Plan
claude --print "Plan Phase 1 of docs/prd/snags-module.md" 

# 2. Implement (worktree)
claude "Implement task 1 from the snags PRD Phase 1" --worktree

# 3. Review (separate worktree)  
claude "Review the snags implementation in worktree X" --worktree

# 4. UI validate (browser)
claude --chrome "Validate /field-ops/snags against the snags PRD"
```

---

## 12. Technical Notes

### 12.1 File Structure

```
src/modules/construction-qa/
├── components/
│   └── snags/
│       ├── SnagsPage.tsx              # Main page with project dashboard
│       ├── SnagProjectCard.tsx        # Project summary card
│       ├── SnagGrid.tsx               # Snag card grid within a project
│       ├── SnagCard.tsx               # Individual snag card (compact)
│       ├── SnagDetail.tsx             # Expanded inline detail
│       ├── SnagPhotoCompare.tsx       # 3-column before/during/after
│       ├── SnagImportDialog.tsx       # TQR report upload + entry
│       ├── SnagTimeline.tsx           # Activity timeline
│       └── SnagFilters.tsx            # Filter bar
├── services/
│   └── snagService.ts                 # API client for snag endpoints
└── types/
    └── snag.types.ts                  # TypeScript interfaces

pages/
├── field-ops/
│   └── snags.tsx                      # Route: /field-ops/snags
└── api/
    └── snags/
        ├── reports.ts                 # CRUD for snag_reports
        ├── index.ts                   # CRUD for snags
        ├── photos.ts                  # Photo upload/management
        ├── import.ts                  # TQR import processing
        └── stats.ts                   # Dashboard statistics
```

### 12.2 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/snags/stats` | Dashboard stats (counts per project) |
| GET | `/api/snags/reports?projectId=X` | List reports for project |
| POST | `/api/snags/reports` | Create new report (manual import) |
| GET | `/api/snags?reportId=X&projectId=X&status=X` | List snags with filters |
| POST | `/api/snags` | Create individual snag |
| PATCH | `/api/snags` | Update snag (status, assignment, etc.) |
| POST | `/api/snags/photos` | Upload photo to snag |
| GET | `/api/snags/photos?snagId=X` | Get photos for snag |
| POST | `/api/snags/import` | Process TQR PDF import |

### 12.3 Constraints

- All API routes use `apiResponse` pattern
- No `console.log` — use `log` from `@/lib/logger`
- No conditional SQL fragments — use explicit query branches
- Files < 300 lines, components < 200 lines
- 100% TypeScript type coverage
- Photos stored on VF Storage (vf.fibreflow.app/storage/)
- All times in SAST (UTC+2)

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| All TQR snags tracked in FibreFlow | 100% from go-live |
| Average time from snag import to NOC ticket | < 24 hours |
| Snags with complete photo chain (before + after) | > 80% |
| Average resolution time (open to verified) | Measurable baseline within 2 weeks |
| Historical reports backfilled | All 2025 + 2026 reports |

---

## 14. Open Questions

1. ~~Start with manual or automated import?~~ **Manual first** (decided)
2. ~~NOC ticket granularity?~~ **One ticket per snag** (decided)
3. ~~Who verifies fixes?~~ **Desktop QA team, VLM future** (decided)
4. ~~Historical backfill?~~ **Yes, all 2025/2026** (decided)
5. Should the auditor (Tera Fibre) have read-only access to see resolution status in FibreFlow?
6. Do we need WhatsApp notifications to field teams when snags are assigned?
7. ~~Should resolved snags from one TQR that reappear in the next TQR auto-reopen?~~ **Yes — cross-report repeat detection is mandatory** (decided)
