# Build Module — Changelog

All notable changes to the Build / PON Progress Tracking module are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [2026-03-14] — feat(build): Add PON Progress Working Page

**Commit:** `0bb96af`
**Type:** Feature — New Dashboard
**Author:** Claude Sonnet 4.5, Claude Opus 4.6
**Impact:** Replaces manual spreadsheet tracking (VF_Project_Tracker, Operations Targets, Johan's Optical Tracker) with in-app PON progress dashboard.

---

### Problem

Project progress tracking was managed entirely outside FibreFlow:

- **VF_Project_Tracker** (Google Sheets) — Manual CWC, Optical, Activation, Maintenance phases
- **Operations Targets** (Spreadsheet) — Monthly target dates per zone
- **Johan's Optical Tracker** (Separate sheet) — Optical phase progress

Disconnect between FibreFlow and tracking sources caused:
- Stale data in the app (users must check external sheets)
- Manual data entry duplication
- No real-time blockage visibility
- Target miss-tracking across phases

### Solution

#### 1. New Tables for Daily Progress

**`pon_daily_log`** — Daily progress entries per PON

```sql
CREATE TABLE pon_daily_log (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    pon_name TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('CWC', 'Optical', 'Activation', 'Maintenance')),
    progress_pct INT CHECK (progress_pct >= 0 AND progress_pct <= 100),
    blockage_reason TEXT,
    notes TEXT,
    recorded_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**`project_monthly_targets`** — Monthly milestone dates per zone × PON

```sql
CREATE TABLE project_monthly_targets (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    zone_name TEXT NOT NULL,
    pon_name TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('CWC', 'Optical', 'Activation', 'Maintenance')),
    target_date DATE NOT NULL,
    blockage_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (project_id, zone_name, pon_name, phase)
);
```

#### 2. New API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/projects/[projectId]/pon-progress` | GET | Summary cards (total PONs, completion %, blockages) + progress table (zone × PON grid) |
| `/api/projects/[projectId]/pon-targets` | GET / POST | Fetch and set monthly target dates; supports bulk updates |
| `/api/projects/[projectId]/pon-daily-log` | GET / POST | Fetch and record daily progress entries |

**pon-progress** (265 lines):
- Aggregates `pon_daily_log` entries to calculate summary metrics and progress per PON
- Returns summary cards + table rows ready for UI rendering
- Supports filtering by phase

**pon-targets** (105 lines):
- CRUD operations on `project_monthly_targets`
- Supports inline updates from the progress table
- Validates target dates against project timeline

**pon-daily-log** (79 lines):
- POST creates new daily log entry
- GET fetches entries for a specific PON, filterable by phase and date range
- Supports editing (PUT) previous entries

#### 3. New React Components

| Component | Purpose |
|---|---|
| `PonProgressTracker.tsx` (152 lines) | Main dashboard — renders summary cards, progress table, filter tabs |
| `DailyLogPanel.tsx` (262 lines) | Slide-out panel — view/create/edit daily log entries |
| `ProgressTableRows.tsx` (179 lines) | Progress table rows with inline-editable target dates |
| `ProgressSummaryCards.tsx` (85 lines) | Summary cards (total PONs, completion %, blockages) |

**PonProgressTracker:**
- Tabs: All, CWC, Optical, Activation, Maintenance (filter by phase)
- On PON click, opens DailyLogPanel
- Fetches data from pon-progress API
- Real-time refresh (polling or socket-based)

**DailyLogPanel:**
- New Entry form (phase selector, progress %, blockage reason, notes)
- Timeline view of past entries (scrollable, filterable)
- Edit inline to correct previous entries
- Backdrop overlay (closes on click)
- Responsive: max-w-lg on desktop, full-height on mobile

#### 4. Types & Constants

**pon-stages.types.ts** — Extended types for PON stage management

```typescript
type PonStage = {
  pon_id: string;
  pon_name: string;
  stage: 'created' | 'in_progress' | 'pole_planted' | 'construction_qa' | 'maintenance';
  plant_date?: string; // ISO 8601 date
  maintenance_stage?: 'pending' | 'in_progress' | 'completed';
};
```

#### 5. ProjectDetail Tab Integration

- Added `Build` tab to ProjectTabs.tsx
- Maps route `/projects/[projectId]#build` to PonProgressTracker component
- Tab visibility controlled by project type/status

### Migration

**`232_pon_progress_tracking.sql`** — Creates tables and extends projects JSONB

```sql
-- Create new tables
CREATE TABLE pon_daily_log (...)
CREATE TABLE project_monthly_targets (...)

-- Extend projects table to track PON stages
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pon_stages JSONB DEFAULT '[]'::jsonb;

-- Optional: backfill existing projects with empty pon_stages
UPDATE projects SET pon_stages = '[]'::jsonb WHERE pon_stages IS NULL;
```

---

## [2026-03-14] — fix(build): Improve Daily Log Panel UX + Pole Plant Date from Step 7

**Commit:** `58b026d`
**Type:** Bug Fix + UX Improvement
**Author:** Claude Opus 4.6
**Impact:** Better daily log panel usability; accurate pole plant date tracking; new nav bars for Fleet, SOW, Analytics, System.

---

### Problem

