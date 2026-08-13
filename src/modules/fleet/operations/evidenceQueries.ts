import { query } from '@/lib/db-pool';
import { staleAfterSecondsFor } from '@/services/tracking/staleness';
import { buildAssignmentRosterQuery } from '../assignments/rosterQueries';
import { loadEffectiveRule } from './ruleQueries';
import type { OperationalEvidence, OperationalRule, OperationalVehiclePoint } from './types';

export interface OperationalEvidenceRequest { projectId: string; workDate: string; asOf: string; limit: number; offset: number; staffId?: string }
type Row = Record<string, unknown>;
const asString = (value: unknown): string | null => typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : null;
const asNumber = (value: unknown): number => { const result = Number(value); if (!Number.isFinite(result)) throw new Error('invalid number'); return result; };
const by = (rows: Row[], key: string): Map<string, Row[]> => rows.reduce((map, row) => { const id = String(row[key]); map.set(id, [...(map.get(id) ?? []), row]); return map; }, new Map<string, Row[]>());

export async function loadOperationalEvidence(request: OperationalEvidenceRequest): Promise<OperationalEvidence[]> {
  const rule = await loadEffectiveRule(request.asOf);
  if (!rule) throw new Error('No effective operational status rule');
  const rosterQuery = buildAssignmentRosterQuery({ projectId: request.projectId, staffId: request.staffId,
    startDate: request.workDate, endDate: request.workDate, limit: request.limit, offset: request.offset });
  const roster = (await query<Row>(rosterQuery.text, rosterQuery.params)).map((row) => ({ ...row,
    source: row.assignment_kind, policy_id: null, timezone: rule.timezone, start_time: row.expected_start_time,
    end_time: row.expected_end_time, grace_minutes: row.grace_minutes ?? 15,
    explicit_work: ['roster', 'daily_override'].includes(String(row.assignment_kind)) }));
  const staffIds = roster.map((row) => String(row.staff_id));
  const staffSiteIds = roster.map((row) => row.operational_site_id);
  const attendance = await query<Row>(`WITH mapping AS (SELECT * FROM unnest($1::uuid[],$2::uuid[]) m(staff_id,site_id))
    SELECT ae.id entry_id,ae.staff_id,ae.clock_in_time clock_in_at,
    ae.clock_out_time clock_out_at,ae.clock_in_latitude latitude,ae.clock_in_longitude longitude,
    ae.matched_geofence_id matched_site_id,ops.id IS NOT NULL site_valid,
    CASE WHEN aoi.id IS NOT NULL THEN ST_Covers(aoi.geom,point.geom)
      WHEN fal.id IS NOT NULL THEN ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000) END site_inside,
    CASE WHEN aoi.id IS NOT NULL THEN ST_Distance(aoi.geom::geography,point.geom::geography)
      WHEN fal.id IS NOT NULL THEN GREATEST(0,ST_Distance(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography)-fal.radius_km*1000) END site_distance_m,
    CASE WHEN (aoi.id IS NOT NULL AND ST_Covers(aoi.geom,point.geom)) OR (fal.id IS NOT NULL AND ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000)) THEN ops.id END known_site_id
    FROM mapping JOIN attendance_entries ae ON ae.staff_id=mapping.staff_id AND ae.date=$3::date
    LEFT JOIN fleet_project_operational_sites ops ON ops.id=mapping.site_id AND ops.is_active
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
    LEFT JOIN LATERAL (SELECT ST_SetSRID(ST_Point(ae.clock_in_longitude,ae.clock_in_latitude),4326) geom) point ON ae.clock_in_latitude IS NOT NULL AND ae.clock_in_longitude IS NOT NULL`, [staffIds, staffSiteIds, request.workDate]);
  const vehicles = await query<Row>(`SELECT va.staff_id,va.id assignment_id,va.fleet_vehicle_id vehicle_id,
    fvt.provider,fvt.account_ref FROM vehicle_assignments va
    LEFT JOIN fleet_vehicle_trackers fvt ON fvt.vehicle_id=va.fleet_vehicle_id AND fvt.is_active
    WHERE va.staff_id=ANY($1::uuid[]) AND va.assignment_start<=$2::date
      AND COALESCE(va.assignment_end,'9999-12-31'::date)>=$2::date`, [staffIds, request.workDate]);
  const vehicleIds = vehicles.map((row) => String(row.vehicle_id));
  const vehicleSiteIds = vehicles.map((vehicle) => roster.find((row) => row.staff_id === vehicle.staff_id)?.operational_site_id ?? null);
  const earliest = new Date(Date.parse(request.asOf) - (rule.monitoringBeforeMinutes + rule.earlyDepartureConfirmationMinutes + rule.arrivalDwellMinutes) * 60_000).toISOString();
  const positions = await query<Row>(`WITH mapping AS (SELECT * FROM unnest($1::uuid[],$2::uuid[]) m(vehicle_id,site_id))
    SELECT p.vehicle_id,p.recorded_at,p.latitude,p.longitude,p.speed_kmh,ops.id IS NOT NULL site_valid,
      CASE WHEN aoi.id IS NOT NULL THEN ST_Covers(aoi.geom,point.geom)
        WHEN fal.id IS NOT NULL THEN ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000) ELSE false END site_inside,
      CASE WHEN aoi.id IS NOT NULL THEN ST_Distance(aoi.geom::geography,point.geom::geography)
        WHEN fal.id IS NOT NULL THEN GREATEST(0,ST_Distance(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography)-fal.radius_km*1000) END site_distance_m,
      CASE WHEN (aoi.id IS NOT NULL AND ST_Covers(aoi.geom,point.geom)) OR (fal.id IS NOT NULL AND ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000)) THEN ops.id END known_site_id
    FROM mapping JOIN fleet_vehicle_positions p ON p.vehicle_id=mapping.vehicle_id
    LEFT JOIN fleet_project_operational_sites ops ON ops.id=mapping.site_id AND ops.is_active
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
    CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(p.longitude,p.latitude),4326) geom) point
    WHERE p.recorded_at BETWEEN $3::timestamptz AND $4::timestamptz ORDER BY p.vehicle_id,p.recorded_at`,
  [vehicleIds, vehicleSiteIds, earliest, new Date(request.asOf).toISOString()]);
  const sites = await query<Row>(`SELECT ops.id operational_site_id,ops.is_active geometry_valid,
    aoi.confidence IN ('low','needs_verification') low_confidence
    FROM fleet_project_operational_sites ops
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
    WHERE ops.id=ANY($1::uuid[]) AND (aoi.id IS NOT NULL OR fal.id IS NOT NULL)`, [roster.map((row) => row.operational_site_id).filter(Boolean)]);
  return mapEvidence(roster, attendance, vehicles, positions, sites, rule, request);
}

