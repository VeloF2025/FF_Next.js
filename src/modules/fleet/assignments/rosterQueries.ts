import { query } from '@/lib/db-pool';

export interface AssignmentRosterFilters {
  projectId?: string;
  staffId?: string;
  siteId?: string;
  source?: 'roster' | 'daily_override' | 'vehicle_project' | 'home_site' | 'unassigned';
  unassignedScheduled?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AssignmentOptionFilters {
  projectId?: string;
  startDate?: string;
  endDate?: string;
}

interface RosterRow extends Record<string, unknown> {
  assignment_id: string | null;
  staff_id: string;
  staff_name: string;
  project_id: string | null;
  project_name: string | null;
  operational_site_id: string | null;
  operational_site_name: string | null;
  start_date: string | null;
  end_date: string | null;
  assignment_kind: 'roster' | 'daily_override' | 'vehicle_project' | 'home_site' | 'unassigned';
  vehicle_assignment_id: string | null;
  vehicle_registration: string | null;
  total_count: number | string;
  work_date: string;
  scheduled: boolean;
  expected_start_time: string | null;
  expected_end_time: string | null;
}

export interface AssignmentRosterItem {
    assignmentId: string | null;
    staffId: string;
    staffName: string;
    projectId: string | null;
    projectName: string | null;
    operationalSiteId: string | null;
    operationalSiteName: string | null;
    startDate: string | null;
    endDate: string | null;
    assignmentKind: 'roster' | 'daily_override' | 'vehicle_project' | 'home_site' | 'unassigned';
    vehicleAssignmentId: string | null;
    vehicleRegistration: string | null;
    workDate?: string;
    scheduled?: boolean;
    expectedStartTime?: string | null;
    expectedEndTime?: string | null;
}
export interface AssignmentRosterResult {
  items: AssignmentRosterItem[];
  total: number;
}

export type AssignmentOption = { id: string; label: string; projectId?: string; vehicleAssignmentId?: string; staffId?: string };

export interface AssignmentSourceOption extends AssignmentOption {
  kind: 'aoi' | 'location';
  confidence?: string;
  warning?: string;
}

export interface AssignmentOptions {
  staff: AssignmentOption[];
  teams: AssignmentOption[];
  projects: AssignmentOption[];
  sites: AssignmentOption[];
  vehicles: AssignmentOption[];
  siteSources: AssignmentSourceOption[];
}

function pagination(filters: AssignmentRosterFilters): { limit: number; offset: number } {
  const requestedLimit = Number.isFinite(filters.limit) ? Math.floor(filters.limit!) : 25;
  const requestedOffset = Number.isFinite(filters.offset) ? Math.floor(filters.offset!) : 0;
  return { limit: Math.min(Math.max(requestedLimit, 1), 100), offset: Math.max(requestedOffset, 0) };
}

export async function listAssignmentRoster(filters: AssignmentRosterFilters = {}): Promise<AssignmentRosterResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    params.push(value);
    conditions.push(condition.replace('?', `$${params.length}`));
  };
  if (filters.projectId) add(filters.unassignedScheduled ? '(effective.project_id = ?::uuid OR effective.source = \'unassigned\')' : 'effective.project_id = ?::uuid', filters.projectId);
  if (filters.staffId) add('effective.staff_id = ?::uuid', filters.staffId);
  if (filters.siteId) add('effective.operational_site_id = ?::uuid', filters.siteId);
  if (filters.source) add('effective.source = ?', filters.source);
  if (filters.unassignedScheduled) conditions.push("effective.source = 'unassigned'", 'effective.scheduled = true',
    `EXISTS (SELECT 1 FROM project_team_assignments pta JOIN team_members tm ON tm.team_id=pta.team_id AND tm.is_active JOIN staff scoped_staff ON scoped_staff.user_id=tm.user_id WHERE pta.project_id=$1::uuid AND scoped_staff.id=effective.staff_id)`);
  const { limit, offset } = pagination(filters);
  params.push(filters.startDate ?? null, filters.endDate ?? null);
  const startDateParam = params.length - 1; const endDateParam = params.length;
  params.push(limit, offset);

  const rows = await query<RosterRow>(`
    WITH staff_days AS (
      SELECT s.id AS staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name, s.home_site_id,
        day::date AS work_date
      FROM staff s CROSS JOIN generate_series(COALESCE($${startDateParam}::date, CURRENT_DATE), COALESCE($${endDateParam}::date, CURRENT_DATE), interval '1 day') day
      WHERE LOWER(COALESCE(s.status,'')) = 'active' AND COALESCE(s.is_active,true)
    ), effective AS (
      SELECT sd.*, explicit.id AS assignment_id,
        CASE WHEN explicit.id IS NOT NULL THEN explicit.assignment_kind
          WHEN driver_vehicle.candidate_count = 1 AND vehicle_project.candidate_count = 1 THEN 'vehicle_project'
          WHEN home.id IS NOT NULL THEN 'home_site' ELSE 'unassigned' END AS source,
        COALESCE(explicit.project_id, CASE WHEN driver_vehicle.candidate_count = 1 AND vehicle_project.candidate_count = 1 THEN vehicle_project.project_id END) AS project_id,
        COALESCE(explicit.operational_site_id, CASE WHEN driver_vehicle.candidate_count = 1 AND vehicle_project.candidate_count = 1 THEN vehicle_project.operational_site_id END) AS operational_site_id,
        explicit.start_date, explicit.end_date,
        COALESCE(explicit.vehicle_assignment_id, CASE WHEN driver_vehicle.candidate_count = 1 THEN driver_vehicle.id END) AS vehicle_assignment_id,
        driver_vehicle.registration_number AS vehicle_registration,
        COALESCE(policy.scheduled,false) AS scheduled, policy.start_time AS expected_start_time, policy.end_time AS expected_end_time,
        home.name AS home_name
      FROM staff_days sd
      LEFT JOIN LATERAL (SELECT oa.* FROM fleet_operational_assignments oa WHERE oa.staff_id=sd.staff_id AND oa.status='active' AND sd.work_date BETWEEN oa.start_date AND oa.end_date ORDER BY CASE oa.assignment_kind WHEN 'daily_override' THEN 0 ELSE 1 END LIMIT 1) explicit ON true
      LEFT JOIN LATERAL (SELECT va.id, va.fleet_vehicle_id, fv.registration_number, COUNT(*) OVER() AS candidate_count FROM vehicle_assignments va JOIN fleet_vehicles fv ON fv.id=va.fleet_vehicle_id AND LOWER(COALESCE(fv.status,'active'))='active' WHERE va.staff_id=sd.staff_id AND va.assignment_start<=sd.work_date AND COALESCE(va.assignment_end,'9999-12-31')>=sd.work_date ORDER BY va.assignment_start DESC LIMIT 1) driver_vehicle ON true
      LEFT JOIN LATERAL (SELECT fvpa.id, fvpa.project_id, ops.id AS operational_site_id, COUNT(*) OVER() AS candidate_count FROM fleet_vehicle_project_assignments fvpa LEFT JOIN fleet_project_operational_sites ops ON ops.project_id=fvpa.project_id AND ops.is_active AND ops.is_default WHERE explicit.id IS NULL AND driver_vehicle.candidate_count=1 AND fvpa.vehicle_id=driver_vehicle.fleet_vehicle_id AND fvpa.is_active AND fvpa.assigned_date<=sd.work_date AND COALESCE(fvpa.returned_date,'9999-12-31')>=sd.work_date ORDER BY fvpa.assigned_date DESC LIMIT 1) vehicle_project ON true
      LEFT JOIN fleet_authorized_locations home ON home.id=sd.home_site_id AND home.is_active AND explicit.id IS NULL
        AND (driver_vehicle.id IS NULL OR (driver_vehicle.candidate_count=1 AND vehicle_project.id IS NULL))
      LEFT JOIN LATERAL (SELECT ap.start_time::text, ap.end_time::text, COALESCE((ap.work_days->>TRIM(LOWER(TO_CHAR(sd.work_date,'day'))))::boolean,false) AS scheduled FROM attendance_policy_assignments apa JOIN attendance_policies ap ON ap.id=apa.policy_id AND ap.is_active WHERE apa.staff_id=sd.staff_id AND apa.effective_from<=sd.work_date AND COALESCE(apa.effective_to,'9999-12-31')>=sd.work_date ORDER BY apa.effective_from DESC LIMIT 1) policy ON true
    )
    SELECT effective.assignment_id, effective.staff_id, effective.staff_name, effective.project_id, p.project_name,
      effective.operational_site_id, COALESCE(ops.display_name,effective.home_name) AS operational_site_name,
      TO_CHAR(effective.start_date,'YYYY-MM-DD') AS start_date, TO_CHAR(effective.end_date,'YYYY-MM-DD') AS end_date,
      effective.source AS assignment_kind, effective.vehicle_assignment_id, effective.vehicle_registration,
      TO_CHAR(effective.work_date,'YYYY-MM-DD') AS work_date, effective.scheduled,
      effective.expected_start_time, effective.expected_end_time, COUNT(*) OVER() AS total_count
    FROM effective LEFT JOIN projects p ON p.id=effective.project_id LEFT JOIN fleet_project_operational_sites ops ON ops.id=effective.operational_site_id
    WHERE ${conditions.length ? conditions.join(' AND ') : 'true'}
    ORDER BY effective.work_date DESC, effective.staff_name
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  return {
    items: rows.map((row) => ({
      assignmentId: row.assignment_id, staffId: row.staff_id, staffName: row.staff_name,
      projectId: row.project_id, projectName: row.project_name,
      operationalSiteId: row.operational_site_id, operationalSiteName: row.operational_site_name,
      startDate: row.start_date, endDate: row.end_date, assignmentKind: row.assignment_kind,
      vehicleAssignmentId: row.vehicle_assignment_id, vehicleRegistration: row.vehicle_registration,
      workDate: row.work_date, scheduled: row.scheduled,
      expectedStartTime: row.expected_start_time, expectedEndTime: row.expected_end_time,
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
  if (!projectIds.length) return { staff: [], teams: [], projects: [], sites: [], vehicles: [], siteSources: [] };

  const rows = await query<{
    staff: AssignmentOption[] | null; teams: AssignmentOption[] | null; projects: AssignmentOption[] | null; sites: AssignmentOption[] | null; vehicles: AssignmentOption[] | null; site_sources: AssignmentSourceOption[] | null;
  }>(`
    SELECT
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', s.id, 'label', CONCAT_WS(' ', s.first_name, s.last_name)) AS value
        FROM staff s
        WHERE LOWER(COALESCE(s.status, '')) = 'active' AND COALESCE(s.is_active, true)
      ) staff_rows), '[]'::jsonb) AS staff,
      COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', t.id, 'label', t.team_name) AS value
        FROM teams t WHERE t.is_active = true AND t.team_type <> 'contractor'
      ) team_rows), '[]'::jsonb) AS teams,
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
          'vehicleAssignmentId', va.id, 'staffId', va.staff_id) AS value
        FROM vehicle_assignments va
        JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
        JOIN fleet_vehicle_project_assignments fvpa ON fvpa.vehicle_id = fv.id
        WHERE fvpa.project_id = ANY($1::uuid[])
          AND ($2::date IS NULL OR va.assignment_start <= $2::date)
          AND ($3::date IS NULL OR COALESCE(va.assignment_end, '9999-12-31'::date) >= $3::date)
          AND ($2::date IS NULL OR fvpa.assigned_date <= $2::date)
          AND ($3::date IS NULL OR COALESCE(fvpa.returned_date, '9999-12-31'::date) >= $3::date)
      ) vehicle_rows), '[]'::jsonb) AS vehicles,
      (COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', aoi.id, 'label', aoi.site_code || ' — ' || aoi.area_name,
          'kind', 'aoi', 'confidence', aoi.confidence,
          'warning', CASE WHEN aoi.confidence IN ('low','needs_verification') THEN 'Review this AOI before linking' END) AS value
        FROM fno_atlas_project_aois aoi WHERE aoi.retired_at IS NULL
      ) aoi_rows), '[]'::jsonb) || COALESCE((SELECT jsonb_agg(value ORDER BY value->>'label') FROM (
        SELECT jsonb_build_object('id', fal.id, 'label', fal.name, 'kind', 'location') AS value
        FROM fleet_authorized_locations fal WHERE fal.is_active = true
      ) location_rows), '[]'::jsonb)) AS site_sources`, [projectIds, filters.startDate ?? null, filters.endDate ?? null]);
  const result = rows[0];
  return { staff: result?.staff ?? [], teams: result?.teams ?? [], projects: result?.projects ?? [], sites: result?.sites ?? [], vehicles: result?.vehicles ?? [], siteSources: result?.site_sources ?? [] };
}
