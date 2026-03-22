/**
 * Pure transformation helpers for drop rows.
 * No DB access — safe to import anywhere, including tests.
 */

import { UnifiedDrop } from './types';

// 🟢 WORKING: Steps 01-10 must all be true for a complete drop
export function isDropComplete(drop: Record<string, unknown>): boolean {
  return !!(
    drop.step_01_house_photo &&
    drop.step_02_cable_from_pole &&
    drop.step_03_entry_outside &&
    drop.step_04_entry_inside &&
    drop.step_05_wall &&
    drop.step_06_ont_back &&
    drop.step_07_power_meter &&
    drop.step_08_final_installation &&
    drop.step_09_green_lights &&
    drop.step_10_signature
  );
}

/** Returns the count of photo steps that have been completed (0–10). */
export function countCompletedSteps(drop: Record<string, unknown>): number {
  let count = 0;
  if (drop.step_01_house_photo) count++;
  if (drop.step_02_cable_from_pole) count++;
  if (drop.step_03_entry_outside) count++;
  if (drop.step_04_entry_inside) count++;
  if (drop.step_05_wall) count++;
  if (drop.step_06_ont_back) count++;
  if (drop.step_07_power_meter) count++;
  if (drop.step_08_final_installation) count++;
  if (drop.step_09_green_lights) count++;
  if (drop.step_10_signature) count++;
  return count;
}

/**
 * Applies computed fields (is_complete, steps_completed, etc.) to a raw DB row.
 * Used by both paginated list and single-drop fetchers.
 */
export function transformDropRow(row: Record<string, unknown>): UnifiedDrop {
  return {
    ...(row as unknown as UnifiedDrop),
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
    submission_count: (row.submission_count as number) || 1,
    is_resubmission: (row.is_resubmission as boolean) || false,
    previous_photo_count: (row.previous_photo_count as number | null) ?? null,
  };
}
