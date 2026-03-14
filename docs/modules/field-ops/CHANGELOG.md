# Field-Ops Module CHANGELOG

All notable changes to the Field-Ops (Construction QA) module are documented here.

---

## [Unreleased]

### Changed
- **Discipline Consolidation: 3→2** (2026-03-10, commit `d66ce08e`)
  - Merged splicing discipline into optical (per Velocity Fibre Optical Checklist v1.0)
  - Removed legacy optical cable stringing discipline
  - Migration 240: Renamed all splicing columns to optical
  - 18 schema changes across construction_qa_reviews table

### Added
- **Poles Planted Reports Dashboard** (2026-03-04, commit `60492c0f`)
  - Full dashboard replacing placeholder Reports tab
  - Time period filtering (predefined + custom)
  - Summary cards, bar charts, project/zone tables
  
- **Photo Step Reassignment via Drag-Drop** (2026-03-03, commit `c2a52a52`)
  - Drag-and-drop photo reassignment between checklist steps
  - Visual feedback with highlighting
  - PATCH API for persistence
  - Corrects VLM misclassifications

---

## Commit Details

### d66ce08e — refactor(field-ops): consolidate disciplines from 3 to 2 (civil + optical)

**Date**: 2026-03-10 17:35:53 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Consolidates three disciplines (civil, optical, splicing) into two (civil, optical) per Velocity Fibre Optical Checklist v1.0. Merges splicing discipline into optical, removes legacy optical cable stringing discipline, and executes migration 240 affecting 64 rows with 18 schema changes.

#### Files Changed

1. **scripts/migrations/sql/240_optical_discipline_consolidation.sql** (+87 lines, NEW)
   - Drops old optical cable stringing columns (6 columns):
     - optical_step_01_cable_route
     - optical_step_02_attachment
     - optical_step_03_slack_coil
     - optical_step_04_cable_label
     - optical_step_05_no_backfeed
     - optical_step_06_sag_ok
   - Renames splicing_step_* → optical_step_* (16 columns renamed):
     - splicing_step_01-08 (Distribution Dome phase A)
     - splicing_step_11-16 (Main Joint phase B)
   - Renames splicing_sub_type → optical_sub_type
   - Updates 64 rows: discipline = 'splicing' → 'optical'
   - Recreates CHECK constraint: discipline IN ('civil', 'optical')
   - Uses PostgreSQL transaction with error handling

#### Schema Changes (18 total)

**Dropped Columns** (6):
- optical_step_01_cable_route
- optical_step_02_attachment
- optical_step_03_slack_coil
- optical_step_04_cable_label
- optical_step_05_no_backfeed
- optical_step_06_sag_ok

**Renamed Columns** (12):
- splicing_step_01_dome_on_pole → optical_step_01_dome_on_pole
- splicing_step_02_dome_label → optical_step_02_dome_label
- splicing_step_03_open_dome → optical_step_03_open_dome
- splicing_step_04_splice_protectors → optical_step_04_splice_protectors
- splicing_step_05_slack_management → optical_step_05_slack_management
- splicing_step_06_strength_members → optical_step_06_strength_members
- splicing_step_07_seals_dustcaps → optical_step_07_seals_dustcaps
- splicing_step_08_pole_id → optical_step_08_pole_id
- splicing_step_11_cable_entries → optical_step_11_cable_entries
- splicing_step_12_strength_members → optical_step_12_strength_members
- splicing_step_13_tube_routing → optical_step_13_tube_routing
- splicing_step_14_tray_entries → optical_step_14_tray_entries
- splicing_step_15_coiling_protectors → optical_step_15_coiling_protectors
- splicing_step_16_readable_labels → optical_step_16_readable_labels

**Updated Values** (1):
- discipline: 'splicing' → 'optical' (affects 64 rows)

**Updated Types** (1):
- discipline CHECK constraint: 'civil' | 'splicing' | 'optical' → 'civil' | 'optical'

#### Type System Changes

