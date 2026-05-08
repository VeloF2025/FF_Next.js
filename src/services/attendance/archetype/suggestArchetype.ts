/**
 * Deterministic archetype-suggestion rule from the Phase 1 spec
 * (2026-05-08). Pure function — no DB, no IO. Inputs are the per-staff
 * metrics computed by the geofence-patterns report runner.
 *
 * Rules are evaluated top-to-bottom; first match wins.
 *   1. project   — >=80% of clock-ins inside a single project polygon
 *   2. mobile    — >=3 distinct polygons hit, each with >10% of clock-ins
 *   3. office    — >=80% of clock-ins within any office geofence
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
  /** project_id -> pct of clock-ins. Only populated for assigned projects. */
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

/**
 * Suggests an archetype for a staff member based on their geofence metrics.
 *
 * Applies a deterministic first-match-wins rule ladder:
 *   1. Project — one polygon dominates (>=80% of clock-ins)
 *   2. Mobile  — spread across >=3 polygons each with >10% of clock-ins
 *   3. Office  — >=80% of clock-ins inside an office geofence
 *   4. Fallback — office with lowSignal=true (insufficient data or no match)
 */
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
