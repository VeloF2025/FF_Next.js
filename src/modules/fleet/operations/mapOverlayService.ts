import { query } from '@/lib/db-pool';
import { loadOperationalEvidence } from './evidenceQueries';
import { canAccessOperationalProject, hasOperationalOversight } from './projectScope';
import {
  getOperationalEvidenceDetail,
  getOperationalRosterStatus,
  isOperationalAttendancePointEligible,
  type OperationalEvidenceDetail,
  type RosterStatusResult,
} from './statusService';
import type { OperationalEvidence, OperationalFlag, OperationalStatus, OperationalStatusSummary } from './types';

export interface OperationalMapActorScope { userId: string; staffId: string | null; role: string }
export interface OperationalMapOverlayRequest {
  projectId?: string; staffId?: string; siteId?: string; workDate: string; asOf: string;
  page: number; limit: number; includeGeometry: boolean;
}
export interface OperationalBadgeRow {
  vehicleId: string; staffId: string; staffName: string; projectId: string | null;
  projectName: string | null; operationalSiteId: string | null; operationalSiteName: string | null;
  status: OperationalStatus; flags: OperationalFlag[]; reasonCodes: string[]; evidenceTimestamps: string[];
  ruleId: string; ruleVersion: number;
}
export interface OperationalAttendancePoint {
  staffId: string; staffName: string; projectId: string | null; operationalSiteId: string | null;
  status: OperationalStatus; latitude: number; longitude: number; recordedAt: string;
  source: 'attendance_clock_in'; live: false; label: 'Attendance check-in evidence — not live tracking';
}
export interface OperationalUnplottableRow {
  staffId: string; staffName: string; projectId: string | null; operationalSiteId: string | null;
  status: OperationalStatus; reason: 'no_permissible_coordinate';
}
export interface AoiOverlayGeometry {
  kind: 'aoi'; operationalSiteId: string; projectId: string; operationalSiteName: string;
  confidence: string; lowConfidence: boolean; geoJson: Record<string, unknown>;
}
export interface AuthorizedLocationOverlayGeometry {
  kind: 'authorized_location'; operationalSiteId: string; projectId: string; operationalSiteName: string;
  center: { latitude: number; longitude: number }; radiusM: number;
}
export type OperationalOverlayGeometry = AoiOverlayGeometry | AuthorizedLocationOverlayGeometry;
export interface OperationalMapOverlay {
  badges: OperationalBadgeRow[]; attendancePoints: OperationalAttendancePoint[];
  unplottable: OperationalUnplottableRow[]; geometry?: OperationalOverlayGeometry;
  page: number; limit: number; total: number; hasMore: boolean; workDate: string; evaluatedAt: string;
}

export class OperationalMapRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'OperationalMapRequestError'; }
}
export class OperationalMapAccessError extends Error {
  constructor() { super('Operational map selection is outside the actor scope'); this.name = 'OperationalMapAccessError'; }
}

interface GeometryRow extends Record<string, unknown> {
  site_id: string; project_id: string; site_name: string; source: 'aoi' | 'authorized_location';
  confidence: string | null; geojson: Record<string, unknown> | null;
  latitude: string | number | null; longitude: string | number | null; radius_m: string | number | null;
}
interface SiteScopeRow extends Record<string, unknown> { project_id: string }
interface JoinedRow { summary: OperationalStatusSummary; evidence: OperationalEvidence }
const BATCH_LIMIT = 100;

function detailSummary(evidence: OperationalEvidence, detail: OperationalEvidenceDetail): OperationalStatusSummary {
  return {
    staffId: evidence.staffId, staffName: evidence.staffName, projectId: evidence.assignment.projectId,
    projectName: evidence.assignment.projectName, operationalSiteId: evidence.assignment.operationalSiteId,
    operationalSiteName: evidence.assignment.operationalSiteName, status: detail.evaluation.status,
    flags: detail.evaluation.flags, reasonCodes: detail.evaluation.reasonCodes,
    monitoringStart: detail.monitoringStart, scheduledStart: detail.scheduledStart, graceEnd: detail.graceEnd,
    scheduledEnd: detail.scheduledEnd, monitoringEnd: detail.monitoringEnd,
    gpsStaleAfterSeconds: detail.gpsStaleAfterSeconds, sourceTimestamps: detail.evaluation.sourceTimestamps,
    ruleId: detail.evaluation.ruleId, ruleVersion: detail.evaluation.ruleVersion,
  };
}

