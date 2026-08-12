import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { assignmentSourceVersion, type AssignmentSourceVersions } from './fingerprint';
import type { AssignmentProposalRow } from './types';
import type { ProposalValidationContext } from './validation';

export interface ActorScope { allProjects?: boolean; authorizedProjectIds?: string[] }
export interface AssignmentActor { userId: string; staffId?: string; role: string }
export interface AssignmentRecord extends AssignmentProposalRow {
  id: string; status: 'active' | 'superseded' | 'ended'; supersededBy?: string | null;
}
export interface PreviewState {
  context: ProposalValidationContext;
  sourceVersion: string;
  snapshots: Record<string, { projectName: string; projectCode: string | null; sites: Record<string, string> }>;
}

export async function loadAssignmentProjectId(id: string): Promise<string | null> {
  const row = await poolDb.queryOne<{ project_id: string }>(
    'SELECT project_id FROM fleet_operational_assignments WHERE id = $1::uuid',
    [id],
  );
  return row?.project_id ?? null;
}

type Db = Pick<TxnClient, 'query' | 'queryOne'>;
const poolDb: Db = { query: (text, params) => query(text, params), queryOne: async (text, params) => (await query(text, params))[0] ?? null };
const dates = `TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date`;

export async function expandActiveTeamStaff(teamIds: string[]): Promise<{ staffIds: string[]; excludedStaffIds: string[] }> {
  const rows = await query<{ member_id: string; staff_id: string | null; active: boolean }>(`
    SELECT tm.id AS member_id, s.id AS staff_id,
      (tm.is_active = true AND t.is_active = true AND t.team_type <> 'contractor'
       AND LOWER(COALESCE(s.status, '')) = 'active' AND COALESCE(s.is_active, true)) AS active
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    LEFT JOIN staff s ON s.user_id = tm.user_id
    WHERE tm.team_id = ANY($1::uuid[])`, [teamIds]);
  return {
    staffIds: [...new Set(rows.filter((row) => row.active && row.staff_id).map((row) => row.staff_id!))],
    excludedStaffIds: rows.filter((row) => !row.active || !row.staff_id).map((row) => row.staff_id ?? row.member_id),
  };
}

