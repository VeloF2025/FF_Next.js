# Geofence Archetype Matching — Design Spec

**Date:** 2026-05-08
**Owner:** Hein van Vuuren
**Status:** Draft (awaiting review)

## Problem

The current clock-in geofence matcher (`pages/api/my/attendance/clock-in.ts` →
`matchGeofence`) only checks `fleet_authorized_locations` (global sites + each
staffer's `home_site_id`). Project locations are never used as geofences, even
though every project has lat/lon plus per-zone polygon boundaries imported from
QField (`zone_boundaries.geojson`, `pon_boundaries.geojson`).

Consequence: the geo-mismatch report at `/staff/attendance/reports/geo-mismatch`
flags everyone whose clock-in didn't happen near a fleet site — including
office staff working from home and field staff who clocked in well inside their
project's actual boundary. The report is currently noisy and the geofence
column reads `0.00` for all rows because nothing matched.

Staff fall into three behavioural archetypes, none of which the current matcher
expresses:
- **Project-based** — works one project (Civil, Optical, field_operations)
- **Mobile** — moves between projects (NOC, Maintenance, multi-site PMs)
- **Office-bound** — desk role, frequently WFH (Procurement, Commercial &
  Strategy, Planning)

## Goal

Replace the single-rule matcher with an archetype-aware matcher that:
1. Honours WFH for office-bound staff (no geofence enforcement).
2. Validates project-based staff against their primary project's actual polygon.
3. Validates mobile staff against any of their active project polygons or office sites,
   tagging non-primary matches as "visiting".
4. Enriches each `attendance_entries` row with the matched project and archetype
   so the report can show *expected project*, *distance to nearest assigned
   polygon*, and *archetype*.

## Non-goals

- Project polygon editing UI (polygons come from QField imports).
- Standalone offices table (reuse `fleet_authorized_locations` rows where
  `location_type='office'`).
- Real-time dashboard (Phase 1 is a static report).
- Cartrack/vehicle GPS cross-check (separate exception kind, untouched).
- Backfilling `archetype_at_clockin` for historical entries (forward-only).

## Phase 1 — Analysis (read-only)

A new page `/staff/attendance/reports/geofence-patterns` plus CSV export. No
data writes. Goal: validate the archetype model against actual clock-in data
before flipping the matcher.

### Per-staff row

Phase 1 only reads tables that already exist (`staff`, `staff_projects`,
`attendance_entries`, `fleet_authorized_locations`, `zone_boundaries` post
Migration A). It does **not** depend on `staff.archetype` or
`department_archetype_defaults` — those land in Phase 2. The "proposed
department default" used here is hardcoded in the report query, not seeded.

| Column | Source |
|---|---|
| Staff name, department | `staff` |
| Active project assignments | `staff_projects` where `is_active=true` |
| Clock-ins (last 30 d) | `attendance_entries` |
| % inside primary polygon | `ST_Contains(zone.geom, point)` joined via `staff_projects.is_primary` |
| % inside any assigned polygon | `ST_Contains` joined via any active assignment |
| % near an existing office site | `fleet_authorized_locations` where `location_type='office'` |
| % unmatched | residual |
| Distinct project polygons hit | `COUNT(DISTINCT project_id)` |
| Suggested archetype | rule below |
| Proposed department-default archetype | hardcoded mapping in the query (matches the seed table proposed for Phase 2) |
| Mismatch flag | suggested ≠ proposed default |

### Suggested-archetype rule (deterministic, first match wins)

Evaluated top-to-bottom; the first rule that matches assigns the archetype:

1. **`project`** — ≥80 % of clock-ins inside a *single* project polygon (the
   one that contains the most clock-ins).
2. **`mobile`** — ≥3 distinct project polygons hit, with each accounting for
   >10 % of clock-ins.
3. **`office`** — ≥80 % of clock-ins within any office geofence
   (`fleet_authorized_locations` where `location_type='office'`).
4. **`office` with "low signal"** — fewer than 5 clock-ins in the window, or
   none of the above thresholds met.

### Three call-out tables on the page

1. **Likely misclassified** — current archetype (or department default) ≠ suggested archetype.
2. **Data gaps — project staff missing assignments** — suggested `project` but `staff_projects` empty.
3. **Data gaps — office staff missing home_site_id** — suggested `office` but `home_site_id IS NULL`.

This page is the gate for Phase 2: we use it to seed
`department_archetype_defaults` and decide which staff need a manual
`archetype` override.

## Phase 2 — Feature

### Architecture

```
                           ┌─ staff (archetype override?) ─┐
                           │                               │
   POST /api/my/attendance/clock-in                        ▼
        │                                       resolveArchetype(staff)
        ▼                                                  │
  matchClockInLocation(lat,lon, staff)  ────►   ┌──────────┴───────────┐
        │                                       │ project | mobile | office
        ▼                                       └──────────┬───────────┘
  attendance_entries (+ archetype_at_clockin,
                       matched_project_id, matched_zone_no, visiting)
        │
        └──► attendance_exceptions (only if mismatch under archetype rules)
```

### New code seams

1. **`resolveArchetype(staffId)`** —
   `staff.archetype` override → `department_archetype_defaults` lookup →
   fallback `'office'` (safest; doesn't generate exceptions).
2. **`matchProjectPolygon(lat, lon, staffId, opts)`** —
   SQL using `ST_Contains` against `zone_boundaries.geom` joined to
   `staff_projects` (`is_active=true`). `opts.scope` is `'primary'` or `'any'`.
   Returns `{ projectId, zoneNo, isPrimary, distanceToNearestPolygonM }`.
   `distanceToNearestPolygonM` is computed via `ST_Distance` on geography
   against the polygons in scope (primary only for `project` archetype, any
   active assigned polygon for `mobile`).
3. **`matchClockInLocation`** wraps the above with archetype switching:
   - `office` → `{ ok: true }` always. No exception. No project link.
   - `project` → primary `staff_projects` polygon only. Match → `{ ok:true, projectId, zoneNo, isPrimary:true }`. Miss → `{ ok:false, distanceToNearestPolygonM, expectedProjectId }`.
   - `mobile` → two-stage:
     1. any active assigned polygon → `{ ok:true, projectId, isPrimary, visiting: !isPrimary }`
     2. fallback to any office geofence → `{ ok:true, officeSiteId }`
        Miss both → `{ ok:false, distanceToNearestPolygonM }`.

### Clock-in API change

`pages/api/my/attendance/clock-in.ts`:

```ts
const archetype = await resolveArchetype(staffId);
const match = await matchClockInLocation({ lat, lon, staffId, archetype });

await insertAttendanceEntry({
  ...,
  archetype_at_clockin: archetype,
  matched_project_id: match.projectId ?? null,
  matched_zone_no:    match.zoneNo ?? null,
  visiting:           match.visiting ?? false,
  site_geofence_id:   match.officeSiteId ?? null,
});

if (!match.ok) {
  await insertException({
    kind: 'geofence_mismatch',
    severity: 'warning',
    details: {
      archetype,
      distanceToNearestPolygonM: match.distanceToNearestPolygonM,
      expectedProjectId: match.expectedProjectId,
    },
  });
}
```

### Geo-mismatch report changes

`src/services/attendance/reports/geoMismatch.ts`:
- Add `WHERE archetype_at_clockin <> 'office'` (drop WFH staff from the report).
- Add columns: `archetype`, `expected_project`, `distance_to_nearest_polygon_km`.
- New filter: archetype (project / mobile / all).
- New separate **Visiting** tab: rows where `visiting=true` (mobile staff at
  non-primary projects — useful for travel/cost tracking, not a mismatch).

### Admin UI

- **`/staff/admin/department-archetypes`** — small table editor for
  `department_archetype_defaults`. Super-admin only.
- **Staff edit page** — add an `archetype` dropdown:
  `Auto (department default)` | `Project` | `Mobile` | `Office`.
  When `Auto` is selected, show the resolved value beside the dropdown.

## Schema changes

### Migration A — PostGIS + polygon backfill

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE zone_boundaries  ADD COLUMN geom geometry(MultiPolygon, 4326);
ALTER TABLE pon_boundaries   ADD COLUMN geom geometry(MultiPolygon, 4326);

UPDATE zone_boundaries
   SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)))
 WHERE geom IS NULL;
