/**
 * Serial register search — read-only filtered query against stock_serials
 * with location/project/category enrichment + LATERAL latest-event join.
 *
 * Sibling to serialService.ts (CRUD/lifecycle). This file owns the search
 * + pagination concern.
 */
import { pool } from '@/lib/db-pool';
import type { SerialSearchFilters } from '@/types/field-stock';

export interface SearchPagination {
  page: number;
  pageSize: number;
}

export interface SerialSearchRow {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}

export interface SerialSearchResult {
  rows: SerialSearchRow[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 200;

/**
 * Escape LIKE/ILIKE wildcards in user-supplied prefix queries so `q="%"` or
 * `q="_"` cannot expand into a full-table scan. Used with the explicit
 * `ESCAPE '\'` clause in the SQL below so backslash is the escape char.
 */
function escapeLikePrefix(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function searchSerials(
  filters: SerialSearchFilters,
  pagination: SearchPagination
): Promise<SerialSearchResult> {
  const pageSize = Math.min(Math.max(1, pagination.pageSize), MAX_PAGE_SIZE);
  const page = Math.max(1, pagination.page);
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [];
  const conds: string[] = [];
  if (filters.q) {
    params.push(`${escapeLikePrefix(filters.q)}%`);
    conds.push(
      `(ss.serial_number ILIKE $${params.length} ESCAPE '\\' OR ss.mac_address ILIKE $${params.length} ESCAPE '\\')`
    );
  }
  if (filters.status && filters.status.length > 0) {
    params.push(filters.status);
    conds.push(`ss.status = ANY($${params.length}::text[])`);
  }
  if (filters.category) {
    params.push(filters.category);
    conds.push(`si.category = $${params.length}`);
  }
  if (filters.warehouseId) {
    params.push(filters.warehouseId);
    conds.push(`ss.current_location_id = $${params.length}`);
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    conds.push(`ss.allocated_to_project_id = $${params.length}`);
  }
  if (filters.dropNumber) {
    params.push(filters.dropNumber);
    conds.push(`ss.installed_at_drop_number = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const baseFrom = `
    FROM stock_serials ss
    LEFT JOIN stock_items si ON si.id = ss.stock_item_id
    LEFT JOIN stock_locations sl ON sl.id = ss.current_location_id
    LEFT JOIN projects p ON p.id = ss.allocated_to_project_id
    LEFT JOIN LATERAL (
      SELECT event_type, occurred_at
      FROM stock_serial_events sse
      WHERE sse.serial_id = ss.id
      ORDER BY occurred_at DESC
      LIMIT 1
    ) le ON true
  `;

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${baseFrom} ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const dataRes = await pool.query<{
    id: string;
    serial_number: string;
    mac_address: string | null;
    category: string | null;
    item_name: string | null;
    status: string;
    location_name: string | null;
    project_name: string | null;
    drop_number: string | null;
    last_event_type: string | null;
    last_event_at: Date | string | null;
  }>(
    `
    SELECT
      ss.id, ss.serial_number, ss.mac_address,
      si.category, si.name AS item_name,
      ss.status, sl.name AS location_name, p.name AS project_name,
      ss.installed_at_drop_number AS drop_number,
      le.event_type AS last_event_type, le.occurred_at AS last_event_at
    ${baseFrom} ${where}
    ORDER BY ss.created_at DESC, ss.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `,
    [...params, pageSize, offset]
  );

  return {
    rows: dataRes.rows.map((r) => ({
      id: r.id,
      serialNumber: r.serial_number,
      macAddress: r.mac_address,
      category: r.category,
      itemName: r.item_name,
      status: r.status,
      currentLocationName: r.location_name,
      allocatedProjectName: r.project_name,
      installedAtDropNumber: r.drop_number,
      lastEventType: r.last_event_type,
      lastEventAt: r.last_event_at instanceof Date
        ? r.last_event_at.toISOString()
        : r.last_event_at,
    })),
    total,
    page,
    pageSize,
  };
}
