# Geofence Archetype Matching — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only `/staff/attendance/reports/geofence-patterns` analysis report so we can validate the project / mobile / office archetype model against real clock-in data before changing the matcher.

**Architecture:** Add PostGIS to the shared Supabase DB and a `geom` column to the existing `zone_boundaries` and `pon_boundaries` tables (backfilled from existing `geojson` JSONB). Add one new report runner (`geofencePatterns.ts`) wired into the existing catalogue + slug router — no frontend code changes; `pages/staff/attendance/reports/[slug].tsx` already renders any catalogued report. Two pure helper modules (`proposedDepartmentDefaults`, `suggestArchetype`) hold the rule logic so it's unit-testable.

**Tech Stack:** PostgreSQL + PostGIS · Next.js Pages Router · `pg.Pool` via `@/lib/db-pool` · vitest · existing report-catalogue pattern in `src/services/attendance/reports/`

**Spec:** `docs/superpowers/specs/2026-05-08-geofence-archetype-matching-design.md`

**Out of scope (Phase 2):** `staff.archetype` column, `department_archetype_defaults` table, `attendance_entries` enrichment columns, matcher rewrite, admin UI, geo-mismatch report changes. All deferred until Phase 1 has produced ≥5 working days of observed data.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/migrations/sql/335_postgis_polygon_geom.sql` | Create | Enables PostGIS, adds `geom MultiPolygon(4326)` columns to `zone_boundaries` and `pon_boundaries`, backfills from `geojson`, adds GIST indexes. JSONB `geojson` column stays — `geom` is additive. |
| `src/lib/qfield/gpkg-import-spatial.ts` | Modify | Update zone_boundaries + pon_boundaries INSERTs to also write `geom` (computed from the same GeoJSON the row already carries) so future imports don't drift. |
| `src/services/attendance/archetype/proposedDepartmentDefaults.ts` | Create | Hardcoded `Record<string, ArchetypeKind>` matching the spec's Phase 2 seed proposal. Used by Phase 1 to compute "proposed default archetype" before any DB-backed seed exists. |
| `src/services/attendance/archetype/suggestArchetype.ts` | Create | Pure function `suggestArchetype(metrics) → { archetype, lowSignal }` implementing the deterministic four-rule ladder from the spec (≥80 % primary → project, ≥3 polygons each >10 % → mobile, ≥80 % office → office, else low-signal). |
| `src/services/attendance/archetype/__tests__/suggestArchetype.test.ts` | Create | Unit tests for every rule branch + edge cases. |
| `src/services/attendance/archetype/__tests__/proposedDepartmentDefaults.test.ts` | Create | Smoke test that the mapping is total over the spec's 10 departments and returns valid archetype keys. |
| `src/services/attendance/reports/geofencePatterns.ts` | Create | The report runner. One SQL pass returns per-staff metrics; runner composes with `suggestArchetype` + `proposedDepartmentDefaults` and emits a flat row per staffer with all flags. |
| `src/services/attendance/reports/types.ts` | Modify | Extend `ReportSlug`, `ALL_REPORT_SLUGS`, and `REPORT_CATALOGUE` with the `'geofence-patterns'` entry. |
| `src/services/attendance/reports/runner.ts` | Modify | Add `'geofence-patterns': runGeofencePatterns` to the dispatch table; import the new runner. |

**No frontend changes.** `pages/staff/attendance/reports/[slug].tsx` reads `REPORT_CATALOGUE` and `pages/api/staff/attendance-report.ts` reads the runner dispatch — both pick the new report up automatically.

---

### Task 1: Migration 245 — PostGIS extension, geom columns, backfill

**Files:**
- Create: `scripts/migrations/sql/335_postgis_polygon_geom.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 335_postgis_polygon_geom.sql
-- Add PostGIS-backed polygon geometry alongside existing GeoJSON.
-- Phase 1 of geofence archetype matching (spec 2026-05-08).

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE zone_boundaries ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
ALTER TABLE pon_boundaries  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);

-- Backfill: GeoJSON Polygon → MultiPolygon, validate, set SRID.
-- ST_MakeValid handles self-intersections; rows that still fail go to a
-- log-only NOTICE so the deploy isn't blocked by a single bad row.
DO $$
DECLARE
  r RECORD;
  bad_zone INT := 0;
  bad_pon  INT := 0;
BEGIN
  FOR r IN SELECT id, geojson FROM zone_boundaries WHERE geom IS NULL LOOP
    BEGIN
      UPDATE zone_boundaries
         SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.geojson::text), 4326)))
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      bad_zone := bad_zone + 1;
      RAISE NOTICE 'zone_boundaries % failed geom backfill: %', r.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN SELECT id, geojson FROM pon_boundaries WHERE geom IS NULL LOOP
    BEGIN
      UPDATE pon_boundaries
         SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.geojson::text), 4326)))
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      bad_pon := bad_pon + 1;
      RAISE NOTICE 'pon_boundaries % failed geom backfill: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill complete. zone_boundaries failures=%, pon_boundaries failures=%', bad_zone, bad_pon;
END $$;

CREATE INDEX IF NOT EXISTS idx_zone_boundaries_geom ON zone_boundaries USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pon_boundaries_geom  ON pon_boundaries  USING GIST (geom);

COMMIT;
```

- [ ] **Step 2: Lint the SQL by running it dry against a local clone**

This migration is **not** auto-run by the normal deploy. It's an after-hours, Hein-approved operation per the spec's risk section. The plan's job is to provide the file; running it is a separate manual gate.

For local sanity-check only, dry-run against a fresh local Postgres if you have PostGIS available:

```bash
psql -h localhost -U postgres -d fibreflow_local < scripts/migrations/sql/335_postgis_polygon_geom.sql
```

Expected: `BEGIN`, several `NOTICE` lines (zero or low backfill failure counts), `COMMIT`. No `ERROR`.

If you don't have a local PostGIS, skip this step and rely on the dev DB run — flag in the PR description that the dry-run was deferred.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrations/sql/335_postgis_polygon_geom.sql
git commit -m "migration(245): postgis + polygon geom columns

Adds PostGIS extension and geometry(MultiPolygon, 4326) columns to
zone_boundaries and pon_boundaries, backfilled from existing geojson.
Foundation for archetype-aware geofence matching (Phase 1 spec
2026-05-08). JSONB geojson column retained; geom is additive.

Migration is not auto-run; requires Hein-approved after-hours window
per the spec's risk section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update qfield-import to populate geom on future imports

**Files:**
- Modify: `src/lib/qfield/gpkg-import-spatial.ts:111-202` (zone_boundaries + pon_boundaries inserts)
- Test: `src/lib/qfield/__tests__/gpkg-import-spatial-geom.test.ts` (new)

The existing INSERT for zone_boundaries (line ~129) is:

```sql
INSERT INTO zone_boundaries (project_id, zone_no, geojson)
SELECT * FROM UNNEST(${projectIds}::uuid[], ${zoneNos}::integer[], ${geojsons}::jsonb[])
ON CONFLICT (project_id, zone_no) DO UPDATE SET
  geojson = EXCLUDED.geojson