2. **src/modules/construction-qa/types/construction.types.ts** (+333 lines modified, -350 lines)
   - Updated Discipline type:
     ```typescript
     // Before: export type Discipline = 'civil' | 'optical' | 'splicing';
     // After:  export type Discipline = 'civil' | 'optical';
     ```
   - Consolidated ConstructionQaReview type:
     - Removed 6 old optical_step_* properties
     - Renamed 12 splicing_step_* → optical_step_*
     - Renamed splicing_sub_type → optical_sub_type
   - Updated ReviewFormData interface
   - Removed SplicingSubType enum
   - Updated DisciplineConfig mappings

#### API & Component Updates

3. **pages/api/construction-qa/** (22 files affected)
   - `ingest-qfield.ts` — Updated discipline mapping logic
   - `project-dashboard.ts` — Changed discipline queries/filters
   - `review.ts` — Updated review retrieval discipline handling
   - `vlm-validate.ts` — Updated discipline validation
   - `zone-hierarchy.ts` — Updated discipline aggregations

4. **src/modules/construction-qa/components/** (multiple files)
   - `ConstructionQaCentrePage.tsx` — Removed splicing references
   - `dashboard/FieldOpsDashboardPage.tsx` — Updated discipline counts
   - `dashboard/ProjectQaCard.tsx` — Changed discipline labels/counts
   - `dashboard/ProjectQaTable.tsx` — Updated discipline filtering
   - `project/PonFeaturesPanel.tsx` — Removed splicing discipline option
   - `project/PonRow.tsx` — Removed splicing discipline
   - `project/ProjectDetailPage.tsx` — Updated discipline display logic
   - `wizard/PhaseDataValidation.tsx` — Consolidated validation (38 lines modified)
   - `wizard/PhaseFinalDecision.tsx` — Updated decision logic (23 lines modified)
   - `wizard/PhasePhotoReview.tsx` — Removed splicing step references
   - `wizard/ReviewWizard.tsx` — Updated step context (6 lines modified)

5. **src/modules/construction-qa/services/**
   - `qfieldIngestionService.ts` — Updated discipline mapping for ingestion

6. **src/modules/construction-qa/types/**
   - `dashboard.types.ts` — Removed splicing type exports

7. **src/modules/help-center/data/**
   - `manual-content.ts` — Updated discipline descriptions (11 lines modified)

8. **src/config/modules/**
   - `construction-qa.config.ts` — Consolidated discipline configuration (4 lines modified)

#### Data Impact

- **Affected Rows**: 64 construction_qa_reviews records
- **Migration Strategy**: Zero-downtime (single transaction)
- **Rollback**: Reversible via reverse migration (restore columns, rename back, update values)
- **Testing**: All existing reviews now show optical discipline instead of splicing

#### Key Changes

- **Discipline Consolidation**:
  - Splicing (dome joint + cable routing) merged into optical
  - Optical discipline now encompasses both Phase A (dome) and Phase B (main joint)
  - Simplifies UI: 3 tabs → 2 tabs
  - Aligns with Velocity Fibre Optical Checklist v1.0

- **Type System**:
  - Removed SplicingSubType enum
  - All sub-types now under optical_sub_type
  - Discipline discriminant simplified

- **API Behavior**:
  - Discipline filter queries updated
  - Aggregations recount disciplined steps
  - Validation rejects 'splicing' value (raises 400)

- **UI/UX**:
  - Review wizard shows 2 discipline tabs: civil + optical
  - Dashboard counts reflect new discipline
  - Help center updated with new terminology

#### Testing Checklist

- [x] Migration 240 executed successfully
- [x] All 64 splicing records updated to optical
- [x] Discipline CHECK constraint updated
- [x] API endpoints reflect new discipline
- [x] UI renders optical tabs (no splicing)
- [x] Dashboard discipline counts correct
- [x] QField ingestion uses new discipline mapping
- [x] Help center terminology updated
- [x] No type system regressions
- [x] Review wizard validation passes

#### PRD Alignment

**Status**: Aligns with Velocity Fibre Optical Checklist v1.0 (internal specification).

**Notes**:
- No formal PRD in knowledge base, but driven by operational field standard
- Phase A (Distribution Dome) and Phase B (Main Joint) now consolidated under single "optical" discipline
- Removes legacy optical cable stringing steps (6 columns, 0 historical data)
- Simplifies checklist UX and type system

---

### 60492c0f — feat(field-ops): add poles planted reports dashboard

**Date**: 2026-03-04 04:35:40 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Replaces placeholder Reports tab with full-featured dashboard showing poles planted across configurable time periods. Includes summary cards, per-project bar chart, project table, and zone/PON breakdown.

#### Files Changed

1. **pages/api/construction-qa/reports.ts** (+290 lines, NEW)
   - GET endpoint for poles planted aggregation
   - Query params: `period` (today/yesterday/7d/30d/all), `dateFrom`, `dateTo`
   - SAST timezone aware (UTC+2) date range calculation
   - Returns structured response:
     - `summaryCards`: { totalPoles, polesPerDay, projectsCount, zoneCount }
     - `projectChart`: Array of { projectId, projectName, polesCount }
     - `projectTable`: Detailed project data with date ranges
     - `zoneTable`: Zone/PON breakdown with coverage
   - Handles edge cases (no data, future dates, null values)
   - Error handling with logging

2. **src/modules/construction-qa/components/reports/FieldOpsReportsPage.tsx** (+290 lines, NEW)
   - React component for full dashboard layout
   - Time period picker (buttons + custom date range)
   - Summary cards grid (styled with icons)
   - Bar chart visualization (per-project poles)
   - Project detail table (sortable, searchable)
   - Zone/PON breakdown table
   - Loading states and empty states
   - Responsive design for mobile/desktop

3. **pages/field-ops/reports.tsx** (updated, -14 lines)
   - Removed placeholder "Reports coming soon" message
   - Integrated FieldOpsReportsPage component
   - Proper error boundary and loading handling

#### Key Changes

- **Time Filtering**:
  - Predefined periods: today, yesterday, 7 days, 30 days, all-time
  - Custom range: Start date + end date pickers
  - SAST (UTC+2) aware calculations
  - Period-agnostic queries using SQL date comparisons
  
- **Aggregation Queries**:
  - Sum poles by project → bar chart
  - Sum poles by zone → zone table
  - Count by PON → coverage analysis
  - Metrics: Total, average per day
  
- **UI Components**:
  - Summary cards: Main KPIs at a glance
  - Bar chart: Visual project comparison
  - Project table: Detailed drill-down
  - Zone table: Capacity planning

#### Database Queries

Used **construction_qa_reviews** and **construction_qa_photos**:
- Date column: `COALESCE(r.last_photo_at, r.created_at)`
- Grouping: By project, zone, PON
- Filtering: Date range + status
- Aggregation: COUNT poles per group

#### API Usage Example

```bash
# Get poles for past 7 days
GET /api/construction-qa/reports?period=7d
Response: {
  summaryCards: {
    totalPoles: 1250,
    polesPerDay: 178.6,
    projectsCount: 8,
    zoneCount: 5
  },
  projectChart: [
    { projectId: "p1", projectName: "Downtown Build", polesCount: 450 },
    { projectId: "p2", projectName: "Suburb Link", polesCount: 380 },
    ...
  ],
  projectTable: [ ... ],
  zoneTable: [ ... ]
}

# Custom date range
GET /api/construction-qa/reports?dateFrom=2026-03-01&dateTo=2026-03-10
```

#### Testing Checklist

- [ ] Period selector updates data in real-time
- [ ] Summary cards reflect correct calculations
- [ ] Bar chart renders 50+ projects smoothly
- [ ] Project table sortable by all columns
- [ ] Zone table shows accurate PON mapping
- [ ] Custom date range works correctly
- [ ] All-time period loads without performance issues
- [ ] Responsive design: Mobile, tablet, desktop
- [ ] Error handling: No data, null values, future dates
- [ ] Export functionality (if applicable)

#### Notes

- Non-blocking: Dashboard loads even if aggregation is slow
- Performance: Consider caching period summaries for < 1min TTL
- Timezone: All dates in SAST (UTC+2) for South African context
- Future: Add export (CSV), drilldowns, comparison charts

---

### c2a52a52 — feat(field-ops): drag-and-drop photo step reassignment in QA wizard

**Date**: 2026-03-03 12:00:02 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Allows reviewers to drag photos between checklist steps to correct VLM misclassifications. Uses @hello-pangea/dnd for drag-drop with optimistic UI updates.

#### Files Changed

1. **pages/api/construction-qa/photo-step.ts** (+52 lines, NEW)
   - PATCH endpoint: Update photo's checklist_step + step_label
   - Request body: { photoId, step, stepLabel }
   - Validation:
     - photoId required (UUID)
     - step must be positive integer or null
     - stepLabel optional string
   - Response: { photoId, step, stepLabel } on success
   - Error handling:
     - 400: Missing/invalid parameters
     - 404: Photo not found
     - 500: Database error with logging
   - Uses Neon SQL with UUID casting

2. **src/modules/construction-qa/components/wizard/PhasePhotoReview.tsx** (+433 lines modified, -162 lines)
   - Added DragDropContext (from @hello-pangea/dnd)
   - Per-step Droppable zones
   - Draggable photo thumbnails with Draggable wrapper
   - Grip handles (GripVertical icon) on photo cards
   - Visual feedback:
     - Blue highlight on active drop targets
     - Dashed border on empty-step zones
     - Cursor change on drag (grabbing)
   - `handleDragEnd()` callback:
     - Calls `onPhotoStepChange()` to update server
     - Optimistic UI (shows change immediately)
     - Error toast on failure
     - Auto-retry logic
   - Step label lookup map for DnD context

3. **src/modules/construction-qa/components/wizard/ReviewWizard.tsx** (+24 lines)
   - Added `onPhotoStepChange` handler prop
   - Implements API call to PATCH `/api/construction-qa/photo-step`
   - Manages loading state during persistence
   - Error handling + user feedback

#### Key Changes

- **Drag-Drop Library**: @hello-pangea/dnd (React Beautiful DnD alternative)
  - Touch-friendly (mobile support)
  - Performant (optimized rendering)
  - Accessible (keyboard navigation)
  
- **Visual Feedback**:
  - Grabbing cursor on photo drag
  - Blue highlight on drop zone (active)
  - Dashed empty-step zones
  - Loading spinner during persistence
  
- **Persistence Flow**:
  - User drags photo → Optimistic update (show new step immediately)
  - PATCH request sent to `/api/construction-qa/photo-step`
  - Server validates + updates `checklist_step` column
  - Success: Close spinner, keep change
  - Error: Show toast, revert UI, allow retry
  
- **Null Step Support**:
  - Photos can be dragged to "Unassigned" zone
  - `step = null` in database
  - Useful for unclear/ambiguous photos

#### API Usage Example

```bash
# Move photo to step 3
PATCH /api/construction-qa/photo-step
Body: {
  "photoId": "uuid-123",
  "step": 3,
  "stepLabel": "Foundation Inspection"
}
Response: {
  "photoId": "uuid-123",
  "step": 3,
  "stepLabel": "Foundation Inspection"
}

# Move photo to unassigned
PATCH /api/construction-qa/photo-step
Body: {
  "photoId": "uuid-123",
  "step": null,
  "stepLabel": null
}
Response: {
  "photoId": "uuid-123",
  "step": null,
  "stepLabel": null
}
```

#### Testing Checklist

- [ ] Drag thumbnail between steps works
- [ ] Drop zone highlighting appears on hover
- [ ] UI updates immediately (optimistic)
- [ ] Server persistence successful (PATCH returns 200)
- [ ] Photo still in new step after page reload
- [ ] Drag to unassigned (null step) works
- [ ] Network error shows toast + reverts UI
- [ ] Retry after error succeeds
- [ ] Touch drag works on mobile/tablet
- [ ] Keyboard navigation (if enabled)
- [ ] Multiple photo drags in sequence work
- [ ] Concurrent drag-drop requests handled

#### Notes

- Optimistic UI: Change visible immediately, server catches up
- Rollback: If PATCH fails, revert to previous step (shown via toast)
- Audit: Log each reassignment with user ID + timestamp
- Performance: DnD library optimized for large photo counts (100+)
- Accessibility: Consider keyboard support for nav + drag

---

**Module Owner**: velo:velo  
**Last Updated**: 2026-03-10  
**Changelog Version**: 1.0
