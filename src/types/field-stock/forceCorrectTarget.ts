/**
 * Full set of status values the live stock_serials.status CHECK constraint accepts.
 * Force-correct intentionally allows ALL of them, including the 3 that the
 * 8-value SerialStatusValue / transition.ts state machine omits
 * (allocated_to_project, activated, in_repair) — "bypass the state machine"
 * is the whole point of this feature.
 */
export type ForceCorrectStatus =
  | 'available'
  | 'reserved'
  | 'allocated_to_project'
  | 'in_transit'
  | 'issued'
  | 'installed'
  | 'activated'
  | 'faulty'
  | 'in_repair'
  | 'returned'
  | 'scrapped';

/**
 * Force-correct target fields. All optional; omit = leave column unchanged.
 * `null` = explicitly set the column to NULL (e.g., clear a wrongly-set drop number).
 * At least one field must be present (enforced at the API boundary).
 *
 * The 5 columns map 1:1 to live stock_serials columns confirmed 2026-05-22:
 *   status, current_location_id, allocated_to_project_id,
 *   installed_at_drop_number, activated_at_olt_id.
 * There is no current_warehouse_id column on stock_serials.
 */
export interface ForceCorrectTarget {
  status?: ForceCorrectStatus;
  currentLocationId?: string | null;
  allocatedToProjectId?: string | null;
  installedAtDropNumber?: string | null;
  activatedAtOltId?: string | null;
}

/**
 * Snapshot of correctable stock_serials columns observed at a point in time.
 * Used by ForceCorrectRowResult.before / after to record what changed and what
 * the new state is. Distinct from ForceCorrectTarget (write intent) so callers
 * cannot accidentally pass a write-intent object where an observed-state snapshot
 * is expected. Sparse by design — only fields that actually changed appear.
 */
export interface ForceCorrectSnapshot {
  status?: ForceCorrectStatus;
  currentLocationId?: string | null;
  allocatedToProjectId?: string | null;
  installedAtDropNumber?: string | null;
  activatedAtOltId?: string | null;
}
