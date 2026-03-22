# PON Progress Tracker — Product Requirements Document

**Feature**: Build > Progress working page (PON daily progress dashboard)
**Commit**: 0bb96af68e49f56ecf4940fcedb1e505621883cf
**Status**: Released (2026-03-14)
**Priority**: P1 (Replaces 3 manual spreadsheets)
**Module**: Build
**Last Updated**: 2026-03-16

---

## Problem Statement

Field operations teams tracked PON progress across 4 phases (CWC, Optical, Activation, Maintenance) using three parallel Excel spreadsheets:
- **VF_Project_Tracker** — Manual project milestones
- **Operations Targets** — Monthly zone targets
- **Johan's Optical Tracker** — Optical rollout details

This created:
- ❌ Data inconsistency (same PON tracked 3 ways)
- ❌ Manual entry errors (no validation)
- ❌ Delayed handover visibility (spreadsheets emailed daily)
- ❌ No blockage documentation (delays invisible until weekly reviews)

## Solution

**PON Progress Tracker** — A unified in-app dashboard that replaces all three spreadsheets with:
- Real-time progress summary cards (CWC, Optical, Activation, Maintenance)
- Zone × PON progress grid with phase-aware filtering
- Daily log panel for recording progress & blockages
- Inline-editable target dates and blockage reasons
- Historical daily log timeline with full audit trail

### Key Design Principles

1. **Single Source of Truth** — All progress tracked in `pon_daily_log` and `project_monthly_targets` tables (no duplicate entries)
2. **Operator-Friendly** — Edit target dates inline; log daily progress in < 30 seconds
3. **Blockage Visibility** — All delays require a documented reason (equipment, site access, weather, contractor)
4. **Phase-Aware Filtering** — Users see only the data relevant to their role (CWC team, optical team, etc.)
5. **Responsive Design** — Works on mobile + tablet (field operators on site, office staff on desktop)

---

## Feature Specifications

### 1. Summary Cards

| Card | Data | Source |
|------|------|--------|
| **CWC** | Count of PONs with target_cwc_date set; % complete this month | project_monthly_targets |
| **Optical** | Count of PONs with target_optical_date set; % complete | project_monthly_targets |
| **Activation** | Count of PONs with target_activation_date set; % complete | project_monthly_targets |
| **Maintenance** | Count of PONs with target_maintenance_date set; % complete | project_monthly_targets |

Each card shows:
- Count of PONs at this phase
- Percentage complete this month
- "On track" / "At risk" / "Overdue" status (compare target vs today)

### 2. Progress Table

**Grid Layout**: Zone × PON rows, 4 phase columns (CWC, Optical, Activation, Maintenance)

**Columns Per Phase**:
- **Target Date** — Inline-editable date field (click to change)
- **Milestone** — Phase completion date (read-only, auto-set from daily log)
- **Blockage** — If any blockage exists, red "⚠ Blocked" badge; click to see reason

**Inline Editing**:
- Click target date to edit
- Click blockage reason to add/edit reason
- Changes saved immediately to database
- Audit trail recorded (who, when, what changed)

**Filter Tabs** (above table):
- **All** — Show all phases
- **CWC** — Show CWC target + milestone only
- **Optical** — Show Optical target + milestone only
- **Activation** — Show Activation target + milestone only
- **Maintenance** — Show Maintenance target + milestone only

### 3. Daily Log Panel

**Trigger**: Click "New Entry" button or click zone/PON row

**Slide-Out Panel** (right side, max-w-lg):
- **Header** — Zone name, PON name, current date
- **New Entry Section** — Form to record today's progress
  - **Phase Dropdown** — Select CWC, Optical, Activation, or Maintenance
  - **Progress Notes** — Free-form text (e.g., "Installed 12 poles, awaiting equipment for pole 45")
  - **Blockage Dropdown** — Select: None, Equipment shortage, Site access denied, Weather delay, Contractor availability, Other
  - **Blockage Details** (if Other) — Free text describing blockage
  - **Submit Button** — Save entry and close panel