UPDATE pon_boundaries
   SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)))
 WHERE geom IS NULL;

CREATE INDEX idx_zone_boundaries_geom ON zone_boundaries USING GIST (geom);
CREATE INDEX idx_pon_boundaries_geom  ON pon_boundaries  USING GIST (geom);
```

Plus update `src/lib/qfield/gpkg-import-layers.ts` so future imports populate
`geom` alongside `geojson`. The JSONB column stays — `geom` is additive.

### Migration B — staff archetype

```sql
CREATE TYPE staff_archetype AS ENUM ('project', 'mobile', 'office', 'auto');

ALTER TABLE staff
  ADD COLUMN archetype staff_archetype NOT NULL DEFAULT 'auto';

CREATE TABLE department_archetype_defaults (
  department TEXT PRIMARY KEY,
  archetype  staff_archetype NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES staff(id)
);
```

Seeded from Phase 1 findings (proposed seed):

| Department | Archetype |
|---|---|
| Civil | project |
| Optical | project |
| field_operations | project |
| NOC | mobile |
| Maintenance | mobile |
| Project Management | mobile |
| Procurement | office |
| Commercial & Strategy | office |
| Planning | office |
| General | office |

The actual seed values are **finalised after Phase 1 runs**, not before.

### Migration C — clock-in enrichment

```sql
ALTER TABLE attendance_entries
  ADD COLUMN archetype_at_clockin staff_archetype,
  ADD COLUMN matched_project_id   UUID REFERENCES projects(id),
  ADD COLUMN matched_zone_no      INTEGER,
  ADD COLUMN visiting             BOOLEAN NOT NULL DEFAULT false;