```

We add `geom` as a computed column on insert and update it on conflict.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/qfield/__tests__/gpkg-import-spatial-geom.test.ts
import { describe, it, expect } from 'vitest';
import { buildZoneBoundariesInsertSql } from '../gpkg-import-spatial';

describe('zone_boundaries INSERT includes geom', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON on the geojson column', () => {
    const sql = buildZoneBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO zone_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
    // Replace mode also has to update geom on conflict.
    expect(sql).toMatch(/geom\s*=\s*EXCLUDED\.geom|ON CONFLICT/);
  });
});
```

This test forces us to extract the SQL string into a pure exported helper so it can be inspected. That's a small refactor of `gpkg-import-spatial.ts` — extract the inline template literal into `buildZoneBoundariesInsertSql(mode: 'merge' | 'replace'): string` and call it from the existing function.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/qfield/__tests__/gpkg-import-spatial-geom.test.ts
```

Expected: FAIL — `buildZoneBoundariesInsertSql` is not exported.

- [ ] **Step 3: Refactor gpkg-import-spatial.ts to extract the SQL builder, and add geom**

Open `src/lib/qfield/gpkg-import-spatial.ts`. Find the zone_boundaries INSERT block (around line 125-145). Replace the inline template literal with calls to a new exported helper:

```typescript
export function buildZoneBoundariesInsertSql(mode: 'merge' | 'replace'): string {
  // Both modes use the same column list; replace mode runs after a DELETE,
  // so the ON CONFLICT path is only exercised in merge.
  const onConflict =
    mode === 'merge'
      ? `ON CONFLICT (project_id, zone_no) DO UPDATE SET
           geojson = EXCLUDED.geojson,
           geom    = EXCLUDED.geom`
      : '';
  return `
    INSERT INTO zone_boundaries (project_id, zone_no, geojson, geom)
    SELECT
      project_id,
      zone_no,
      geojson,
      ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)))
    FROM UNNEST($1::uuid[], $2::integer[], $3::jsonb[])
      AS t(project_id, zone_no, geojson)
    ${onConflict}
  `;
}
```

Then in the existing zone_boundaries function, replace the inline template literal with `await sql.query(buildZoneBoundariesInsertSql('merge'), [projectIds, zoneNos, geojsons])`. Do the same for the replace branch with `'replace'`.

Repeat for `pon_boundaries` — extract `buildPonBoundariesInsertSql(mode)` with the same shape but `(project_id, pon_no, zone_no, pon_label, geojson, geom)` columns and `ON CONFLICT (project_id, pon_no)`.

- [ ] **Step 4: Run zone test to verify it passes**

```bash
npx vitest run src/lib/qfield/__tests__/gpkg-import-spatial-geom.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add a parallel test for pon_boundaries**

```typescript
// append to gpkg-import-spatial-geom.test.ts
import { buildPonBoundariesInsertSql } from '../gpkg-import-spatial';

describe('pon_boundaries INSERT includes geom', () => {
  it('uses ST_Multi+ST_MakeValid+ST_SetSRID+ST_GeomFromGeoJSON', () => {
    const sql = buildPonBoundariesInsertSql('merge');
    expect(sql).toMatch(/INSERT INTO pon_boundaries.*\bgeom\b/s);
    expect(sql).toMatch(/ST_Multi\s*\(\s*ST_MakeValid\s*\(\s*ST_SetSRID\s*\(\s*ST_GeomFromGeoJSON/);
    expect(sql).toMatch(/4326/);
  });
});
```

- [ ] **Step 6: Run all tests in the qfield module**

```bash
npx vitest run src/lib/qfield/__tests__/
```

Expected: all pass — including any pre-existing tests in this folder.

- [ ] **Step 7: Commit**

```bash
git add src/lib/qfield/gpkg-import-spatial.ts src/lib/qfield/__tests__/gpkg-import-spatial-geom.test.ts
git commit -m "feat(qfield-import): populate geom on zone/pon boundary inserts

Future GPKG imports now write the PostGIS geometry alongside the
existing GeoJSON column, so post-migration imports stay aligned.
Extracts SQL into pure builders so the geom expression is unit-testable
without a live DB.

Part of Phase 1 archetype matching (spec 2026-05-08).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Proposed department-default archetype mapping (pure module)

**Files:**
- Create: `src/services/attendance/archetype/proposedDepartmentDefaults.ts`
- Test: `src/services/attendance/archetype/__tests__/proposedDepartmentDefaults.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/attendance/archetype/__tests__/proposedDepartmentDefaults.test.ts
import { describe, it, expect } from 'vitest';
import {
  proposedDepartmentDefault,
  PROPOSED_DEPARTMENT_DEFAULTS,
  type ArchetypeKind,
} from '../proposedDepartmentDefaults';