function mapEvidence(roster: Row[], attendanceRows: Row[], vehicleRows: Row[], positionRows: Row[], siteRows: Row[], rule: OperationalRule, request: OperationalEvidenceRequest): OperationalEvidence[] {
  const attendance = by(attendanceRows, 'staff_id'); const vehicles = by(vehicleRows, 'staff_id');
  const positions = by(positionRows, 'vehicle_id'); const sites = by(siteRows, 'operational_site_id');
  const freshness = new Map<string, number>();
  for (const row of vehicleRows) { const provider = String(row.provider); const account = String(row.account_ref); const key = `${provider}\0${account}`; if (!freshness.has(key)) freshness.set(key, staleAfterSecondsFor(provider, account)); }
  return roster.map((row) => {
    try { return mapPerson(row, attendance.get(String(row.staff_id))?.[0], vehicles.get(String(row.staff_id))?.[0], positions, sites, freshness, rule, request); }
    catch { return emptyEvidence(row, rule, request, ['malformed_evidence']); }
  });
}

function mapPerson(row: Row, attendance: Row | undefined, vehicle: Row | undefined, positions: Map<string, Row[]>, sites: Map<string, Row[]>, freshness: Map<string, number>, rule: OperationalRule, request: OperationalEvidenceRequest): OperationalEvidence {
  const base = emptyEvidence(row, rule, request, []); const site = sites.get(String(row.operational_site_id))?.[0];
  base.schedule = { policyId: String(row.policy_id), workDate: request.workDate, timezone: String(row.timezone), scheduled: Boolean(row.scheduled), explicitWork: Boolean(row.explicit_work), startTime: String(row.start_time), endTime: String(row.end_time), graceMinutes: asNumber(row.grace_minutes) };
  base.assignment.siteGeometryValid = Boolean(site?.geometry_valid ?? row.operational_site_id); base.assignment.siteGeometryLowConfidence = Boolean(site?.low_confidence);
  if (attendance) { const clockInAt = asString(attendance.clock_in_at); const latitude = attendance.latitude == null ? null : asNumber(attendance.latitude); const longitude = attendance.longitude == null ? null : asNumber(attendance.longitude); base.attendance = { entryId: String(attendance.entry_id), clockInAt, clockOutAt: asString(attendance.clock_out_at), clockInPoint: latitude === null || longitude === null || !clockInAt ? null : { latitude, longitude, recordedAt: clockInAt }, clockOutPoint: null, matchedSiteId: asString(attendance.matched_site_id), requiredSite: attendance.site_valid == null ? null : { valid: Boolean(attendance.site_valid), inside: Boolean(attendance.site_inside), distanceM: attendance.site_distance_m == null ? null : asNumber(attendance.site_distance_m), knownSiteId: asString(attendance.known_site_id) } }; }
  if (vehicle) { const vehicleId = String(vehicle.vehicle_id); const provider = String(vehicle.provider); const account = String(vehicle.account_ref); base.vehicle = { assignmentId: String(vehicle.assignment_id), vehicleId, provider, accountRef: account, staleAfterSeconds: freshness.get(`${provider}\0${account}`)!, positions: (positions.get(vehicleId) ?? []).map(mapPosition) }; }
  return base;
}

function mapPosition(row: Row): OperationalVehiclePoint { return { recordedAt: asString(row.recorded_at)!, latitude: asNumber(row.latitude), longitude: asNumber(row.longitude), speedKmh: asNumber(row.speed_kmh ?? 0), valid: true, inside: Boolean(row.site_inside), distanceM: asNumber(row.site_distance_m ?? 0), knownSiteId: asString(row.known_site_id) }; }
function emptyEvidence(row: Row, rule: OperationalRule, request: OperationalEvidenceRequest, sourceErrors: string[]): OperationalEvidence { return { asOf: request.asOf, workDate: request.workDate, staffId: String(row.staff_id), staffName: String(row.staff_name), assignment: { assignmentId: asString(row.assignment_id), source: (row.source ?? 'unassigned') as OperationalEvidence['assignment']['source'], projectId: asString(row.project_id), operationalSiteId: asString(row.operational_site_id), ambiguous: Boolean(row.assignment_ambiguous), siteGeometryValid: false, siteGeometryLowConfidence: false }, schedule: null, attendance: { entryId: null, clockInAt: null, clockOutAt: null, clockInPoint: null, clockOutPoint: null, matchedSiteId: null, requiredSite: null }, vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] }, rule, sourceWarnings: [], sourceErrors }; }
