import { query } from '@/lib/db-pool';

export interface AssignmentRosterFilters {
  projectId?: string;
  staffId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AssignmentOptionFilters {
  projectId?: string;
}

interface RosterRow extends Record<string, unknown> {
  assignment_id: string;
  staff_id: string;
  staff_name: string;
  project_id: string;
  project_name: string;
  operational_site_id: string;
  operational_site_name: string;
  start_date: string;
  end_date: string;
  assignment_kind: 'roster' | 'daily_override';
  vehicle_assignment_id: string | null;
  vehicle_registration: string | null;
  total_count: number | string;
}

export interface AssignmentRosterResult {
  items: Array<{
    assignmentId: string;
    staffId: string;
    staffName: string;
    projectId: string;
    projectName: string;
    operationalSiteId: string;
    operationalSiteName: string;
    startDate: string;
    endDate: string;
    assignmentKind: 'roster' | 'daily_override';
    vehicleAssignmentId: string | null;
    vehicleRegistration: string | null;
  }>;
  total: number;
}

type OptionRow = { id: string; label: string; projectId?: string; vehicleAssignmentId?: string };

export interface AssignmentOptions {
  staff: OptionRow[];
  projects: OptionRow[];
  sites: OptionRow[];
  vehicles: OptionRow[];
}

function pagination(filters: AssignmentRosterFilters): { limit: number; offset: number } {
  const requestedLimit = Number.isFinite(filters.limit) ? Math.floor(filters.limit!) : 25;
  const requestedOffset = Number.isFinite(filters.offset) ? Math.floor(filters.offset!) : 0;
  return { limit: Math.min(Math.max(requestedLimit, 1), 100), offset: Math.max(requestedOffset, 0) };
}

export async function listAssignmentRoster(filters: AssignmentRosterFilters = {}): Promise<AssignmentRosterResult> {
  const conditions = ["oa.status = 'active'"];
  const params: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    params.push(value);
    conditions.push(condition.replace('?', `$${params.length}`));
  };
  if (filters.projectId) add('p.id = ?::uuid', filters.projectId);
  if (filters.staffId) add('s.id = ?::uuid', filters.staffId);
  if (filters.startDate) add('oa.end_date >= ?::date', filters.startDate);
  if (filters.endDate) add('oa.start_date <= ?::date', filters.endDate);
  const { limit, offset } = pagination(filters);
  params.push(limit, offset);

  const rows = await query<RosterRow>(`
    SELECT oa.id AS assignment_id, s.id AS staff_id,
      CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
      p.id AS project_id, p.project_name,
      ops.id AS operational_site_id, ops.display_name AS operational_site_name,
      TO_CHAR(oa.start_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(oa.end_date, 'YYYY-MM-DD') AS end_date,
      oa.assignment_kind, oa.vehicle_assignment_id, fv.registration_number AS vehicle_registration,
      COUNT(*) OVER() AS total_count
    FROM fleet_operational_assignments oa
    JOIN staff s ON s.id = oa.staff_id
    JOIN projects p ON p.id = oa.project_id
    JOIN fleet_project_operational_sites ops ON ops.id = oa.operational_site_id
    LEFT JOIN vehicle_assignments va ON va.id = oa.vehicle_assignment_id
      AND va.assignment_start <= CURRENT_DATE
      AND COALESCE(va.assignment_end, '9999-12-31'::date) >= CURRENT_DATE
    LEFT JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY oa.start_date DESC, oa.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  return {
    items: rows.map((row) => ({
      assignmentId: row.assignment_id, staffId: row.staff_id, staffName: row.staff_name,
      projectId: row.project_id, projectName: row.project_name,
      operationalSiteId: row.operational_site_id, operationalSiteName: row.operational_site_name,
      startDate: row.start_date, endDate: row.end_date, assignmentKind: row.assignment_kind,
      vehicleAssignmentId: row.vehicle_assignment_id, vehicleRegistration: row.vehicle_registration,
    })),
    total: rows.length ? Number(rows[0]!.total_count) : 0,
  };
}

export async function listAssignmentOptions(
  filters: AssignmentOptionFilters = {},
  authorizedProjectIds: string[],
): Promise<AssignmentOptions> {
  const projectIds = filters.projectId
    ? authorizedProjectIds.filter((id) => id === filters.projectId)
    : authorizedProjectIds;
  if (!projectIds.length) return { staff: [], projects: [], sites: [], vehicles: [] };

  const rows = await query<{
    staff: OptionRow[] | null; projects: OptionRow[] | null; sites: OptionRow[] | null; vehicles: OptionRow[] | null;
  }>(`
    SELECT
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', s.id, 'label', CONCAT_WS(' ', s.first_name, s.last_name)) AS value
        FROM staff s
        WHERE LOWER(COALESCE(s.status, '')) = 'active' AND COALESCE(s.is_active, true)
      ) staff_rows), '[]'::jsonb) AS staff,
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', p.id, 'label', p.project_name) AS value
        FROM projects p
        WHERE p.id = ANY($1::uuid[]) AND LOWER(p.status) IN ('active', 'in_progress')
      ) project_rows), '[]'::jsonb) AS projects,
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', ops.id, 'label', ops.display_name, 'projectId', ops.project_id) AS value
        FROM fleet_project_operational_sites ops
        JOIN projects p ON p.id = ops.project_id
        WHERE p.id = ANY($1::uuid[]) AND ops.is_active = true
          AND LOWER(p.status) IN ('active', 'in_progress')
      ) site_rows), '[]'::jsonb) AS sites,
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', fv.id, 'label', fv.registration_number,
          'vehicleAssignmentId', va.id) AS value
        FROM vehicle_assignments va
        JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
        JOIN fleet_vehicle_project_assignments fvpa ON fvpa.vehicle_id = fv.id
        WHERE fvpa.project_id = ANY($1::uuid[])
          AND va.assignment_start <= CURRENT_DATE
          AND COALESCE(va.assignment_end, '9999-12-31'::date) >= CURRENT_DATE
          AND fvpa.assigned_date <= CURRENT_DATE
          AND COALESCE(fvpa.returned_date, '9999-12-31'::date) >= CURRENT_DATE
      ) vehicle_rows), '[]'::jsonb) AS vehicles`, [projectIds]);
  const result = rows[0];
  return { staff: result?.staff ?? [], projects: result?.projects ?? [], sites: result?.sites ?? [], vehicles: result?.vehicles ?? [] };
}