- **Timeline Section** — List of past entries
  - Sorted descending (newest first)
  - Filter tabs (All, CWC, Optical, Activation, Maintenance)
  - Click entry to expand and edit
  - Read-only after 48 hours (audit protection)

**Design**:
- Dark backdrop overlay (clicks outside panel to close)
- Wider panel (max-w-lg) to fit timeline + form side-by-side
- Auto-scroll to bottom on new entry
- Empty state icon if no past entries

---

## Database Schema

### Migration 232: `pon_progress_tracking`

#### New Table: `pon_daily_log`
```sql
CREATE TABLE pon_daily_log (
  id BIGINT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  zone_id BIGINT NOT NULL,
  pon_id BIGINT NOT NULL,
  phase VARCHAR(50) NOT NULL, -- 'CWC', 'Optical', 'Activation', 'Maintenance'
  progress_notes TEXT,
  blockage_reason VARCHAR(200),
  blockage_details TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id BIGINT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id),
  FOREIGN KEY (pon_id) REFERENCES pon_data(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);
```

#### New Table: `project_monthly_targets`
```sql
CREATE TABLE project_monthly_targets (
  id BIGINT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  zone_id BIGINT NOT NULL,
  pon_id BIGINT NOT NULL,
  target_cwc_date DATE,
  target_optical_date DATE,
  target_activation_date DATE,
  target_maintenance_date DATE,
  blockage_reason VARCHAR(200),
  blockage_details TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by_user_id BIGINT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id),
  FOREIGN KEY (pon_id) REFERENCES pon_data(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
);
```

#### Modified Table: `pon_stages`
- Added: `maintenance_stage` VARCHAR(50) — track maintenance phase status
- Added: `blockage_field` TEXT — for blockage tracking

---

## API Endpoints

All new endpoints return PON progress data scoped to the logged-in user's projects.

### 1. GET `/api/projects/[projectId]/pon-progress`
**Purpose**: Fetch PON progress data for progress table

**Query Params**:
- `phase` (optional) — Filter by CWC, Optical, Activation, Maintenance

**Response**:
```json
{
  "success": true,
  "data": {
    "project": { "id": 1, "name": "VF_JHB_North" },
    "summary": {
      "cwc": { "count": 42, "complete": 35, "pct": 83 },
      "optical": { "count": 42, "complete": 28, "pct": 67 },
      "activation": { "count": 42, "complete": 15, "pct": 36 },
      "maintenance": { "count": 42, "complete": 8, "pct": 19 }
    },
    "rows": [
      {
        "zone_id": 10,
        "zone_name": "Sandton",
        "pon_id": 101,
        "pon_name": "PON_SJ_001",
        "target_cwc_date": "2026-03-10",
        "target_optical_date": "2026-03-20",
        "target_activation_date": "2026-04-05",
        "target_maintenance_date": "2026-05-01",
        "blockage_reason": null,
        "blockage_details": null,
        "milestone_cwc_date": "2026-03-09",
        "milestone_optical_date": null,
        "milestone_activation_date": null,
        "milestone_maintenance_date": null
      }
    ]
  }
}
```

### 2. GET `/api/projects/[projectId]/pon-daily-log`
**Purpose**: Fetch daily log entries for a PON (timeline view)

**Query Params**:
- `zone_id` (required) — Zone ID
- `pon_id` (required) — PON ID
- `phase` (optional) — Filter by phase

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1001,
      "phase": "CWC",
      "progress_notes": "Installed 12 poles, awaiting equipment for pole 45",
      "blockage_reason": "Equipment shortage",
      "blockage_details": "Waiting for pole shipment from supplier, ETA 2026-03-18",
      "created_at": "2026-03-16T08:30:00Z",
      "created_by": "Johan Pieterse"
    }
  ]
}
```

### 3. POST `/api/projects/[projectId]/pon-daily-log`
**Purpose**: Create new daily log entry

**Body**:
```json
{
  "zone_id": 10,
  "pon_id": 101,
  "phase": "CWC",
  "progress_notes": "Installed 12 poles",
  "blockage_reason": "Equipment shortage",
  "blockage_details": "Waiting for supplier"
}
```

**Response**: `{ "success": true, "id": 1001 }`

### 4. GET `/api/projects/[projectId]/pon-targets`
**Purpose**: Fetch monthly target dates for bulk operations

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "zone_id": 10,
      "pon_id": 101,
      "target_cwc_date": "2026-03-10",
      "target_optical_date": "2026-03-20",
      "target_activation_date": "2026-04-05",
      "target_maintenance_date": "2026-05-01"
    }
  ]
}
```

