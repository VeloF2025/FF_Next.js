import { query as poolQuery } from '@/lib/db-pool';
import type { AssignmentSource, ResolvedOperationalAssignment } from './types';

interface ResolverDb { query<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> }
interface EvidenceRow extends Record<string, unknown> {
  id: string; project_id?: string; project_manager?: string | null;
  operational_site_id?: string | null; operational_site_name?: string | null;
  authorized_location_id?: string | null; vehicle_assignment_id?: string | null;
  vehicle_id?: string; display_name?: string;
}
interface ScheduleRow extends Record<string, unknown> {
  id: string; start_time: string | null; end_time: string | null;
  scheduled: boolean; warning: string | null;
}

const db: ResolverDb = { query: (sql, params) => poolQuery(sql, params) };
const assignmentSelect = `SELECT foa.id, foa.project_id, p.project_manager,
  foa.operational_site_id, ops.display_name AS operational_site_name,
  ops.authorized_location_id, foa.vehicle_assignment_id
  FROM fleet_operational_assignments foa
  JOIN projects p ON p.id = foa.project_id AND LOWER(p.status) IN ('active','in_progress')
  JOIN fleet_project_operational_sites ops ON ops.id = foa.operational_site_id AND ops.is_active = true
  WHERE foa.staff_id = $1::uuid AND foa.status = 'active'
    AND $2::date BETWEEN foa.start_date AND foa.end_date`;

function result(staffId: string, workDate: string, source: AssignmentSource, evidence: EvidenceRow | null, schedule: ScheduleRow | null, warnings: string[]): ResolvedOperationalAssignment {
  return {
    staffId, workDate, source,
    projectId: evidence?.project_id ?? null,
    projectManager: evidence?.project_manager ?? null,
    operationalSiteId: evidence?.operational_site_id ?? null,
    operationalSiteName: evidence?.operational_site_name ?? evidence?.display_name ?? null,
    authorizedLocationId: evidence?.authorized_location_id ?? (source === 'home_site' ? evidence?.id ?? null : null),
    vehicleAssignmentId: evidence?.vehicle_assignment_id ?? null,
    scheduled: schedule?.scheduled ?? false,
    expectedStartTime: schedule?.start_time ?? null,
    expectedEndTime: schedule?.end_time ?? null,
    schedulePolicyId: schedule?.id ?? null,
    warnings: [...warnings, ...(schedule?.warning ? [schedule.warning] : [])],
    sourceRowIds: evidence ? [evidence.id] : [],
  };
}

export async function resolveOperationalAssignment(staffId: string, workDate: string, resolverDb: ResolverDb = db): Promise<ResolvedOperationalAssignment> {
  const params = [staffId, workDate];
  const scheduleRows = await resolverDb.query<ScheduleRow>(`/* fleet-resolver:schedule */
    SELECT ap.id, ap.start_time::text, ap.end_time::text,
      COALESCE((ap.work_days ->> TRIM(LOWER(TO_CHAR($2::date, 'day'))))::boolean, false) AS scheduled,
      CASE WHEN h.holiday_date IS NOT NULL THEN 'PUBLIC_HOLIDAY'
        WHEN NOT COALESCE((ap.work_days ->> TRIM(LOWER(TO_CHAR($2::date, 'day'))))::boolean, false) THEN UPPER(TRIM(TO_CHAR($2::date, 'day')))
        ELSE NULL END AS warning
    FROM attendance_policy_assignments apa
    JOIN attendance_policies ap ON ap.id = apa.policy_id AND ap.is_active = true
    LEFT JOIN public_holidays h ON h.holiday_date = $2::date
    WHERE apa.staff_id = $1::uuid AND apa.effective_from <= $2::date
      AND (apa.effective_to IS NULL OR apa.effective_to >= $2::date)
    ORDER BY apa.effective_from DESC LIMIT 1`, params);
  const schedule = scheduleRows[0] ?? null;

  const daily = await resolverDb.query<EvidenceRow>(`/* fleet-resolver:daily */ ${assignmentSelect}
    AND foa.assignment_kind = 'daily_override' LIMIT 1`, params);
  if (daily[0]) return result(staffId, workDate, 'daily_override', daily[0], schedule, []);

  const roster = await resolverDb.query<EvidenceRow>(`/* fleet-resolver:roster */ ${assignmentSelect}
    AND foa.assignment_kind = 'roster' LIMIT 1`, params);
  if (roster[0]) return result(staffId, workDate, 'roster', roster[0], schedule, []);

  const vehicles = await resolverDb.query<EvidenceRow>(`/* fleet-resolver:vehicles */
    SELECT va.id, va.fleet_vehicle_id AS vehicle_id
    FROM vehicle_assignments va JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
    WHERE va.staff_id = $1::uuid AND va.assignment_start <= $2::date
      AND (va.assignment_end IS NULL OR va.assignment_end >= $2::date)
      AND LOWER(COALESCE(fv.status, 'active')) = 'active' LIMIT 2`, params);
  if (vehicles.length > 1) return result(staffId, workDate, 'unassigned', null, schedule, ['AMBIGUOUS_DRIVER_VEHICLES']);
  if (vehicles[0]) {
    const projects = await resolverDb.query<EvidenceRow>(`/* fleet-resolver:vehicleProjects */
      SELECT fvpa.id, fvpa.project_id, p.project_manager, ops.id AS operational_site_id,
        ops.display_name AS operational_site_name, ops.authorized_location_id
      FROM fleet_vehicle_project_assignments fvpa
      JOIN projects p ON p.id = fvpa.project_id AND LOWER(p.status) IN ('active','in_progress')
      LEFT JOIN fleet_project_operational_sites ops ON ops.project_id = fvpa.project_id
        AND ops.is_active = true AND ops.is_default = true
      WHERE fvpa.vehicle_id = $1::uuid AND fvpa.is_active = true
        AND fvpa.assigned_date <= $2::date AND (fvpa.returned_date IS NULL OR fvpa.returned_date >= $2::date)
      LIMIT 2`, [vehicles[0].vehicle_id, workDate]);
    if (projects.length > 1) return result(staffId, workDate, 'unassigned', null, schedule, ['AMBIGUOUS_VEHICLE_PROJECTS']);
    if (projects[0]) return result(staffId, workDate, 'vehicle_project', { ...projects[0], vehicle_assignment_id: vehicles[0].id }, schedule, []);
  }

  const home = await resolverDb.query<EvidenceRow>(`/* fleet-resolver:homeSite */
    SELECT fal.id, fal.name AS display_name
    FROM staff s JOIN fleet_authorized_locations fal ON fal.id = s.home_location_id
    WHERE s.id = $1::uuid AND LOWER(s.status) = 'active'
      AND COALESCE(s.is_active, true) AND fal.is_active = true LIMIT 1`, [staffId]);
  return result(staffId, workDate, home[0] ? 'home_site' : 'unassigned', home[0] ?? null, schedule, []);
}
