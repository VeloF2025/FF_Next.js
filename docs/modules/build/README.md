# Build Module Documentation

**Module**: Build / Project PON Progress Tracking
**Status**: Active
**Last Updated**: 2026-03-15

---

## 🎯 Module Overview

The Build module provides tools for managing Fiber-to-the-Home (FTTH) and Fiber-to-the-Business (FTTB) project progress, focusing on Passive Optical Network (PON) rollout across zones.

The module covers:

| Component | Purpose |
|---|---|
| **PON Progress Tracking** | Daily progress dashboard for CWC, Optical, Activation, and Maintenance phases |
| **Daily Log Panel** | Slide-out panel for recording daily progress, blockages, and milestones |
| **Project Targets** | Monthly target dates per zone and PON; inline-editable in the progress tracker |
| **Stage Management** | Pole plant dates, maintenance stages, blockage tracking |

---

## 📋 Key Features

### PON Progress Tracker (Dashboard)
- **Summary Cards** — Quick metrics per PON: status overview, completion %, blockage alerts
- **Progress Table** — Zone × PON grid showing:
  - Target dates (CWC, Optical, Activation, Maintenance)
  - Inline-editable target dates and blockage reason
  - Daily milestones and phase completion
- **Filter Tabs** — View by All, CWC, Optical, Activation, or Maintenance phase

### Daily Log Panel
- **New Entry Form** — Record daily progress for a selected PON
- **Timeline View** — Historical log of past entries, filterable by phase
- **Edit Capability** — Update previous entries to correct data
- **Responsive Design** — Backdrop overlay (closes on click), wider panel on desktop, auto-scroll on mobile

### Pole Plant Date Tracking
- **Source:** Step 7 "After Photo" captured date (from QField)
- **Fallback:** Earliest photo date if Step 7 not yet submitted
- **Used by:** ReviewWizard.tsx "Planted" label, sync-qa-to-qfield.py plant date export

### Blockage Tracking
- **Field:** `blockage_reason` on `pon_daily_log` / `project_monthly_targets`
- **Examples:** "Equipment shortage", "Site access denied", "Weather delay", "Contractor availability"

---

## 🗄️ Data Model

### Primary Tables

#### `pon_daily_log`
Daily progress entries per PON.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK to `projects` |
| `pon_name` | TEXT | PON identifier (e.g., "PON-001") |
| `phase` | TEXT | `'CWC'` / `'Optical'` / `'Activation'` / `'Maintenance'` |
| `progress_pct` | INT | Completion percentage (0–100) |
| `blockage_reason` | TEXT | Null or reason for blockage (e.g., "Site access denied") |
| `notes` | TEXT | Free-form daily notes |
| `recorded_date` | DATE | Date of the daily log entry |
| `created_at` | TIMESTAMPTZ | When the record was created |
| `updated_at` | TIMESTAMPTZ | Last modification |

#### `project_monthly_targets`
Monthly milestone dates per zone × PON.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK to `projects` |
| `zone_name` | TEXT | Zone identifier (e.g., "Zone A") |
| `pon_name` | TEXT | PON identifier |
| `phase` | TEXT | `'CWC'` / `'Optical'` / `'Activation'` / `'Maintenance'` |
| `target_date` | DATE | Scheduled completion date |
| `blockage_reason` | TEXT | Blockage reason if target is at risk |
| `created_at` | TIMESTAMPTZ | When the target was set |
| `updated_at` | TIMESTAMPTZ | Last modification |

#### Projects `pon_stages` Column (JSONB)
Pole plant dates and maintenance stage tracking.

```json
{
  "pon_stages": [
    {
      "pon_id": "string",
      "pon_name": "string",
      "stage": "string (enum: created, in_progress, pole_planted, construction_qa, maintenance)",
      "plant_date": "ISO 8601 date",
      "maintenance_stage": "string (enum: pending, in_progress, completed)"
    }
  ]
}
```

---