### 5. PUT `/api/projects/[projectId]/pon-targets/[zone_id]/[pon_id]`
**Purpose**: Update target dates for a PON (inline edit)

**Body**:
```json
{
  "target_cwc_date": "2026-03-15",
  "blockage_reason": "Equipment shortage",
  "blockage_details": "New ETA from supplier"
}
```

**Response**: `{ "success": true }`

---

## Frontend Components

### Component Hierarchy
```
ProjectDetail.tsx
└── ProjectTabs.tsx (new "Progress" tab)
    └── PonProgressTracker.tsx (main container)
        ├── ProgressSummaryCards.tsx (4 summary cards)
        ├── ProgressTableRows.tsx (zone × PON grid, filter tabs)
        └── DailyLogPanel.tsx (slide-out panel, form + timeline)
```

### Component Specs

#### `PonProgressTracker.tsx` (Main Container)
- Fetches `/pon-progress` on mount
- Manages filter state (All, CWC, Optical, Activation, Maintenance)
- Renders summary cards, table, and panel
- Passes handlers for inline edit and new entry

#### `ProgressSummaryCards.tsx`
- Renders 4 cards (CWC, Optical, Activation, Maintenance)
- Shows count, percentage, on-track status
- Click card to filter table to that phase

#### `ProgressTableRows.tsx`
- Zone × PON grid
- Inline-editable target date cells (click to open date picker)
- Blockage badge (click to see reason)
- Click row to open daily log panel

#### `DailyLogPanel.tsx`
- Slide-out panel (right side, 50% width on desktop, full screen on mobile)
- Dark backdrop overlay
- Top section: new entry form (phase, notes, blockage)
- Bottom section: timeline of past entries
- Auto-close on backdrop click or submit

---

## Success Metrics

1. **Adoption**: All Build project managers using in-app Progress page (vs. spreadsheets) within 2 weeks
2. **Data Quality**: Zero duplicate PON records across three old spreadsheets (single source of truth)
3. **Blockage Documentation**: 100% of delayed PONs have documented blockage reason
4. **Time Savings**: Data entry reduced from 15 min (manual) → 2 min (in-app) per team per day
5. **Handover Visibility**: NOC receives real-time progress data (no 24-hour email lag)

---

## Rollout Plan

1. **Dev Testing** (2026-03-14) — Johan's team, manual QA
2. **Staging** (2026-03-15) — Full Build team, parallel run with spreadsheets
3. **Production** (2026-03-16) — Cutover, spreadsheet archive, monthly targets backfilled
4. **Training** (2026-03-17) — Field ops team walkthrough (30 min video + live Q&A)
5. **Decommission** (2026-03-24) — Archive spreadsheets, remove from shared drive

---

## Open Questions / Future Work

1. **Mobile Responsiveness** — Test DailyLogPanel on iOS/Android field devices (Hein action)
2. **Blockage Category Expansion** — Add custom blockage types per project (future config)
3. **Reporting** — Monthly blockage report (by reason, zone, PON) — separate feature request
4. **Integration** — QField pole plant date sync (commit 58b026d, see field-ops PRD)

---

## References

- **Related Commits**:
  - 0bb96af — Initial PON progress tracker feature
  - 58b026d — Field ops pole plant date integration
  - Migration 232 — Schema for daily log & targets tables
- **Related Modules**: field-ops, construction-qa, noc
- **User Documentation**: (TBD) `/help/build/pon-progress.md`

**Last Updated**: 2026-03-16 | **Owner**: Elon (CTO) | **Status**: Released