export async function loadPreviewState(rows: AssignmentProposalRow[], db: Db = poolDb, lock = false): Promise<PreviewState> {
  const staffIds = [...new Set(rows.map((row) => row.staffId))];
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  const siteIds = [...new Set(rows.map((row) => row.operationalSiteId))];
  const bounds = rows.reduce((value, row) => ({ from: value.from < row.startDate ? value.from : row.startDate, to: value.to > row.endDate ? value.to : row.endDate }), { from: rows[0]?.startDate ?? '1970-01-01', to: rows[0]?.endDate ?? '1970-01-01' });
  if (lock) await db.query(`SELECT id FROM fleet_operational_assignments WHERE staff_id = ANY($1::uuid[]) AND status = 'active' FOR UPDATE`, [staffIds]);
  const [staff, projects, sites, existing, vehicles, vehicleProjects, versions] = await Promise.all([
    db.query<{ id: string; active: boolean }>(`SELECT id, (LOWER(status) = 'active' AND COALESCE(is_active, true)) AS active FROM staff WHERE id = ANY($1::uuid[])`, [staffIds]),
    db.query<{ id: string; active: boolean; project_name: string; project_code: string | null }>(`SELECT id, LOWER(status) IN ('active','in_progress') AS active, project_name, project_code FROM projects WHERE id = ANY($1::uuid[])`, [projectIds]),
    db.query<{ id: string; project_id: string; is_active: boolean; display_name: string; confidence: string | null }>(`SELECT ops.id, ops.project_id, ops.is_active, ops.display_name, aoi.confidence FROM fleet_project_operational_sites ops LEFT JOIN fno_atlas_project_aois aoi ON aoi.id = ops.project_aoi_id WHERE ops.id = ANY($1::uuid[])`, [siteIds]),
    db.query<{ staff_id: string; start_date: string; end_date: string }>(`SELECT staff_id, ${dates} FROM fleet_operational_assignments WHERE staff_id = ANY($1::uuid[]) AND status = 'active' AND daterange(start_date,end_date,'[]') && daterange($2::date,$3::date,'[]')`, [staffIds, bounds.from, bounds.to]),
    db.query<{ id: string; staff_id: string; vehicle_id: string; start_date: string; end_date: string }>(`SELECT id, staff_id, fleet_vehicle_id AS vehicle_id, TO_CHAR(assignment_start,'YYYY-MM-DD') AS start_date, TO_CHAR(COALESCE(assignment_end,'9999-12-31'::date),'YYYY-MM-DD') AS end_date FROM vehicle_assignments WHERE staff_id = ANY($1::uuid[]) AND assignment_start <= $3::date AND COALESCE(assignment_end,'9999-12-31'::date) >= $2::date`, [staffIds, bounds.from, bounds.to]),
    db.query<{ vehicle_id: string; project_id: string; operational_site_id: string | null; start_date: string; end_date: string }>(`SELECT vehicle_id, project_id, NULL::uuid AS operational_site_id, TO_CHAR(assigned_date,'YYYY-MM-DD') AS start_date, TO_CHAR(COALESCE(returned_date,'9999-12-31'::date),'YYYY-MM-DD') AS end_date FROM fleet_vehicle_project_assignments WHERE assigned_date <= $2::date AND COALESCE(returned_date,'9999-12-31'::date) >= $1::date`, [bounds.from, bounds.to]),
    db.queryOne<AssignmentSourceVersions & Record<string, unknown>>(`SELECT COALESCE((SELECT MAX(updated_at)::text FROM fleet_operational_assignments),'') assignments, COALESCE((SELECT MAX(updated_at)::text FROM fleet_vehicles),'') vehicles, COALESCE((SELECT MAX(updated_at)::text FROM vehicle_assignments),'') "vehicleAssignments", COALESCE((SELECT MAX(updated_at)::text FROM staff),'') staff, COALESCE((SELECT MAX(updated_at)::text FROM fleet_project_operational_sites),'') "projectSites", COALESCE((SELECT MAX(updated_at)::text FROM team_members),'') "teamMembers", COALESCE((SELECT MAX(updated_at)::text FROM attendance_policy_assignments),'') "attendancePolicies"`),
  ]);
  const snapshots: PreviewState['snapshots'] = {};
  for (const project of projects) snapshots[project.id] = { projectName: project.project_name, projectCode: project.project_code, sites: {} };
  for (const site of sites) if (snapshots[site.project_id]) snapshots[site.project_id]!.sites[site.id] = site.display_name;
  return { context: {
    staffById: Object.fromEntries(staff.map((item) => [item.id, { isActive: item.active }])),
    projectsById: Object.fromEntries(projects.map((item) => [item.id, { isActive: item.active }])),
    operationalSitesById: Object.fromEntries(sites.map((item) => [item.id, { isActive: item.is_active, projectId: item.project_id, aoiConfidence: item.confidence }])),
    existingAssignments: existing.map((item) => ({ staffId: item.staff_id, startDate: item.start_date, endDate: item.end_date })),
    vehicleAssignments: vehicles.map((item) => ({ id: item.id, staffId: item.staff_id, vehicleId: item.vehicle_id, startDate: item.start_date, endDate: item.end_date })),
    vehicleProjectAssignments: vehicleProjects.map((item) => ({ vehicleId: item.vehicle_id, projectId: item.project_id, operationalSiteId: item.operational_site_id, startDate: item.start_date, endDate: item.end_date })), unscheduledDatesByStaffId: {},
  }, sourceVersion: assignmentSourceVersion(versions!), snapshots };
}

export const runAssignmentTransaction = <T>(callback: (txn: TxnClient) => Promise<T>): Promise<T> => transaction(callback);

/** Lock every mutable source that contributes to validation/fingerprinting. */
export async function lockRelevantPreviewSources(tx: Db, rows: AssignmentProposalRow[], teamIds: string[] = []): Promise<void> {
  const staffIds = [...new Set(rows.map((row) => row.staffId))];
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  const siteIds = [...new Set(rows.map((row) => row.operationalSiteId))];
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleAssignmentId).filter((id): id is string => Boolean(id)))];
  await tx.query(`SELECT id FROM staff WHERE id = ANY($1::uuid[]) FOR UPDATE`, [staffIds]);
  await tx.query(`SELECT id FROM projects WHERE id = ANY($1::uuid[]) FOR UPDATE`, [projectIds]);
  await tx.query(`SELECT id FROM fleet_project_operational_sites WHERE id = ANY($1::uuid[]) FOR UPDATE`, [siteIds]);
  await tx.query(`SELECT id FROM vehicle_assignments WHERE staff_id = ANY($1::uuid[]) OR id = ANY($2::uuid[]) FOR UPDATE`, [staffIds, vehicleIds]);
  await tx.query(`SELECT fvpa.id FROM fleet_vehicle_project_assignments fvpa JOIN vehicle_assignments va ON va.fleet_vehicle_id = fvpa.vehicle_id WHERE va.staff_id = ANY($1::uuid[]) FOR UPDATE OF fvpa`, [staffIds]);
  await tx.query(`SELECT id FROM teams WHERE id = ANY($1::uuid[]) FOR UPDATE`, [teamIds]);
  await tx.query(`SELECT id FROM team_members WHERE team_id = ANY($1::uuid[]) FOR UPDATE`, [teamIds]);
  await tx.query(`SELECT id FROM attendance_policy_assignments WHERE staff_id = ANY($1::uuid[]) FOR UPDATE`, [staffIds]);
}

