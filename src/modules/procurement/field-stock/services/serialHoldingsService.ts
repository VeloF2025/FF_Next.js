/**
 * Serial holdings — read-only roll-ups for the field-stock drill-down pages
 * (Wave 2 PR-12 / PR-13).
 *
 * Sibling to serialSearchService.ts. Where that file answers "which serials
 * match these filters", this one answers "which warehouses / projects
 * currently hold serials, and how many". The per-entity serial lists
 * themselves are served by serialSearchService via the warehouseId /
 * projectId filters — these functions only feed the landing list pages and
 * resolve a single entity name for the drill-down sticky header.
 *
 * Column references mirror the live searchSerials() query:
 *   stock_serials.current_location_id  → stock_locations(id, name, code, location_type)
 *   stock_serials.allocated_to_project_id → projects(id, project_name)
 */
import { pool } from '@/lib/db-pool';
import type { WarehouseHolding, ProjectHolding } from '@/types/field-stock';

/** Safety cap — distinct holding entities are small (tens-to-low-hundreds). */
const MAX_ROWS = 500;

export async function listWarehousesWithSerials(): Promise<WarehouseHolding[]> {
  const res = await pool.query<{
    id: string;
    name: string;
    code: string | null;
    location_type: string | null;
    serial_count: string;
  }>(
    `
    SELECT
      sl.id,
      sl.name,
      sl.code,
      sl.location_type,
      COUNT(ss.id)::text AS serial_count
    FROM stock_serials ss
    JOIN stock_locations sl ON sl.id = ss.current_location_id
    GROUP BY sl.id, sl.name, sl.code, sl.location_type
    ORDER BY COUNT(ss.id) DESC, sl.name ASC
    LIMIT $1
    `,
    [MAX_ROWS]
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    locationType: r.location_type,
    serialCount: parseInt(r.serial_count, 10),
  }));
}

export async function listProjectsWithSerials(): Promise<ProjectHolding[]> {
  const res = await pool.query<{
    id: string;
    project_name: string;
    serial_count: string;
  }>(
    `
    SELECT
      p.id,
      p.project_name,
      COUNT(ss.id)::text AS serial_count
    FROM stock_serials ss
    JOIN projects p ON p.id = ss.allocated_to_project_id
    GROUP BY p.id, p.project_name
    ORDER BY COUNT(ss.id) DESC, p.project_name ASC
    LIMIT $1
    `,
    [MAX_ROWS]
  );
  return res.rows.map((r) => ({
    id: r.id,
    projectName: r.project_name,
    serialCount: parseInt(r.serial_count, 10),
  }));
}

/** Resolve a single warehouse name. Returns null when the id is unknown. */
export async function getWarehouseName(id: string): Promise<string | null> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM stock_locations WHERE id = $1`,
    [id]
  );
  return res.rows[0]?.name ?? null;
}

/** Resolve a single project name. Returns null when the id is unknown. */
export async function getProjectName(id: string): Promise<string | null> {
  const res = await pool.query<{ project_name: string }>(
    `SELECT project_name FROM projects WHERE id = $1`,
    [id]
  );
  return res.rows[0]?.project_name ?? null;
}