describe('proposedDepartmentDefault', () => {
  it('maps every department from the spec to a valid archetype', () => {
    const validKinds: ReadonlyArray<ArchetypeKind> = ['project', 'mobile', 'office'];
    for (const dept of [
      'Civil', 'Optical', 'field_operations',
      'NOC', 'Maintenance', 'Project Management',
      'Procurement', 'Commercial & Strategy', 'Planning', 'General',
    ]) {
      const a = proposedDepartmentDefault(dept);
      expect(validKinds).toContain(a);
    }
  });

  it('returns "office" as the safe fallback for unknown departments', () => {
    expect(proposedDepartmentDefault('Acquisitions')).toBe('office');
    expect(proposedDepartmentDefault(null)).toBe('office');
    expect(proposedDepartmentDefault('')).toBe('office');
  });

  it('matches the spec seed values exactly', () => {
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Civil']).toBe('project');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['NOC']).toBe('mobile');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Procurement']).toBe('office');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/attendance/archetype/__tests__/proposedDepartmentDefaults.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

```typescript
// src/services/attendance/archetype/proposedDepartmentDefaults.ts
/**
 * Hardcoded department → archetype mapping used by the Phase 1
 * geofence-patterns report. Mirrors the spec's proposed seed for
 * `department_archetype_defaults` (which doesn't exist as a table yet).
 *
 * Once Phase 1 has produced ≥5 working days of clock-in data and
 * `department_archetype_defaults` is seeded in Phase 2, this module
 * remains as the fallback when no DB seed row exists for a department.
 */

export type ArchetypeKind = 'project' | 'mobile' | 'office';

export const PROPOSED_DEPARTMENT_DEFAULTS: Readonly<Record<string, ArchetypeKind>> = {
  Civil: 'project',
  Optical: 'project',
  field_operations: 'project',
  NOC: 'mobile',
  Maintenance: 'mobile',
  'Project Management': 'mobile',
  Procurement: 'office',
  'Commercial & Strategy': 'office',
  Planning: 'office',
  General: 'office',
};

export function proposedDepartmentDefault(department: string | null | undefined): ArchetypeKind {
  if (!department) return 'office';
  return PROPOSED_DEPARTMENT_DEFAULTS[department] ?? 'office';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/services/attendance/archetype/__tests__/proposedDepartmentDefaults.test.ts
```

Expected: PASS, all three test cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/attendance/archetype/
git commit -m "feat(archetype): proposed department-default mapping

Hardcoded mapping used by the Phase 1 analysis report. Will become
the runtime fallback when Phase 2 seeds the
department_archetype_defaults table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: suggestArchetype — pure rule function

**Files:**
- Create: `src/services/attendance/archetype/suggestArchetype.ts`
- Test: `src/services/attendance/archetype/__tests__/suggestArchetype.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/attendance/archetype/__tests__/suggestArchetype.test.ts
import { describe, it, expect } from 'vitest';
import { suggestArchetype } from '../suggestArchetype';

describe('suggestArchetype', () => {
  it('returns project when ≥80% of clock-ins fall in a single project polygon', () => {
    const result = suggestArchetype({
      totalClockIns: 20,
      pctInsideAnyAssignedPolygon: 95,
      pctInsideOffice: 0,
      pctUnmatched: 5,
      maxSingleProjectPct: 90,
      distinctProjectPolygonsHit: 1,
      perProjectPct: { 'p-uuid': 90 },
    });
    expect(result).toEqual({ archetype: 'project', lowSignal: false });
  });

  it('returns mobile when ≥3 polygons each have >10% of clock-ins', () => {
    const result = suggestArchetype({
      totalClockIns: 30,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 40,
      distinctProjectPolygonsHit: 3,
      perProjectPct: { a: 40, b: 30, c: 30 },
    });
    expect(result).toEqual({ archetype: 'mobile', lowSignal: false });
  });

  it('returns office when ≥80% of clock-ins are within an office geofence', () => {
    const result = suggestArchetype({
      totalClockIns: 22,
      pctInsideAnyAssignedPolygon: 5,
      pctInsideOffice: 95,
      pctUnmatched: 0,
      maxSingleProjectPct: 5,
      distinctProjectPolygonsHit: 0,
      perProjectPct: {},
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: false });
  });

  it('returns office with lowSignal when fewer than 5 clock-ins', () => {
    const result = suggestArchetype({
      totalClockIns: 3,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 100,
      distinctProjectPolygonsHit: 1,
      perProjectPct: { a: 100 },
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: true });
  });

  it('returns office with lowSignal when no rule threshold is met', () => {
    const result = suggestArchetype({
      totalClockIns: 20,
      pctInsideAnyAssignedPolygon: 50,
      pctInsideOffice: 30,
      pctUnmatched: 20,
      maxSingleProjectPct: 50,
      distinctProjectPolygonsHit: 2,
      perProjectPct: { a: 30, b: 20 },
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: true });
  });

  it('first-match-wins: project rule beats mobile when both could match', () => {
    // Single dominant polygon at 85%, plus a few outliers at 5% each.
    // distinctProjectPolygonsHit=4 but only the 85% polygon clears 10%.
    const result = suggestArchetype({
      totalClockIns: 40,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 85,
      distinctProjectPolygonsHit: 4,
      perProjectPct: { a: 85, b: 5, c: 5, d: 5 },
    });
    expect(result).toEqual({ archetype: 'project', lowSignal: false });
  });

  it('first-match-wins: mobile rule beats office when both could match', () => {
    // 3 project polygons each >10%, plus office geofence at 0%.
    const result = suggestArchetype({
      totalClockIns: 25,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 40,
      distinctProjectPolygonsHit: 3,
      perProjectPct: { a: 40, b: 30, c: 30 },
    });
    expect(result).toEqual({ archetype: 'mobile', lowSignal: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/attendance/archetype/__tests__/suggestArchetype.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement suggestArchetype**

```typescript
// src/services/attendance/archetype/suggestArchetype.ts
/**
 * Deterministic archetype-suggestion rule from the Phase 1 spec
 * (2026-05-08). Pure function — no DB, no IO. Inputs are the per-staff
 * metrics computed by the geofence-patterns report runner.
 *
 * Rules are evaluated top-to-bottom; first match wins.
 *   1. project   — ≥80% of clock-ins inside a single project polygon
 *   2. mobile    — ≥3 distinct polygons hit, each with >10% of clock-ins
 *   3. office    — ≥80% of clock-ins within any office geofence
 *   4. office (low signal) — <5 clock-ins OR no rule met
 */

import type { ArchetypeKind } from './proposedDepartmentDefaults';

export interface ArchetypeMetrics {
  totalClockIns: number;
  pctInsideAnyAssignedPolygon: number;
  pctInsideOffice: number;
  pctUnmatched: number;
  /** Highest single-project share, 0..100. */
  maxSingleProjectPct: number;
  distinctProjectPolygonsHit: number;
  /** project_id → pct of clock-ins. Only populated for assigned projects. */
  perProjectPct: Record<string, number>;
}

export interface ArchetypeSuggestion {
  archetype: ArchetypeKind;
  lowSignal: boolean;
}

const MIN_SAMPLE = 5;
const PROJECT_PRIMARY_THRESHOLD = 80;
const OFFICE_THRESHOLD = 80;
const MOBILE_PER_POLYGON_THRESHOLD = 10;
const MOBILE_MIN_POLYGONS = 3;

export function suggestArchetype(m: ArchetypeMetrics): ArchetypeSuggestion {
  if (m.totalClockIns < MIN_SAMPLE) {
    return { archetype: 'office', lowSignal: true };
  }

  if (m.maxSingleProjectPct >= PROJECT_PRIMARY_THRESHOLD) {
    return { archetype: 'project', lowSignal: false };
  }

  const polygonsAboveThreshold = Object.values(m.perProjectPct).filter(
    (pct) => pct > MOBILE_PER_POLYGON_THRESHOLD,
  ).length;
  if (polygonsAboveThreshold >= MOBILE_MIN_POLYGONS) {
    return { archetype: 'mobile', lowSignal: false };
  }

  if (m.pctInsideOffice >= OFFICE_THRESHOLD) {
    return { archetype: 'office', lowSignal: false };
  }

  return { archetype: 'office', lowSignal: true };
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run src/services/attendance/archetype/__tests__/suggestArchetype.test.ts
```

Expected: PASS, all 7 test cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/attendance/archetype/suggestArchetype.ts src/services/attendance/archetype/__tests__/suggestArchetype.test.ts
git commit -m "feat(archetype): suggestArchetype deterministic rule function

Pure function implementing the first-match-wins rule ladder from the
Phase 1 spec. 7 unit tests cover every branch and ordering case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: geofencePatterns report runner

**Files:**
- Create: `src/services/attendance/reports/geofencePatterns.ts`
- Test: `src/services/attendance/reports/__tests__/geofencePatterns.sql.test.ts`

The runner queries `attendance_entries` joined to `staff`, `staff_projects`, `zone_boundaries`, and `fleet_authorized_locations`. It returns one row per active staff member with the metrics needed by `suggestArchetype` and the three data-gap flags.

- [ ] **Step 1: Write the failing SQL-shape test**

This test verifies that the SQL builder produces a query with the right CTEs, joins, and parameter count. It does NOT execute against a DB — pure string assertions, same approach as Task 2.

```typescript
// src/services/attendance/reports/__tests__/geofencePatterns.sql.test.ts
import { describe, it, expect } from 'vitest';
import { buildGeofencePatternsSql } from '../geofencePatterns';

describe('geofencePatterns SQL shape', () => {
  it('builds a CTE-based query referencing all required tables', () => {
    const { text } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: null,
    });

    // CTEs we expect
    expect(text).toMatch(/WITH\s+/);
    expect(text).toMatch(/clock_ins\s+AS/);
    expect(text).toMatch(/per_staff_polygon_hits\s+AS/);
    expect(text).toMatch(/per_staff_office_hits\s+AS/);

    // Tables involved
    expect(text).toMatch(/\battendance_entries\b/);
    expect(text).toMatch(/\bstaff\b/);
    expect(text).toMatch(/\bstaff_projects\b/);
    expect(text).toMatch(/\bzone_boundaries\b/);
    expect(text).toMatch(/\bfleet_authorized_locations\b/);

    // Geometry containment
    expect(text).toMatch(/ST_Contains\s*\(\s*zb\.geom/i);

    // Office filter
    expect(text).toMatch(/location_type\s*=\s*'office'/);

    // Active assignments only
    expect(text).toMatch(/sp\.is_active\s*=\s*true/);
  });

  it('parameterises departments and date range', () => {
    const { text, params } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: ['Civil', 'Optical'],
      scopedStaffIds: null,
    });
    expect(params).toContain('2026-04-08');
    expect(params).toContain('2026-05-08');
    expect(params.some((p) => Array.isArray(p) && (p as string[]).includes('Civil'))).toBe(true);
    // Department filter is in the SQL as ANY(...::text[])
    expect(text).toMatch(/s\.department\s*=\s*ANY\s*\(\s*\$\d+::text\[\]\s*\)/);
  });

  it('omits the department filter when none are supplied', () => {
    const { text } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: null,
    });
    expect(text).not.toMatch(/s\.department\s*=\s*ANY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/attendance/reports/__tests__/geofencePatterns.sql.test.ts
```

Expected: FAIL — `buildGeofencePatternsSql` not exported.

- [ ] **Step 3: Implement the runner with the SQL builder extracted**

> **SUPERSEDED — see the shipped implementation, not this draft.**
> The TypeScript / SQL block below is the original draft from plan
> authoring. It has known issues (`per_project_pct_json` column name was
> renamed to `per_project_hits_json` and percentage math was moved
> client-side; `COUNT(*) OVER ()` divides by project-hit rows rather than
> total clock-ins). The merged code at
> `src/services/attendance/reports/geofencePatterns.ts` is the source of
> truth — copy from there, not from this draft.

```typescript
// src/services/attendance/reports/geofencePatterns.ts
/**
 * geofence-patterns report (Phase 1 spec 2026-05-08).
 *
 * One row per active staff member. Each row carries:
 *   - clock-in volume in the date range
 *   - % inside any active staff_projects polygon (zone_boundaries.geom)
 *   - % inside an office geofence (fleet_authorized_locations type='office')
 *   - % unmatched
 *   - distinct project polygons hit + per-project share
 *   - suggested archetype (from suggestArchetype)
 *   - proposed department-default archetype (from proposedDepartmentDefaults)
 *   - mismatch flag + the three data-gap flags from the spec
 *
 * Read-only; no writes anywhere.
 */

import { sql } from '@/lib/db-pool';
import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';
import { suggestArchetype, type ArchetypeMetrics } from '../archetype/suggestArchetype';
import {
  proposedDepartmentDefault,
  type ArchetypeKind,
} from '../archetype/proposedDepartmentDefaults';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'staff', label: 'Staff' },
  { key: 'department', label: 'Dept' },
  { key: 'total_clock_ins', label: 'Clock-ins', align: 'right', format: 'integer' },
  { key: 'pct_inside_any_assigned', label: '% inside assigned polygon', align: 'right', format: 'number' },
  { key: 'pct_inside_office', label: '% inside office', align: 'right', format: 'number' },
  { key: 'pct_unmatched', label: '% unmatched', align: 'right', format: 'number' },
  { key: 'distinct_polygons_hit', label: '# polygons hit', align: 'right', format: 'integer' },
  { key: 'max_single_project_pct', label: 'Top polygon %', align: 'right', format: 'number' },
  { key: 'suggested_archetype', label: 'Suggested archetype' },
  { key: 'proposed_default_archetype', label: 'Dept default (proposed)' },
  { key: 'mismatch', label: 'Mismatch?' },
  { key: 'low_signal', label: 'Low signal?' },
  { key: 'data_gap_no_assignments', label: 'Project staff w/o assignments?' },
  { key: 'data_gap_no_home_site', label: 'Office staff w/o home_site_id?' },
];

interface InputArgs {
  dateFrom: string;
  dateTo: string;
  departments: string[];
  scopedStaffIds: string[] | null;
}

interface DbRow {
  staff_id: string;
  full_name: string;
  department: string | null;
  home_site_id: string | null;
  active_assignment_count: number;
  total_clock_ins: number;
  inside_any_assigned: number;
  inside_office: number;
  unmatched: number;
  distinct_polygons_hit: number;
  max_single_project_pct: number;
  per_project_pct_json: string; // JSONB stringified by pg
}

/**
 * Pure SQL builder. Returns `{ text, params }` so the unit test can
 * assert structure without hitting a DB.
 */
export function buildGeofencePatternsSql(args: InputArgs): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const next = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };

  const dateFromP = next(args.dateFrom);
  const dateToP = next(args.dateTo);

  const deptClause =
    args.departments.length > 0
      ? `AND s.department = ANY(${next(args.departments)}::text[])`
      : '';
  const staffScopeClause =
    args.scopedStaffIds !== null
      ? `AND s.id = ANY(${next(args.scopedStaffIds)}::uuid[])`
      : '';

  const text = `
    WITH clock_ins AS (
      SELECT
        ae.id,
        ae.staff_id,
        ae.clock_in_lat,
        ae.clock_in_lon,
        ST_SetSRID(ST_MakePoint(ae.clock_in_lon::float8, ae.clock_in_lat::float8), 4326) AS pt
      FROM attendance_entries ae
      WHERE ae.work_date >= ${dateFromP}::date
        AND ae.work_date <= ${dateToP}::date
        AND ae.clock_in_lat IS NOT NULL
        AND ae.clock_in_lon IS NOT NULL
    ),
    per_staff_polygon_hits AS (
      SELECT
        ci.staff_id,
        ci.id AS clock_in_id,
        sp.project_id,
        TRUE AS hit
      FROM clock_ins ci
      JOIN staff_projects sp ON sp.staff_id = ci.staff_id AND sp.is_active = true
      JOIN zone_boundaries zb ON zb.project_id = sp.project_id AND zb.geom IS NOT NULL
      WHERE ST_Contains(zb.geom, ci.pt)
    ),
    per_staff_office_hits AS (
      SELECT DISTINCT ci.id AS clock_in_id, ci.staff_id
      FROM clock_ins ci
      JOIN fleet_authorized_locations fal
        ON fal.is_active = true
       AND fal.location_type = 'office'
       AND ST_DWithin(
             ST_SetSRID(ST_MakePoint(fal.lon::float8, fal.lat::float8), 4326)::geography,
             ci.pt::geography,
             COALESCE(fal.radius_km, 1.0) * 1000
           )
    ),
    per_staff_clock_in_first_match AS (
      -- One row per clock_in: the project_id of the FIRST polygon match (any),
      -- or NULL if it didn't fall in any assigned polygon.
      SELECT
        ci.id AS clock_in_id,
        ci.staff_id,
        (
          SELECT psh.project_id
            FROM per_staff_polygon_hits psh
           WHERE psh.clock_in_id = ci.id
           LIMIT 1
        ) AS matched_project_id,
        EXISTS (SELECT 1 FROM per_staff_office_hits psoh WHERE psoh.clock_in_id = ci.id) AS hit_office
      FROM clock_ins ci
    ),
    per_project_counts AS (
      SELECT staff_id, matched_project_id, COUNT(*) AS hits
        FROM per_staff_clock_in_first_match
       WHERE matched_project_id IS NOT NULL
       GROUP BY staff_id, matched_project_id
    ),
    per_staff_aggregates AS (
      SELECT
        m.staff_id,
        COUNT(*)                                                    AS total_clock_ins,
        COUNT(*) FILTER (WHERE m.matched_project_id IS NOT NULL)    AS inside_any_assigned,
        COUNT(*) FILTER (WHERE m.hit_office)                        AS inside_office,
        COUNT(*) FILTER (
          WHERE m.matched_project_id IS NULL AND NOT m.hit_office
        )                                                            AS unmatched,
        COUNT(DISTINCT m.matched_project_id)
          FILTER (WHERE m.matched_project_id IS NOT NULL)            AS distinct_polygons_hit,
        COALESCE(
          (
            SELECT MAX(hits) * 100.0 / NULLIF(COUNT(*) OVER (), 0)
              FROM per_project_counts ppc
             WHERE ppc.staff_id = m.staff_id
          ), 0
        )                                                            AS max_single_project_pct,
        COALESCE(
          (
            SELECT jsonb_object_agg(
                     ppc.matched_project_id::text,
                     ROUND((ppc.hits::numeric * 100.0) / NULLIF(COUNT(*) OVER (), 0), 2)
                   )
              FROM per_project_counts ppc
             WHERE ppc.staff_id = m.staff_id
          ),
          '{}'::jsonb
        )                                                            AS per_project_pct_json
      FROM per_staff_clock_in_first_match m
      GROUP BY m.staff_id
    )
    SELECT
      s.id::text                                              AS staff_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department,
      s.home_site_id::text                                    AS home_site_id,
      (
        SELECT COUNT(*) FROM staff_projects sp
         WHERE sp.staff_id = s.id AND sp.is_active = true
      )::int                                                  AS active_assignment_count,
      COALESCE(psa.total_clock_ins, 0)::int                   AS total_clock_ins,
      COALESCE(psa.inside_any_assigned, 0)::int               AS inside_any_assigned,
      COALESCE(psa.inside_office, 0)::int                     AS inside_office,
      COALESCE(psa.unmatched, 0)::int                         AS unmatched,
      COALESCE(psa.distinct_polygons_hit, 0)::int             AS distinct_polygons_hit,
      COALESCE(psa.max_single_project_pct, 0)::float          AS max_single_project_pct,
      COALESCE(psa.per_project_pct_json, '{}'::jsonb)         AS per_project_pct_json
    FROM staff s
    LEFT JOIN per_staff_aggregates psa ON psa.staff_id = s.id
    WHERE s.status = 'active'
      ${deptClause}
      ${staffScopeClause}
    ORDER BY full_name ASC
    LIMIT ${next(REPORT_ROW_CAP + 1)}
  `;

  return { text, params };
}

