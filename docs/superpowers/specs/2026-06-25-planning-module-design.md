# Planning Module — Design Spec (v1)

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Author:** Planning / Zander (with Claude)

## Summary

A new **Planning** section for FibreFlow, structurally modelled on the existing NOC
Kanban. It tracks **planning work-items** as cards that move through a 6-stage
planning workflow (Intake → As-Built & Handover). Cards are filterable by project.
Clicking a card opens an editable detail page where the item is stepped through the
stages and each stage's checklist is ticked off.

The section appears in the left sidebar **directly below Procurement**.

This is a deliberate base-level v1. It is built to be extended (gate enforcement,
attachments, RACI, KPIs, planning automation) without schema rework.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Card unit | **Many cards per project** (e.g. per PON / zone / area / phase) |
| 2 | Pipeline relationship | **Auto-create** the first card when a pipeline project reaches `planned`/`ready_to_plan` |
| 3 | Stage movement | **Free drag** (like NOC) for v1; gate criteria shown as checklists, not enforced |
| 4 | Detail page depth | **Stage stepping + per-stage checklists + assignee + notes/activity log** |
| 5 | Router | **App Router** (`app/` folder), to match NOC which we are cloning |
| 6 | Kanban code sharing | **Separate, cloned board** — Planning gets its own board, no shared component with NOC |

## Concept

- **Card = a planning work-item** belonging to exactly one project. A project can have
  many cards.
- One card is **auto-seeded** at Stage 0 when its project reaches the planning hand-off
  point (pipeline `planned`/`ready_to_plan`); additional cards are created manually by
  planners.

## Board columns (the 6 stages)

Taken verbatim from the "Detailed" sheet of the Planning Workflow spreadsheet. Each
stage carries a gate criterion, shown in v1 as a checklist item (not enforced).

| Col | Stage key | Stage name | Gate criteria (shown, not enforced in v1) |
|----|-----------|------------|-------------------------------------------|
| 0 | `intake` | Intake & Setup | Design basis approved, baseline datasets accepted |
| 1 | `hld` | HLD (High-Level Design) | HLD baseline frozen, cost envelope accepted |
| 2 | `lld` | LLD (Low-Level Design) | Constructibility accepted, engineering checks passed |
| 3 | `splice` | Splice & Fiber Allocation | End-to-end continuity validated, splice pack approved |
| 4 | `change_control` | Construction Change-Control | Redlines resolved/deferred, latest revision acknowledged |
| 5 | `as_built` | As-Built & Handover | As-Built QA passed, handover signed, project closed |

**Off-board statuses** (hidden by default, reachable via a sub-tab, mirroring NOC's
`cancelled` handling): `on_hold`, `cancelled`.

## Per-stage checklist content

Each stage's **Activities**, **Outputs**, and **Gate criteria** from the spreadsheet
are stored as a TypeScript template constant `PLANNING_STAGE_TEMPLATE`. On card
creation, the template is copied into the card's `stage_checklists` JSONB so planners
get the spreadsheet's checklist out of the box, and the template can evolve without a
database migration.

Source content per stage (from the "Detailed" sheet):

- **Stage 0 Intake & Setup** — Objective: confirm project mandate, boundary,
  assumptions, standards. Activities: align planning assumptions, validate base data
  quality, confirm constraints and naming standards. Outputs: approved design basis,
  assumptions register, project coding standard.
- **Stage 1 HLD** — Objective: define macro architecture, capacity strategy, rollout
  concept. Activities: define PON/service areas, cabinet/FDH concepts, feeder
  corridors, high-level capacity and costing. Outputs: HLD map pack, preliminary BoQ,
  risk/dependency register.
- **Stage 2 LLD** — Objective: convert HLD into buildable segment-level design.
  Activities: detailed feeder/distribution/drop routing, node hierarchy, cable sizing,
  route-level constructibility checks. Outputs: LLD design pack, construction-grade
  BoQ, rule-compliance log.
- **Stage 3 Splice & Fiber Allocation** — Objective: define end-to-end fiber
  continuity and execution splice instructions. Activities: fiber allocation, closure
  planning, port/tray assignment, continuity validation. Outputs: splice schedules,
  continuity table, closure and tray assignment sheets.
- **Stage 4 Construction Change-Control** — Objective: control design changes during
  construction without losing integrity. Activities: capture field changes, impact
  assess, approve/reject revisions, reissue controlled packs. Outputs: revision log,
  redline register, updated controlled drawings/schedules.
- **Stage 5 As-Built & Handover** — Objective: deliver final authoritative installed
  network and operations handover. Activities: reconcile installed assets vs design,
  finalize continuity, close deltas. Outputs: as-built maps/register, final splice
  pack, planned-vs-as-built variance report, handover package.

## Data model

New tables, mirroring `maintenance_tickets` / `maintenance_activities` /
`maintenance_ticket_sequences`.

### `planning_items`
- `id` UUID PK
- `item_uid` VARCHAR — format `PLN-YYYYMMDD-NNN` via atomic sequence table
- `project_id` UUID FK → `projects(id)`
- `title` VARCHAR (required)
- `description` TEXT (nullable)
- `scope_area` VARCHAR (nullable) — free text: PON / zone / phase
- `stage` VARCHAR — `intake | hld | lld | splice | change_control | as_built | on_hold | cancelled`
- `assigned_to` UUID FK → `staff(id)` (nullable)
- `priority` VARCHAR — `low | normal | high | urgent` (default `normal`)
- `source` VARCHAR — `pipeline_auto | manual`
- `stage_checklists` JSONB — per-stage checklist items + done flags (seeded from template)
- `pipeline_project_id` UUID (nullable) — link to originating pipeline project
- `created_at` TIMESTAMP, `created_by` UUID FK → `users(id)`
- `updated_at` TIMESTAMP, `closed_at` TIMESTAMP (nullable)