async function authorizeProject(projectId: string, actor: OperationalMapActorScope): Promise<void> {
  const allowed = await canAccessOperationalProject(actor.userId, actor.staffId, actor.role, projectId);
  if (!allowed) throw new OperationalMapAccessError();
}

async function resolveSiteProject(siteId: string): Promise<string> {
  const rows = await query<SiteScopeRow>(`/* fleet-operations:selected-site-scope */
    SELECT project_id FROM fleet_project_operational_sites
    WHERE id=$1::uuid AND is_active LIMIT 1`, [siteId]);
  const projectId = rows[0]?.project_id;
  if (!projectId) throw new OperationalMapRequestError('Operational site selection was not found');
  return projectId;
}

async function loadProjectRows(request: OperationalMapOverlayRequest, actor: OperationalMapActorScope): Promise<JoinedRow[]> {
  const projectId = request.projectId;
  if (!projectId) throw new OperationalMapRequestError('projectId is required for a project selection');
  await authorizeProject(projectId, actor);
  const statusRequest = { projectId, workDate: request.workDate, asOf: request.asOf, page: 1, limit: BATCH_LIMIT };
  const [roster, evidence] = await Promise.all([
    getOperationalRosterStatus(statusRequest),
    loadOperationalEvidence({ projectId, workDate: request.workDate, asOf: request.asOf, limit: BATCH_LIMIT, offset: 0 }),
  ]);
  if (roster.hasMore || roster.items.length !== roster.total || evidence.items.length !== evidence.total) {
    throw new OperationalMapRequestError('Operational map requires a complete project selection');
  }
  return joinRows(roster, evidence.items, request);
}

async function loadStaffRow(request: OperationalMapOverlayRequest, actor: OperationalMapActorScope): Promise<JoinedRow[]> {
  const staffId = request.staffId;
  if (!staffId) throw new OperationalMapRequestError('A project or staff selection is required');
  if (!await hasOperationalOversight(actor.userId, actor.role)) throw new OperationalMapAccessError();
  const detailRequest = { staffId, workDate: request.workDate, asOf: request.asOf };
  const [detail, page] = await Promise.all([
    getOperationalEvidenceDetail(detailRequest),
    loadOperationalEvidence({ staffId, workDate: request.workDate, asOf: request.asOf, limit: 1, offset: 0 }),
  ]);
  const evidence = page.items[0];
  return evidence ? [{ summary: detailSummary(evidence, detail), evidence }] : [];
}

function joinRows(roster: RosterStatusResult, evidence: OperationalEvidence[], request: OperationalMapOverlayRequest): JoinedRow[] {
  const byStaff = new Map(evidence.map((item) => [item.staffId, item]));
  return roster.items.flatMap((summary) => {
    const item = byStaff.get(summary.staffId);
    if (!item || (request.staffId && summary.staffId !== request.staffId)
      || (request.siteId && summary.operationalSiteId !== request.siteId)) return [];
    return [{ summary, evidence: item }];
  });
}

function attendancePoint(row: JoinedRow): OperationalAttendancePoint | null {
  if (row.evidence.vehicle.vehicleId) return null;
  const point = row.evidence.attendance.clockInPoint;
  const start = row.summary.monitoringStart; const end = row.summary.monitoringEnd;
  if (!point || !start || !end) return null;
  if (!isOperationalAttendancePointEligible({ asOf: row.evidence.asOf, monitoringStart: start,
    monitoringEnd: end, status: row.summary.status, reasonCodes: row.summary.reasonCodes })
    || Date.parse(point.recordedAt) < Date.parse(start)
    || Date.parse(point.recordedAt) > Date.parse(end)
    || !row.summary.sourceTimestamps.includes(point.recordedAt)) return null;
  return { staffId: row.summary.staffId, staffName: row.summary.staffName, projectId: row.summary.projectId,
    operationalSiteId: row.summary.operationalSiteId, status: row.summary.status, latitude: point.latitude,
    longitude: point.longitude, recordedAt: point.recordedAt, source: 'attendance_clock_in', live: false,
    label: 'Attendance check-in evidence — not live tracking' };
}