## 🌐 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/projects/[projectId]/pon-progress` | GET | Summary cards and progress table data |
| `/api/projects/[projectId]/pon-targets` | GET / POST | Monthly target dates per PON |
| `/api/projects/[projectId]/pon-daily-log` | GET / POST | Daily progress log entries |

### Request/Response Examples

#### GET `/api/projects/[projectId]/pon-progress`
```json
{
  "summary": {
    "totalPons": 12,
    "ponsCompleted": 8,
    "completionPercent": 67,
    "blockedPons": 2
  },
  "table": [
    {
      "zone": "Zone A",
      "pon": "PON-001",
      "cwcTarget": "2026-03-20",
      "opticalTarget": "2026-04-15",
      "activationTarget": "2026-05-01",
      "maintenanceTarget": "2026-06-01",
      "blockageReason": null
    }
  ]
}
```

#### POST `/api/projects/[projectId]/pon-daily-log`
```json
{
  "pon_name": "PON-001",
  "phase": "Optical",
  "progress_pct": 45,
  "notes": "Duct cleaning in progress; 3 conduits cleared.",
  "blockage_reason": null,
  "recorded_date": "2026-03-15"
}
```

---

## 🏗️ Architecture

### Daily Progress Flow

```
Manual Daily Entry (Build > Progress tab)
    ├── User selects PON
    ├── Records phase, progress %, notes, blockage
    └── Saves to pon_daily_log
            │
            ├─→ pon_progress API reads and summarizes
            │       └─→ Summary cards + progress table
            │
            └─→ pon-targets API reads monthly targets
                    └─→ Timeline view + compliance check
```

### Pole Plant Date Resolution

```
QField Review (Construction QA)
    └── Step 7 "After Photo" captured_at
            │
            ├─→ sync-qa-to-qfield.py
            │       └─→ Extracts step7_photo_date
            │
            └─→ projects.pon_stages[].plant_date = step7_photo_date
                    │
                    └─→ ReviewWizard.tsx "Planted" label + Build dashboard
```

---

## 🔧 Components (React)

### PonProgressTracker.tsx
Main dashboard component. Renders summary cards, progress table, and filter tabs.

```tsx
<PonProgressTracker 
  projectId={projectId} 
  onPonSelect={(ponName) => {/* open daily log panel */}}
/>
```

### DailyLogPanel.tsx
Slide-out panel for viewing and recording daily log entries.

```tsx
<DailyLogPanel 
  projectId={projectId}
  selectedPon={pon_name}
  onClose={() => {}}
/>
```

### ProgressTableRows.tsx
Renders individual zone × PON rows with inline-editable target dates.

### ProgressSummaryCards.tsx
Summary cards showing overall completion and blockage metrics.

---

## 📊 Related Modules

| Module | Integration |
|---|---|
| **Construction QA** | Pole plant dates sourced from Step 7 photo dates |
| **Field Ops** | Pole plant date label ("Planted") displayed in ReviewWizard |
| **QField Sync** | Photo data synced from QField; Step 7 date extracted |

---

## 🚀 Usage

### Add a New Daily Log Entry

1. Navigate to **Projects > [Project] > Build > Progress**
2. Click **+ New Entry** in the Daily Log panel
3. Select **PON** and **Phase** (CWC, Optical, Activation, Maintenance)
4. Enter **Progress %** and **Notes**
5. If blocked, enter **Blockage Reason**
6. Click **Save**

### Update Target Dates

1. In the Progress Table, click a **Target Date** cell
2. Edit inline, then save
3. The monthly targets table updates automatically

### View Historical Entries

In the Daily Log panel, filter by **Phase** tab to see past entries for the PON.

---

## ⚙️ Database Migrations

| Migration | Date | Change |
|---|---|---|
| `232_pon_progress_tracking.sql` | 2026-03-14 | Create `pon_daily_log`, `project_monthly_targets` tables; add `blockage_reason` and `maintenance_stage` fields to projects JSONB |

---

*Last updated: 2026-03-15 — Scribe*