Indexes: `(project_id)`, `(stage)`, `(assigned_to)`, `(pipeline_project_id)`.

### `planning_activities`
Audit trail (stage change, assignment, note, checklist toggle, create/cancel). Same
shape as `maintenance_activities`: `id`, `planning_item_id` FK, `activity_type`,
`field_changed`, `old_value`, `new_value`, `note`, `created_at`, `created_by`.

### `planning_item_sequences`
Atomic per-day UID generation (mirrors `maintenance_ticket_sequences`).

## Pipeline → Planning auto-handoff

When a `pipeline_projects` row transitions to `planned` (or `ready_to_plan`), create
one `planning_items` card:
- `source = 'pipeline_auto'`, `stage = 'intake'`
- `project_id` resolved from the pipeline project's linked/planned project
- `pipeline_project_id` set to the originating pipeline project
- **Idempotent**: at most one auto-created card per `pipeline_project_id`.

Hooked into the existing pipeline status-update code path. This is the single most
coupled piece; it is isolated so it can be disabled without affecting the rest of the
module.

## API (App Router, matching NOC)

- `GET /api/planning/items` — list + filter: `project_id`, `stage`, `exclude_stage[]`,
  `assigned_to`, `search`, `created_after`, `created_before`, `sort`, `page`,
  `pageSize`. Returns `{ success, data, pagination }`.
- `POST /api/planning/items` — create (manual); seeds `stage_checklists` from template,
  generates `item_uid`. Validates `project_id`, `title`.
- `GET /api/planning/items/[id]` — single item, enriched with project name + assignee.
- `PUT /api/planning/items/[id]` — partial update (stage move, assignment, checklist
  toggle, notes); logs activity for each change.
- `DELETE /api/planning/items/[id]` — soft delete → `stage = 'cancelled'`, sets
  `closed_at`, logs cancellation.

All responses use the existing `apiResponse` helper.

## UI

### Routes (App Router, mirroring NOC structure)
- `app/(main)/planning/page.tsx` — board (server wrapper → client)
- `app/(main)/planning/[id]/page.tsx` — detail
- `app/(main)/planning/new/page.tsx` — create

### Board
Clone NOC's `KanbanBoard` into `src/modules/planning/components/KanbanBoard/`
(separate, not shared). `@hello-pangea/dnd` drag-and-drop + chevron quick-move +
optimistic updates. Columns from the 6 stages above; `on_hold`/`cancelled` in a
"completed/parked" sub-tab. Mobile (<768px) falls back to a list view, like NOC.

### Filter bar
Project dropdown (reuse `ProjectQueryService.getActiveProjects()`; adapt
`ProcurementProjectSelector` styling), stage filter, assignee picker, search box.
State persisted to the URL via `useUrlFilters`, exactly like NOC's tickets filter.

### Detail page
- Header: `item_uid`, project, current stage, assignee, priority.
- The 6 stages rendered as collapsible panels; each panel lists its Activities /
  Outputs / Gate items as checkable items (writes back to `stage_checklists`).
- Stage-step controls: back / next + jump-to-stage.
- Notes + activity timeline (from `planning_activities`).

## Sidebar / RBAC

- New `src/components/layout/sidebar/config/planningSection.ts`, exported from the
  sidebar config index and inserted into `navItems` (in `navigationConfig.ts`)
  **immediately after `procurementSection`**.
- Single nav item → `/planning`, icon from lucide (e.g. `ClipboardList`).
- RBAC key `planning.main` (seed the permission); `permissions: []` open for now,
  matching NOC's current entry.

## Out of scope for v1 (planned for later)

- Gate **enforcement** / named-approver sign-off per gate (G0–G5).
- File / map-pack **attachments** per stage.
- **RACI** department-role tracking (Planning Lead, GIS/Design, Build, Wayleave,
  Finance, PMO, Ops/NOC).
- **KPI** dashboard (HLD cycle time, LLD right-first-time, splice issue rate, redline
  closure time, planned-vs-built variance, handover acceptance duration).
- **Planning automation** (QGIS/Comsof equivalents from the spreadsheet's automation
  sheets — demand clustering, DP auto-placement, cable routing, BOQ generation, etc.).

The v1 schema (JSONB checklists, `source`, activity log, `pipeline_project_id`) is
shaped so these slot in without rework.

## Build approach

Clone-and-adapt NOC for v1 — fastest and lowest risk, and keeps the live NOC board
untouched. All new code is self-contained under `src/modules/planning/` and
`app/(main)/planning/`. The two boards remain fully separate per the locked decision.

## Success criteria

- Planning appears below Procurement in the sidebar and routes to `/planning`.
- Board shows 6 stage columns; cards drag/quick-move between stages with optimistic UI.
- Project filter narrows the board to a chosen project; stage/assignee/search filters
  work and persist to the URL.
- Clicking a card opens the detail page; stage stepping, checklist toggles, assignment,
  and notes all persist and are reflected back on the board.
- Reaching pipeline `planned`/`ready_to_plan` auto-creates exactly one Stage-0 card for
  that project.
- `npm run ci:quick` passes.