async function loadGeometry(projectId: string, siteId?: string): Promise<OperationalOverlayGeometry | undefined> {
  const rows = await query<GeometryRow>(`/* fleet-operations:selected-map-geometry */
    SELECT ops.id site_id,ops.project_id,ops.display_name site_name,
      CASE WHEN aoi.id IS NOT NULL THEN 'aoi' ELSE 'authorized_location' END source,
      aoi.confidence,CASE WHEN aoi.id IS NOT NULL THEN ST_AsGeoJSON(aoi.geom)::jsonb END geojson,
      fal.lat latitude,fal.lon longitude,fal.radius_km*1000 radius_m
    FROM fleet_project_operational_sites ops
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
    WHERE ops.project_id=$1::uuid AND ops.is_active AND ($2::uuid IS NULL OR ops.id=$2::uuid)
    ORDER BY CASE WHEN ops.id=$2::uuid THEN 0 WHEN ops.is_default THEN 1 ELSE 2 END,ops.id LIMIT 1`,
  [projectId, siteId ?? null]);
  const row = rows[0]; if (!row) return undefined;
  if (row.source === 'aoi' && row.geojson && row.confidence) return { kind: 'aoi', operationalSiteId: row.site_id,
    projectId: row.project_id, operationalSiteName: row.site_name, confidence: row.confidence,
    lowConfidence: ['low', 'needs_verification'].includes(row.confidence), geoJson: row.geojson };
  const latitude = Number(row.latitude); const longitude = Number(row.longitude); const radiusM = Number(row.radius_m);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusM) || radiusM <= 0) return undefined;
  return { kind: 'authorized_location', operationalSiteId: row.site_id, projectId: row.project_id,
    operationalSiteName: row.site_name, center: { latitude, longitude }, radiusM };
}

export async function getOperationalMapOverlay(
  request: OperationalMapOverlayRequest,
  actor: OperationalMapActorScope,
): Promise<OperationalMapOverlay> {
  if (!Number.isInteger(request.page) || request.page < 1 || !Number.isInteger(request.limit)
    || request.limit < 1 || request.limit > 100) throw new OperationalMapRequestError('Invalid pagination');
  if (!request.projectId && !request.staffId && !request.siteId) {
    throw new OperationalMapRequestError('A project, staff or site selection is required');
  }
  const scopedRequest = !request.projectId && request.siteId
    ? { ...request, projectId: await resolveSiteProject(request.siteId) } : request;
  const allRows = scopedRequest.projectId ? await loadProjectRows(scopedRequest, actor) : await loadStaffRow(scopedRequest, actor);
  const offset = (request.page - 1) * request.limit; const rows = allRows.slice(offset, offset + request.limit);
  const badges = rows.flatMap(({ summary, evidence }) => evidence.vehicle.vehicleId ? [{ vehicleId: evidence.vehicle.vehicleId,
    staffId: summary.staffId, staffName: summary.staffName, projectId: summary.projectId, projectName: summary.projectName,
    operationalSiteId: summary.operationalSiteId, operationalSiteName: summary.operationalSiteName, status: summary.status,
    flags: summary.flags, reasonCodes: summary.reasonCodes, evidenceTimestamps: summary.sourceTimestamps,
    ruleId: summary.ruleId, ruleVersion: summary.ruleVersion }] : []);
  const attendancePoints = rows.flatMap((row) => { const point = attendancePoint(row); return point ? [point] : []; });
  const locatedStaff = new Set([...badges, ...attendancePoints].map((item) => item.staffId));
  const unplottable = rows.filter(({ summary }) => !locatedStaff.has(summary.staffId)).map(({ summary }) => ({
    staffId: summary.staffId, staffName: summary.staffName, projectId: summary.projectId,
    operationalSiteId: summary.operationalSiteId, status: summary.status,
    reason: 'no_permissible_coordinate' as const,
  }));
  const selectedRow = allRows[0];
  const selectedSiteId = request.siteId ?? (request.staffId ? selectedRow?.summary.operationalSiteId ?? undefined : undefined);
  const geometryProjectId = scopedRequest.projectId ?? (request.staffId ? selectedRow?.summary.projectId ?? undefined : undefined);
  const matchingStaffSelection = !request.staffId || selectedRow !== undefined;
  const geometry = request.includeGeometry && geometryProjectId && matchingStaffSelection
    ? await loadGeometry(geometryProjectId, selectedSiteId) : undefined;
  return { badges, attendancePoints, unplottable, ...(geometry ? { geometry } : {}), page: request.page,
    limit: request.limit, total: allRows.length, hasMore: offset + rows.length < allRows.length,
    workDate: request.workDate, evaluatedAt: request.asOf };
}
