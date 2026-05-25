/**
 * Per-warehouse / per-project serial-holding summaries — read-only roll-ups
 * powering the field-stock drill-down list pages (Wave 2 PR-12 / PR-13).
 * Each row is one entity that currently holds at least one serial, with the
 * count of serials it holds.
 */

export interface WarehouseHolding {
  /** stock_locations.id */
  id: string;
  name: string;
  code: string | null;
  locationType: string | null;
  serialCount: number;
}

export interface ProjectHolding {
  /** projects.id */
  id: string;
  projectName: string;
  serialCount: number;
}