```

`archetype_at_clockin` is a snapshot — if a staffer's archetype changes later,
historical entries don't shift.

## Risks

### Hard

1. **PostGIS on shared dev+prod DB.** `CREATE EXTENSION` and the GIST indexes
   affect production immediately (DB cutover 2026-04-18 made dev+prod share one
   instance). Mitigation: schedule with Hein outside business hours, run on a
   Supabase backup first to time the backfill, keep `geojson` intact.
2. **GeoJSON parse failures during backfill.** Some rows may be Polygon (not
   MultiPolygon) or have invalid rings. Mitigation: backfill wrapped in
   `ST_Multi(ST_MakeValid(...))`; log + skip failures; report remaining nulls
   before Phase 2 turns on.
3. **Stricter rule could increase mismatch volume.** A Civil PM with no
   `is_primary` flag set on any of their `staff_projects` rows would suddenly
   fail. Mitigation: Phase 1 surfaces this exact gap before we flip the matcher;
   rollout is gated on the data-gap tables hitting zero.

### Soft

4. **Manager visits.** A super-admin/director (Hein) clocks in everywhere. The
   `office` archetype covers this — directors are office-bound by department
   default.
5. **Shared `staff_projects` bloat.** If `is_active=true` rows aren't pruned
   when projects close, mobile staff match too widely. Phase 1 reports per-staff
   "distinct polygons hit"; if a staffer hits 5+ polygons, surface for cleanup.

## Rollout

1. **Migration A** (PostGIS + backfill) — manual approval, after-hours.
2. Phase 1 page lives (no behaviour change). Use it for 1-2 weeks; seed
   `department_archetype_defaults`; close data gaps.
3. **Migration B + C** (`archetype` columns).
4. Matcher change behind a feature flag `GEOFENCE_ARCHETYPE_MATCHER=on`.
   Default off in production.
5. Enable in dev → observe a week → enable in production after Hein signs off.

## Files we'll touch

| Area | File / new path |
|---|---|
| Migrations | `scripts/migrations/<next>_postgis_polygon_geom.sql`, `..._staff_archetype.sql`, `..._attendance_entries_archetype.sql` |
| QField import | `src/lib/qfield/gpkg-import-layers.ts` (populate `geom` on insert) |
| Resolver | `src/services/attendance/archetype/resolveArchetype.ts` (new) |
| Matcher | `src/services/attendance/archetype/matchClockInLocation.ts` (new); `src/services/attendance/matchGeofence.ts` (delegates) |
| Clock-in API | `pages/api/my/attendance/clock-in.ts` |
| Phase 1 report | `pages/api/staff/attendance/reports/geofence-patterns.ts`, page in `pages/staff/attendance/reports/[slug].tsx` (new slug) |
| Phase 2 report | `src/services/attendance/reports/geoMismatch.ts` (extend) |
| Admin UI | `pages/staff/admin/department-archetypes.tsx` (new), staff edit page (extend) |
| Tests | `__tests__` next to each new module; integration test for matcher across all three archetypes |

## Open questions

- **Default archetype seed values.** Listed above are proposals; the Phase 1
  page is what finalises them. Do not run Migration B's seed until Phase 1 has
  run for at least one full work week.
- **`is_primary` enforcement.** Phase 1 will surface project-based staff with
  no `is_primary=true` row on any active assignment. Decision after Phase 1:
  add a `CHECK` requiring exactly one primary per `(staff_id, is_active=true)`,
  or fall back to "any assignment" when no primary exists.