export async function insertAssignment(tx: Db, row: AssignmentProposalRow, actorId: string, snapshot: PreviewState['snapshots'][string]): Promise<AssignmentRecord> {
  const result = await tx.queryOne<{ id: string }>(`INSERT INTO fleet_operational_assignments (staff_id,project_id,operational_site_id,start_date,end_date,assignment_kind,vehicle_assignment_id,reason,project_name_snapshot,project_code_snapshot,operational_site_display_name_snapshot,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [row.staffId,row.projectId,row.operationalSiteId,row.startDate,row.endDate,row.assignmentKind,row.vehicleAssignmentId,row.reason,snapshot.projectName,snapshot.projectCode,snapshot.sites[row.operationalSiteId],actorId]);
  if (!result) throw new Error('Assignment insert returned no row');
  return { id: result.id, ...row, status: 'active' };
}

export function insertAudit(tx: Db, assignmentId: string, action: string, correlationId: string, actorId: string, reason: string | null, before: unknown, after: unknown): Promise<unknown[]> {
  return tx.query(`INSERT INTO fleet_operational_assignment_audit (assignment_id,action,actor_user_id,reason,request_correlation_id,before_snapshot,after_snapshot) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`, [assignmentId,action,actorId,reason,correlationId,before ? JSON.stringify(before) : null,after ? JSON.stringify(after) : null]);
}

export async function lockAssignment(tx: Db, id: string): Promise<AssignmentRecord | null> {
  const row = await tx.queryOne<Record<string, unknown>>(`SELECT id,staff_id,project_id,operational_site_id,${dates},assignment_kind,vehicle_assignment_id,status,reason,superseded_by FROM fleet_operational_assignments WHERE id=$1 FOR UPDATE`, [id]);
  return row ? { id: row.id as string, staffId: row.staff_id as string, projectId: row.project_id as string, operationalSiteId: row.operational_site_id as string, startDate: row.start_date as string, endDate: row.end_date as string, assignmentKind: row.assignment_kind as AssignmentRecord['assignmentKind'], vehicleAssignmentId: row.vehicle_assignment_id as string | null, status: row.status as AssignmentRecord['status'], reason: row.reason as string | null, supersededBy: row.superseded_by as string | null } : null;
}
export const supersedeAssignment = (tx: Db, id: string, replacementId: string): Promise<unknown[]> => tx.query(`UPDATE fleet_operational_assignments SET status='superseded',superseded_by=$2,updated_at=NOW() WHERE id=$1`, [id,replacementId]);
export const endAssignmentRow = (tx: Db, id: string, endDate: string, reason: string): Promise<unknown[]> => tx.query(`UPDATE fleet_operational_assignments SET status='ended',end_date=$2,reason=$3,updated_at=NOW() WHERE id=$1`, [id,endDate,reason]);
export const listAssignmentHistory = (id: string): Promise<Record<string, unknown>[]> => query(`SELECT action,actor_user_id AS "actorUserId",occurred_at AS "occurredAt",reason,request_correlation_id AS "requestCorrelationId",before_snapshot AS "beforeSnapshot",after_snapshot AS "afterSnapshot" FROM fleet_operational_assignment_audit WHERE assignment_id=$1 ORDER BY occurred_at DESC,id DESC`, [id]);
export async function loadAssignmentsForCopy(ids: string[]): Promise<AssignmentRecord[]> { const rows = await Promise.all(ids.map((id) => lockAssignment(poolDb, id))); return rows.filter((row): row is AssignmentRecord => Boolean(row)); }