export async function runGeofencePatterns(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
  }

  const { text, params } = buildGeofencePatternsSql({
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    departments: input.departments,
    scopedStaffIds: input.scopedStaffIds,
  });

  const rows = await sql.query<DbRow>(text, params);
  if (rows.length > REPORT_ROW_CAP) {
    throw new ReportTooLargeError(rows.length);
  }

  const enriched = rows.map((r) => {
    const total = r.total_clock_ins ?? 0;
    const pctInsideAnyAssignedPolygon = total > 0 ? (r.inside_any_assigned * 100) / total : 0;
    const pctInsideOffice = total > 0 ? (r.inside_office * 100) / total : 0;
    const pctUnmatched = total > 0 ? (r.unmatched * 100) / total : 0;

    const perProjectPct: Record<string, number> = (() => {
      const v = r.per_project_pct_json;
      if (typeof v === 'string') return JSON.parse(v) as Record<string, number>;
      // pg may auto-parse jsonb to an object depending on driver config.
      return (v as unknown as Record<string, number>) ?? {};
    })();

    const metrics: ArchetypeMetrics = {
      totalClockIns: total,
      pctInsideAnyAssignedPolygon,
      pctInsideOffice,
      pctUnmatched,
      maxSingleProjectPct: r.max_single_project_pct,
      distinctProjectPolygonsHit: r.distinct_polygons_hit,
      perProjectPct,
    };
    const { archetype: suggested, lowSignal } = suggestArchetype(metrics);
    const proposed: ArchetypeKind = proposedDepartmentDefault(r.department);
    const mismatch = suggested !== proposed;
    const dataGapNoAssignments = suggested === 'project' && r.active_assignment_count === 0;
    const dataGapNoHomeSite = suggested === 'office' && r.home_site_id === null;

    return {
      staff: r.full_name,
      department: r.department ?? '',
      total_clock_ins: total,
      pct_inside_any_assigned: roundPct(pctInsideAnyAssignedPolygon),
      pct_inside_office: roundPct(pctInsideOffice),
      pct_unmatched: roundPct(pctUnmatched),
      distinct_polygons_hit: r.distinct_polygons_hit,
      max_single_project_pct: roundPct(r.max_single_project_pct),
      suggested_archetype: suggested,
      proposed_default_archetype: proposed,
      mismatch: mismatch ? 'yes' : 'no',
      low_signal: lowSignal ? 'yes' : 'no',
      data_gap_no_assignments: dataGapNoAssignments ? 'yes' : 'no',
      data_gap_no_home_site: dataGapNoHomeSite ? 'yes' : 'no',
    };
  });

  return { rows: enriched, columns: COLUMNS, notes: [] };
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}
```

- [ ] **Step 4: Run SQL-shape tests to verify they pass**

```bash
npx vitest run src/services/attendance/reports/__tests__/geofencePatterns.sql.test.ts
```

Expected: PASS, all 3 cases.

- [ ] **Step 5: Add an enrichment-logic test that mocks the DB**

```typescript
// append to the same test file or new geofencePatterns.enrich.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db-pool', () => ({
  sql: {
    query: vi.fn(),
  },
}));

