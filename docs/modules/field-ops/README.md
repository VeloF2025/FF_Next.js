# Field-Ops Module Documentation

**Module**: Field Operations (Construction QA)
**Status**: Active Development
**Last Updated**: 2026-03-10

---

## 🎯 Module Overview

The Field-Ops module manages fiber network construction QA, including:

- **Construction QA Reviews**: Step-by-step photo checklist validation
- **Photo Management**: Upload, organize, and review construction photos
- **Poles Planted Reports**: Dashboard tracking poles installed across projects
- **Photo Step Reassignment**: Drag-and-drop correction of VLM misclassifications
- **Wizard-Based Reviews**: Guided QA process with multiple phases

---

## 📊 Key Features

### 1. Poles Planted Reports Dashboard (PRIORITY: High)
**Commit**: `60492c0f` (2026-03-04)

Full-featured reporting dashboard replacing placeholder Reports tab:

- **Time Period Filtering**:
  - Predefined: Today, Yesterday, 7 days, 30 days, All-time
  - Custom date range selection
  
- **Summary Cards**:
  - Total poles planted in period
  - Poles per day (average)
  - Projects with installations
  - By-zone breakdown
  
- **Per-Project Bar Chart**:
  - Horizontal bar chart showing poles by project
  - Sortable by count, name, date
  
- **Project Table**:
  - Poles count per project
  - Date range data
  - Zone assignments
  - Click to drill down
  
- **Zone/PON Breakdown**:
  - Detailed table showing poles by zone
  - PON (Point of Presence) mapping
  - Coverage percentages

---

### 2. Photo Step Reassignment (PRIORITY: Medium)
**Commit**: `c2a52a52` (2026-03-03)

Drag-and-drop interface for correcting VLM photo misclassifications:

- **Drag-Drop Functionality**:
  - Drag photo thumbnails between checklist steps
  - @hello-pangea/dnd library with touch support
  - Optimistic UI updates (shows change immediately)
  - Grip handles on photo cards
  
- **Visual Feedback**:
  - Blue highlight on active drop targets
  - Dashed border on empty-step drop zones
  - Loading state during persistence
  
- **Step Management**:
  - Reassign photos to correct checklist steps
  - Clear VLM misclassifications without re-upload
  - Null step for "unassigned/unclear" photos
  
- **Persistence**:
  - PATCH `/api/construction-qa/photo-step` updates database
  - Transactional: Updates photo.checklist_step + step_label
  - Logs changes for audit trail

---

## 🏗️ Architecture

### Database
- **construction_qa_photos**: Stores individual photos
  - `checklist_step`: Numeric step assignment
  - `step_label`: Human-readable step name
  - `updated_at`: Last modified timestamp
  
- **construction_qa_reviews**: Parent review records
  - Links to project, discipline, phase
  - Tracks review state and completion

### Services
- **Reports API** (`pages/api/construction-qa/reports.ts`)
  - Date range parsing (SAST timezone aware)
  - Poles aggregation by project, zone, PON
  - Query optimization for large datasets
  
- **Photo Step Service** (PATCH endpoint)
  - Update checklist_step via `c2a52a52`
  - Async, non-blocking updates
  - Error handling + logging

### Components
- **FieldOpsReportsPage** (`src/modules/construction-qa/components/reports/FieldOpsReportsPage.tsx`)
  - Dashboard layout with time period picker
  - Summary cards grid
  - Bar chart (per-project poles)
  - Project table
  - Zone/PON breakdown table
  
- **PhasePhotoReview** (updated with drag-drop)
  - DragDropContext wrapping per-step Droppables
  - Draggable photo cards with grip handles
  - Drop target highlighting
  - Unassigned photo zone

### API Endpoints
- `GET /api/construction-qa/reports` - Poles planted aggregation
  - Query params: `period` (today/yesterday/7d/30d/all), `dateFrom`, `dateTo`
  - Returns: { summaryCards, projectChart, projectTable, zoneTable }
  
- `PATCH /api/construction-qa/photo-step` - Reassign photo to step
  - Body: { photoId, step, stepLabel }
  - Returns: { photoId, step, stepLabel }

---

## 🔧 Main Files

| File | Purpose | Change |
|------|---------|--------|
| `pages/api/construction-qa/reports.ts` | Reports API | NEW (60492c0f) |
| `src/modules/construction-qa/components/reports/FieldOpsReportsPage.tsx` | Reports dashboard UI | NEW (60492c0f) |
| `pages/api/construction-qa/photo-step.ts` | Photo step reassignment | NEW (c2a52a52) |
| `src/modules/construction-qa/components/wizard/PhasePhotoReview.tsx` | Photo review + drag-drop | UPDATED (c2a52a52) |
| `src/modules/construction-qa/components/wizard/ReviewWizard.tsx` | Wizard coordinator | UPDATED (c2a52a52) |
| `pages/field-ops/reports.tsx` | Reports page route | UPDATED (60492c0f) |

---

## 🚀 Workflows

### Reports Dashboard Access Flow

1. Navigate to **Field-Ops → Reports**
2. View default 7-day poles planted summary
3. Change time period:
   - Click preset (Today/Yesterday/7d/30d/All)
   - Or select custom date range
4. View aggregations:
   - Summary cards update instantly
   - Bar chart shows per-project breakdown
   - Project table with drill-down
   - Zone/PON breakdown for capacity planning
5. Export or share results

### Photo Reassignment Workflow

1. Open construction QA review (PhasePhotoReview phase)
2. VLM assigned photos to steps (may be wrong)
3. For misclassified photos:
   - Click and drag photo thumbnail
   - Drop on correct checklist step
   - UI updates immediately (optimistic)
4. Server persists via PATCH:
   - Updates `checklist_step` + `step_label`
   - Returns success
5. Continue review with corrected assignments

---

## 📝 Important Notes

### Reports Performance
- Date filtering done in SQL (efficient)
- SAST timezone (UTC+2) used for date boundaries
- Large datasets (>100k photos) may need pagination
- Consider caching period summaries for high-traffic

### Photo Reassignment
- Drag-drop works on touch and desktop
- Optimistic UI: User sees change immediately
- Network error: Show toast, allow retry
- Supports null step for "unclear" photos
- Audit trail: Log all reassignments with user + timestamp

### Testing Checklist
- [ ] Reports: Filter by each predefined period
- [ ] Reports: Custom date range selection works
- [ ] Reports: Summary cards match query results
- [ ] Reports: Bar chart renders 100+ projects
- [ ] Reports: Zone table shows accurate PON breakdown
- [ ] Photo Drag: Drag thumbnail between steps
- [ ] Photo Drag: Drop zone highlighting works
- [ ] Photo Drag: Persistence after drop succeeds
- [ ] Photo Drag: Network error handled gracefully
- [ ] Photo Drag: Audit logged for compliance

---

## 📚 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Commit history and changes
- **[Projects Module](../projects/README.md)** — Document management and validation
- **[Accounting Module](../accounting/README.md)** — Financial tracking

---

**Owner**: velo:velo
**Last Updated**: 2026-03-10