1. **Daily Log Panel UX was cramped:**
   - Small max-width (md) made entry form hard to read on desktop
   - No visual feedback when panel opened
   - Filter tabs hard to use on mobile (no overflow handling)
   - Confusing empty state
   - Inconsistent padding

2. **Pole plant date was inaccurate:**
   - Previously used Step 1 "Before Photo" date (earliest photo)
   - Step 1 photo is taken BEFORE the pole is planted
   - Should use Step 7 "After Photo" date (when pole was standing)

3. **Nav bar duplication across modules:**
   - AccountingNav, ProcurementNav had identical structure (~60 lines each)
   - Each new module required copy-paste nav code

### Solution

#### 1. Daily Log Panel UX Improvements

- **Wider panel:** max-w-lg (was max-w-md)
- **Dark backdrop overlay:** Closes panel when clicked
- **New Entry section label:** Clear visual hierarchy
- **Filter tabs overflow-x-auto:** Scrollable on mobile screens
- **Better empty state:** Icon + helpful message
- **Consistent padding:** Unified spacing throughout

Code changes: `DailyLogPanel.tsx` — adjusted layout CSS + Tailwind classes

#### 2. Pole Plant Date from Step 7 Photo

Changed source from Step 1 to Step 7 "After Photo" in two places:

**sync-qa-to-qfield.py:**
```python
# OLD: plant_date = MIN(photo.captured_at) for all steps
# NEW: plant_date = photos[step=7].captured_at, fallback to MIN(photo.captured_at)

step7_photos = [p for p in photos if p.step == 7]
plant_date = step7_photos[0].captured_at if step7_photos else min(p.captured_at for p in photos)
```

**ReviewWizard.tsx:**
```tsx
// OLD: "Planted" label shows earliest photo date
// NEW: "Planted" label shows Step 7 photo date with fallback

const plantedDate = pon_stages?.plant_date || project.qfield_start_date;
// plant_date is sourced from Step 7 by sync-qa-to-qfield.py
```

#### 3. Generic ModuleNav Component (Nav Bar Refactor)

Extracted shared nav structure into generic `ModuleNav.tsx`:

```tsx
<ModuleNav
  moduleName="Fleet"
  accentColor="amber"
  sections={[
    { label: "Dashboard", href: "/fleet" },
    { label: "Vehicles", href: "/fleet/vehicles" },
    { label: "Operations", href: "/fleet/operations" },
    { label: "Check-Ins", href: "/fleet/checkins" },
    { label: "Investigation", href: "/fleet/investigation" },
    { label: "Analytics", href: "/fleet/analytics" },
  ]}
/>
```

New nav bars added:

| Module | Accent | Routes |
|---|---|---|
| Fleet | Amber | Dashboard, Vehicles, Operations, Check-Ins, Investigation, Analytics |
| SOW | Teal | Dashboard, SOW List, Import, Data Grid |
| Analytics | Violet | Analytics, KPIs, Reports (multi-prefix: /analytics, /enhanced-kpis, /kpi-dashboard, /reports) |
| System | Slate | Health, Infrastructure, Data Sync, VLM, Data Management, Deployment, Settings (multi-prefix: /system, /settings, /deployment) |

Each module's nav is now a thin wrapper (~11 lines):

```tsx
// OLD: AccountingNav — 60+ lines of duplicate markup
// NEW: AccountingNav — thin wrapper
export const AccountingNav: React.FC<NavProps> = ({ ... }) => (
  <ModuleNav
    moduleName="Accounting"
    accentColor="indigo"
    sections={ACCOUNTING_NAV_SECTIONS}
  />
);
```

**Impact:** Reduced code duplication by ~200 lines; easier to add new modules.

### Files Changed

| File | Change | Lines |
|---|---|---|
| `src/modules/qfield-sync/scripts/sync-qa-to-qfield.py` | Plant date source: Step 1 → Step 7 (with fallback) | +3 |
| `src/pages/detail/ReviewWizard.tsx` | Plant date label uses pon_stages.plant_date | +2 |
| `src/components/pon-progress/DailyLogPanel.tsx` | UX improvements: wider panel, backdrop, better layout | +15 |
| `src/components/nav/ModuleNav.tsx` | **New file** — generic nav bar component | 55 |
| `src/components/nav/AccountingNav.tsx` | Refactored to use ModuleNav | −45 |
| `src/components/nav/ProcurementNav.tsx` | Refactored to use ModuleNav | −45 |
| `src/components/nav/FleetNav.tsx` | **New file** — uses ModuleNav | 11 |
| `src/components/nav/SowNav.tsx` | **New file** — uses ModuleNav | 11 |
| `src/components/nav/AnalyticsNav.tsx` | **New file** — uses ModuleNav | 11 |
| `src/components/nav/SystemNav.tsx` | **New file** — uses ModuleNav | 11 |

---

### Affected Artefacts

| Artefact | Detail |
|---|---|
| **Component** | `DailyLogPanel` — UX improvements |
| **Component (new)** | `ModuleNav` — generic nav bar |
| **Function** | `sync-qa-to-qfield.py::_resolve_plant_date()` — Step 7 logic |
| **Field** | `projects.pon_stages[].plant_date` — now sourced from Step 7 |
| **UI Routes** | Fleet, SOW, Analytics, System nav bars added |

---

*Changelog maintained by Scribe. Last updated: 2026-03-15*