import { sql } from '@/lib/db-pool';
import { runGeofencePatterns } from '../geofencePatterns';

describe('runGeofencePatterns enrichment', () => {
  it('flags data_gap_no_assignments for a project-suggested staffer with no assignments', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'a', full_name: 'Alice A', department: 'Civil', home_site_id: null,
        active_assignment_count: 0,
        total_clock_ins: 20,
        inside_any_assigned: 19,
        inside_office: 0,
        unmatched: 1,
        distinct_polygons_hit: 1,
        max_single_project_pct: 95,
        per_project_pct_json: '{"p1":95}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'project',
      data_gap_no_assignments: 'yes',
    });
  });

  it('flags data_gap_no_home_site for an office-suggested staffer with NULL home_site_id', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'b', full_name: 'Bob B', department: 'Procurement', home_site_id: null,
        active_assignment_count: 0,
        total_clock_ins: 22,
        inside_any_assigned: 0,
        inside_office: 21,
        unmatched: 1,
        distinct_polygons_hit: 0,
        max_single_project_pct: 0,
        per_project_pct_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'office',
      data_gap_no_home_site: 'yes',
    });
  });

  it('marks low_signal=yes when fewer than 5 clock-ins', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'c', full_name: 'Carla C', department: 'General', home_site_id: 'site-1',
        active_assignment_count: 0,
        total_clock_ins: 3, inside_any_assigned: 0, inside_office: 3, unmatched: 0,
        distinct_polygons_hit: 0, max_single_project_pct: 0,
        per_project_pct_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
    expect(result.rows[0]).toMatchObject({ low_signal: 'yes' });
  });
});
```

- [ ] **Step 6: Run all tests in the reports folder**

```bash
npx vitest run src/services/attendance/reports/__tests__/
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/attendance/reports/geofencePatterns.ts src/services/attendance/reports/__tests__/geofencePatterns*.test.ts
git commit -m "feat(reports): geofence-patterns analysis runner

