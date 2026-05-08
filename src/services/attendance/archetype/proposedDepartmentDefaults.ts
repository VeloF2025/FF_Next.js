/**
 * Hardcoded department -> archetype mapping used by the Phase 1
 * geofence-patterns report. Mirrors the spec's proposed seed for
 * `department_archetype_defaults` (which doesn't exist as a table yet).
 *
 * Once Phase 1 has produced >=5 working days of clock-in data and
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

/**
 * Returns the proposed archetype for a department name.
 *
 * Falls back to 'office' for unknown, empty, or null department values — the
 * safest assumption when we have no location signal.
 */
export function proposedDepartmentDefault(department: string | null | undefined): ArchetypeKind {
  if (!department) return 'office';
  return PROPOSED_DEPARTMENT_DEFAULTS[department] ?? 'office';
}