Read-only Phase 1 report for archetype matching: per-staff metrics
(% inside assigned polygons, % inside offices, distinct polygons
hit) plus the suggested-archetype rule and three data-gap flags.

Pure SQL builder is unit-tested for shape; enrichment logic is
unit-tested with a mocked DB; data-gap flags are covered explicitly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire the new slug into the catalogue + dispatcher

**Files:**
- Modify: `src/services/attendance/reports/types.ts:13-28, 53-115`
- Modify: `src/services/attendance/reports/runner.ts` (the dispatch table near the bottom)

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/attendance/reports/__tests__/catalogueWiring.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_REPORT_SLUGS, REPORT_CATALOGUE } from '../types';
import { isReportSlug } from '../runner';

describe('geofence-patterns slug is wired', () => {
  it('appears in ALL_REPORT_SLUGS', () => {
    expect(ALL_REPORT_SLUGS).toContain('geofence-patterns');
  });

  it('appears in REPORT_CATALOGUE with date_range + departments_text inputs', () => {
    const def = REPORT_CATALOGUE.find((r) => r.slug === 'geofence-patterns');
    expect(def).toBeDefined();
    expect(def!.title).toMatch(/archetype|pattern/i);
    const inputKinds = def!.inputs.map((i) => i.kind);
    expect(inputKinds).toContain('date_range');
    expect(inputKinds).toContain('departments_text');
  });

  it('isReportSlug recognises the new slug', () => {
    expect(isReportSlug('geofence-patterns')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/attendance/reports/__tests__/catalogueWiring.test.ts
```

Expected: FAIL — slug not in catalogue.

- [ ] **Step 3: Add the slug to types.ts**

In `src/services/attendance/reports/types.ts`:

Update the `ReportSlug` union (around line 13):

```typescript
export type ReportSlug =
  | 'monthly-totals'
  | 'geo-mismatch'
  | 'geofence-patterns'
  | 'ot-trend'
  | 'dept-rollup'
  | 'wage-cost'
  | 'bcea-premium';
```

Update `ALL_REPORT_SLUGS` (around line 21):

```typescript
export const ALL_REPORT_SLUGS: ReadonlyArray<ReportSlug> = [
  'monthly-totals',
  'geo-mismatch',
  'geofence-patterns',
  'ot-trend',
  'dept-rollup',
  'wage-cost',
  'bcea-premium',
];
```

Add the catalogue entry — insert after the `geo-mismatch` entry (around line 73):

```typescript
  {
    slug: 'geofence-patterns',
    title: 'Geofence archetype patterns',
    blurb: 'Per-staff clock-in patterns: project / mobile / office archetype + data gaps.',
    inputs: [
      { kind: 'date_range', defaultPreset: 'last_30d' },
      { kind: 'departments_text' },
    ],
  },
```

- [ ] **Step 4: Wire the runner in runner.ts**

In `src/services/attendance/reports/runner.ts`:

Add the import near the other runner imports (around line 30-31):

```typescript
import { runGeofencePatterns } from './geofencePatterns';
```

Add the dispatch entry — find the dispatch object (around line 215) and insert:

```typescript
  'geofence-patterns': runGeofencePatterns,
```

next to `'geo-mismatch':   runGeoMismatch,`. Match the existing two-space alignment.

- [ ] **Step 5: Run the wiring test to verify it passes**

```bash
npx vitest run src/services/attendance/reports/__tests__/catalogueWiring.test.ts
```

Expected: PASS, all 3 cases.

- [ ] **Step 6: Run the full reports test suite**

```bash
npx vitest run src/services/attendance/reports/__tests__/
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/attendance/reports/types.ts src/services/attendance/reports/runner.ts src/services/attendance/reports/__tests__/catalogueWiring.test.ts
git commit -m "feat(reports): wire geofence-patterns slug into catalogue

Slug appears in ReportSlug union, ALL_REPORT_SLUGS, REPORT_CATALOGUE
(date_range + departments_text inputs), and the runner dispatch.
Frontend [slug].tsx renders it automatically — no UI code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Browser smoke test against dev DB

**Files:** none changed — pure verification step.

This is a manual smoke test. Do not skip it. Type-check + unit tests do not validate the SQL against a real PostGIS DB; this step does.

**Pre-requisite:** Migration 245 has been run on the dev DB by Hein (or someone with prod-write access). If not yet, this task must wait — flag in the PR that browser verification is pending.

- [ ] **Step 1: Confirm migration ran on dev**

```bash
PGPASSWORD='<from .claude/credentials.local.md>' \
psql -h 100.96.203.105 -p 5437 -U <user> -d fibreflow -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname='postgis';
   SELECT COUNT(*) FROM zone_boundaries WHERE geom IS NOT NULL;
   SELECT COUNT(*) FROM zone_boundaries WHERE geom IS NULL AND geojson IS NOT NULL;"
```

Expected: PostGIS row present; geom backfilled count > 0; null-geom count = 0 (or only the rows that the migration's NOTICE flagged as bad).

- [ ] **Step 2: Start dev server in worktree**

```bash
cd /home/hein/Workspace/FF_Next.js-geofence-archetype
PORT=3004 npm run dev
```

Wait for the server to print `ready - started server on 0.0.0.0:3004`.

- [ ] **Step 3: Open the report in a browser**

Navigate to `http://localhost:3004/staff/attendance/reports/geofence-patterns`.

- [ ] **Step 4: Run the report with the default date range (last 30 days)**

Click **Run report**. Expected:
- Table renders with 14 columns (Staff, Dept, Clock-ins, % inside assigned polygon, % inside office, % unmatched, # polygons hit, Top polygon %, Suggested archetype, Dept default (proposed), Mismatch?, Low signal?, Project staff w/o assignments?, Office staff w/o home_site_id?).
- One row per active staff member.
- Rows with no clock-ins in the window show 0/0 metrics and `low_signal: yes`.
- Civil/Optical staff inside Lawley/Mohadin polygons show `suggested_archetype: project` and `mismatch: no`.
- Procurement / Commercial & Strategy staff show `suggested_archetype: office` (or `low_signal: yes` if WFH and no office geofence exists yet).

- [ ] **Step 5: Spot-check one likely-misclassified row**

Sort by `Mismatch?` descending. Pick one staffer with `mismatch=yes`. Cross-check by hand: open `https://www.google.com/maps?q=<their_lat>,<their_lon>` for one of their recent clock-ins and confirm whether they're inside an assigned project polygon. Note the result in the PR description — this is the qualitative validation that the analysis is meaningful.

- [ ] **Step 6: Test department filter**

In the form, enter `Civil, Optical` in Departments and re-run. Expected: only Civil + Optical staff in results.

- [ ] **Step 7: Test XLSX export**

Click XLSX. Expected: file downloads, opens cleanly, has the same 14 columns.

- [ ] **Step 8: Take a screenshot for the PR**

Save a screenshot of the rendered report (with department filter applied) to `/tmp/geofence-patterns-report.png`. We'll attach it to the PR description.

- [ ] **Step 9: Stop the dev server**

`Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 10: No commit needed for this step**

This task has no code changes. Move to Task 8.

---

### Task 8: Local CI gate

**Files:** none — verification only.

- [ ] **Step 1: Run typecheck**

```bash
cd /home/hein/Workspace/FF_Next.js-geofence-archetype
npm run typecheck 2>&1 | tail -30
```

Expected: 0 errors. If errors appear in code we touched, fix them before continuing. Do **not** ignore "errors in unrelated files" without investigating — the lint ratchet will catch regressions.

- [ ] **Step 2: Run the lint ratchet**

```bash
npm run ci:quick 2>&1 | tail -30
```

Expected: pass at or below the current baseline (per CLAUDE.md: ~77 errors / ~1833 warnings / 94 catches). If our changes introduce a regression, fix them — do **not** lower the ratchet, do **not** `--no-verify`.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all pre-existing tests pass plus our new tests pass.

- [ ] **Step 4: Run antihall to check referenced symbols exist**

```bash
npm run antihall 2>&1 | tail -10
```

Expected: pass.

---

### Task 9: Open the pull request

**Files:** none — git/gh only.

- [ ] **Step 1: Push the branch**

```bash
cd /home/hein/Workspace/FF_Next.js-geofence-archetype
git push -u origin spec/geofence-archetype-matching
```

- [ ] **Step 2: Open the PR via gh CLI**

```bash
gh pr create --base master --head spec/geofence-archetype-matching \
  --title "feat: geofence archetype patterns report (Phase 1)" \
  --body "$(cat <<'EOF'
## Summary

Phase 1 of archetype-aware geofence matching (spec
\`docs/superpowers/specs/2026-05-08-geofence-archetype-matching-design.md\`).
Read-only — no clock-in behaviour changes. Adds:

- Migration 245 — PostGIS extension + \`geom\` column on \`zone_boundaries\`
  and \`pon_boundaries\`, backfilled from existing GeoJSON. **Not auto-run;
  requires Hein-approved after-hours window.**
- \`gpkg-import-spatial.ts\` updated to populate \`geom\` on future imports.
- Two pure helper modules: \`proposedDepartmentDefaults\`, \`suggestArchetype\`
  (each unit-tested).
- New report runner \`geofencePatterns.ts\` + slug \`geofence-patterns\` in
  the existing report catalogue. Frontend renders automatically via
  \`pages/staff/attendance/reports/[slug].tsx\` — no UI code changes.

## What this enables

We can now look at \`/staff/attendance/reports/geofence-patterns\` to see
each staffer's actual clock-in pattern (% inside assigned polygons,
inside an office, unmatched, distinct polygons hit) plus the suggested
archetype, the proposed department default, and three data-gap flags.
After ≥5 working days of observed data we can lock the
\`department_archetype_defaults\` seed values and start Phase 2 (the
matcher rewrite and \`staff.archetype\` column).

## Out of scope (Phase 2)

- \`staff.archetype\` column, \`department_archetype_defaults\` table
- \`attendance_entries\` enrichment columns
- Clock-in matcher rewrite
- Geo-mismatch report changes
- Admin UI

## Test plan

- [ ] Migration 245 runs cleanly on dev (PostGIS extension installed,
      geom backfilled, no NULLs except known-bad rows).
- [ ] \`/staff/attendance/reports/geofence-patterns\` renders with default
      \`last_30d\` range.
- [ ] One \`mismatch=yes\` row hand-verified against Google Maps as
      genuinely misclassified or genuinely outside its assigned polygon.
- [ ] Department filter narrows results.
- [ ] XLSX export produces a valid file with all 14 columns.
- [ ] \`npm run ci:quick\` passes at or below the baseline.
- [ ] All vitest suites pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Note the PR URL**

The command prints the PR URL on success. Paste it into the chat for visibility. Do **not** merge — per the project's standing rule, all PRs go through `/review` (blind reviewer) before merge, and migration 245 has to be applied to dev first.

---

## Self-review

**Spec coverage check:**

- Phase 1 / per-staff row metrics — Task 5 (geofencePatterns.ts) ✓
- Phase 1 / suggested-archetype rule (4 branches, first-match-wins) — Task 4 ✓
- Phase 1 / 3 callout tables — encoded as flag columns (`mismatch`, `data_gap_no_assignments`, `data_gap_no_home_site`) so the existing single-table report renderer handles them; user filters/sorts to see each subset. Acceptable trade-off documented in File Structure section. ✓
- PostGIS migration + backfill (Migration A) — Task 1 ✓
- qfield-import populates geom (spec, end of Migration A section) — Task 2 ✓
- Phase 1 only depends on existing tables (spec's "Resolved decisions" section) — confirmed: the report doesn't read `staff.archetype` or `department_archetype_defaults`. ✓
- Hardcoded proposed mapping (spec's Phase 1 row table) — Task 3 ✓
- No frontend changes (spec implies, plan confirms by reading [slug].tsx) — confirmed. ✓
- Phase 2 deferred (not in this plan) — explicitly stated under "Out of scope". ✓

**Placeholder scan:** No "TBD"/"TODO"/"appropriate error handling" patterns. Every code step has runnable code.

**Type consistency:**
- `ArchetypeKind` defined in Task 3, reused in Task 4 (`suggestArchetype`) and Task 5 (`runGeofencePatterns`). Match.
- `ArchetypeMetrics` defined in Task 4, consumed in Task 5. Field names in the SQL match field names in the metrics interface. Match.
- `buildZoneBoundariesInsertSql` / `buildPonBoundariesInsertSql` referenced in Task 2 test and implementation. Match.
- `buildGeofencePatternsSql` referenced in Task 5 test and implementation. Match.
- `runGeofencePatterns` exported from Task 5, imported in Task 6. Match.

**Scope check:** Single bounded plan, focused on Phase 1 only. Phase 2 is explicitly deferred and gets its own plan.
