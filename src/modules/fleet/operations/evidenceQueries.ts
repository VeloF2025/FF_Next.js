import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { staleAfterSecondsFor } from '@/services/tracking/staleness';
import { buildAssignmentRosterQuery } from '../assignments/rosterQueries';
import { loadEffectiveRule } from './ruleQueries';
import { operationalWindow } from './timeRules';
import type { OperationalEvidence, OperationalRule, OperationalVehiclePoint } from './types';

export interface OperationalEvidenceRequest { projectId?: string; workDate: string; asOf: string; limit: number; offset: number; staffId?: string }
export interface OperationalEvidencePage { items: OperationalEvidence[]; total: number }
type Row = Record<string, unknown>;
const asString = (value: unknown): string | null => typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : null;
const asNumber = (value: unknown): number => { const result = Number(value); if (!Number.isFinite(result)) throw new Error('invalid number'); return result; };
const by = (rows: Row[], key: string): Map<string, Row[]> => rows.reduce((map, row) => { const id = String(row[key]); map.set(id, [...(map.get(id) ?? []), row]); return map; }, new Map<string, Row[]>());

export async function loadOperationalEvidence(request: OperationalEvidenceRequest): Promise<OperationalEvidencePage> {
  const rule = await loadEffectiveRule(request.asOf);
  if (!rule) throw new Error('No effective operational status rule');
  if (!request.projectId && !request.staffId) throw new Error('A project or staff scope is required');
  const rosterQuery = buildAssignmentRosterQuery({ projectId: request.projectId, staffId: request.staffId,
    startDate: request.workDate, endDate: request.workDate, limit: request.limit, offset: request.offset });
  const rosterRows = await query<Row>(rosterQuery.text, rosterQuery.params);
  let total = rosterRows.length ? asNumber(rosterRows[0]!.total_count) : 0;
  if (!rosterRows.length && request.offset > 0) {
    const countSource = buildAssignmentRosterQuery({ projectId: request.projectId, staffId: request.staffId,
      startDate: request.workDate, endDate: request.workDate, limit: 1, offset: 0 });
    const countRows = await query<Row>(`SELECT COALESCE(MAX(total_count),0)::bigint total_count
      FROM (${countSource.text}) counted`, countSource.params);
    total = countRows[0] ? asNumber(countRows[0].total_count) : 0;
  }
  const schedules = await query<Row>(`WITH ids AS (SELECT unnest($1::uuid[]) staff_id)
    SELECT ids.staff_id,ap.id policy_id,sp.id schedule_policy_id,
      COALESCE(sp.timezone,'Africa/Johannesburg') timezone,ap.start_time::text,ap.end_time::text,
      COALESCE((ap.work_days->>TRIM(LOWER(TO_CHAR($2::date,'day'))))::boolean,false) scheduled,
      sp.late_alert_minutes grace_minutes
    FROM ids LEFT JOIN LATERAL (SELECT ap.* FROM attendance_policy_assignments apa
      JOIN attendance_policies ap ON ap.id=apa.policy_id AND ap.is_active
      WHERE apa.staff_id=ids.staff_id AND apa.effective_from<=$2::date
        AND COALESCE(apa.effective_to,'9999-12-31')>=$2::date ORDER BY apa.effective_from DESC LIMIT 1) ap ON true
    LEFT JOIN LATERAL (SELECT asp.* FROM attendance_schedule_policies asp
      WHERE asp.active_from<=$2::date AND COALESCE(asp.active_to,'9999-12-31')>=$2::date
      ORDER BY asp.active_from DESC LIMIT 1) sp ON true`, [rosterRows.map((row) => row.staff_id), request.workDate]);
  const schedulesByStaff = new Map(schedules.map((row) => [String(row.staff_id), row]));
  const roster = rosterRows.map((row) => ({ ...row, ...schedulesByStaff.get(String(row.staff_id)),
    source: row.assignment_kind, explicit_work: ['roster', 'daily_override'].includes(String(row.assignment_kind)) }));
  const staffIds = roster.map((row) => String(row.staff_id));
  const staffSiteIds = roster.map((row) => row.operational_site_id);
  const staffProjectIds = roster.map((row) => row.project_id);
  const attendance = await query<Row>(`WITH mapping AS (SELECT * FROM unnest($1::uuid[],$2::uuid[],$4::uuid[]) m(staff_id,site_id,project_id))
    SELECT ae.id entry_id,ae.staff_id,ae.clock_in_at,
    CASE WHEN ae.clock_out_at<=$5::timestamptz THEN ae.clock_out_at END clock_out_at,
    ae.clock_in_lat latitude,ae.clock_in_lon longitude,
    CASE WHEN ae.clock_out_at<=$5::timestamptz THEN ae.clock_out_lat END out_latitude,
    CASE WHEN ae.clock_out_at<=$5::timestamptz THEN ae.clock_out_lon END out_longitude,
    ae.site_geofence_id matched_site_id,(aoi.id IS NOT NULL OR fal.id IS NOT NULL) site_valid,
    CASE WHEN aoi.id IS NOT NULL THEN ST_Covers(aoi.geom,point.geom)
      WHEN fal.id IS NOT NULL THEN ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000) END site_inside,
    CASE WHEN aoi.id IS NOT NULL THEN ST_Distance(aoi.geom::geography,point.geom::geography)
      WHEN fal.id IS NOT NULL THEN GREATEST(0,ST_Distance(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography)-fal.radius_km*1000) END site_distance_m,
    known.id known_site_id
    FROM mapping JOIN LATERAL (SELECT ae.* FROM attendance_entries ae
      WHERE ae.staff_id=mapping.staff_id AND ae.work_date=$3::date AND ae.clock_in_at<=$5::timestamptz
      ORDER BY ae.clock_in_at DESC,ae.id DESC LIMIT 1) ae ON true
    LEFT JOIN fleet_project_operational_sites ops ON ops.id=mapping.site_id AND ops.is_active
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
      AND fal.lat BETWEEN -90 AND 90 AND fal.lon BETWEEN -180 AND 180 AND fal.radius_km>0
    LEFT JOIN LATERAL (SELECT ST_SetSRID(ST_Point(ae.clock_in_lon,ae.clock_in_lat),4326) geom) point
      ON ae.clock_in_lat BETWEEN -90 AND 90 AND ae.clock_in_lon BETWEEN -180 AND 180
    LEFT JOIN LATERAL (SELECT candidate.id FROM fleet_project_operational_sites candidate
      LEFT JOIN fno_atlas_project_aois caoi ON caoi.id=candidate.project_aoi_id AND caoi.retired_at IS NULL
      LEFT JOIN fleet_authorized_locations cfal ON cfal.id=candidate.authorized_location_id AND cfal.is_active
        AND cfal.lat BETWEEN -90 AND 90 AND cfal.lon BETWEEN -180 AND 180 AND cfal.radius_km>0
      WHERE candidate.project_id=mapping.project_id AND candidate.is_active AND ((caoi.id IS NOT NULL AND ST_Covers(caoi.geom,point.geom))
        OR (cfal.id IS NOT NULL AND ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(cfal.lon,cfal.lat),4326)::geography,cfal.radius_km*1000)))
      ORDER BY CASE WHEN candidate.id=mapping.site_id THEN 0 WHEN candidate.authorized_location_id=ae.site_geofence_id THEN 1 ELSE 2 END,candidate.id LIMIT 1) known ON point.geom IS NOT NULL`, [staffIds, staffSiteIds, request.workDate, staffProjectIds, new Date(request.asOf).toISOString()]);
  const vehicles = await query<Row>(`WITH mapping AS (
      SELECT * FROM unnest($1::uuid[],$3::uuid[]) m(staff_id,selected_assignment_id)
    ) SELECT va.staff_id,va.id assignment_id,va.fleet_vehicle_id vehicle_id,
    fvt.provider,fvt.account_ref,COUNT(*) OVER (PARTITION BY va.staff_id) candidate_count
    FROM mapping JOIN vehicle_assignments va ON va.staff_id=mapping.staff_id
      AND va.assignment_start<=$2::date AND COALESCE(va.assignment_end,'9999-12-31'::date)>=$2::date
      AND (mapping.selected_assignment_id IS NULL OR va.id=mapping.selected_assignment_id)
    JOIN fleet_vehicles fv ON fv.id=va.fleet_vehicle_id AND LOWER(COALESCE(fv.status,'active'))='active'
    LEFT JOIN fleet_vehicle_trackers fvt ON fvt.vehicle_id=va.fleet_vehicle_id AND fvt.is_active
    ORDER BY va.staff_id,va.id`, [staffIds, request.workDate, roster.map((row) => row.vehicle_assignment_id)]);
  const vehicleCandidates = by(vehicles, 'staff_id');
  const selectedVehicles = roster.flatMap((row) => {
    const candidates = vehicleCandidates.get(String(row.staff_id)) ?? [];
    const selectedId = asString(row.vehicle_assignment_id);
    if (selectedId) return candidates.filter((candidate) => String(candidate.assignment_id) === selectedId).slice(0, 1);
    return candidates.length === 1 ? candidates : [];
  });
  const vehicleMappings = selectedVehicles.flatMap((vehicle) => {
    const row = roster.find((candidate) => candidate.staff_id === vehicle.staff_id);
    if (!row) return [];
    try { return [{ vehicle, row, monitoringEnd: operationalWindow(toSchedule(row, request.workDate), rule).monitoringEnd }]; }
    catch (error) {
      // An unusable schedule drops this staff member from the GPS window only.
      // evaluateOperationalStatus recomputes the same window per person and
      // resolves it to unverifiable/evidence_source_error, so the status stays
      // correct — but the swallow was previously unlogged, which made the
      // downstream recomputation look like the sole safeguard.
      log.warn('Skipping vehicle GPS window for an unusable schedule', {
        staffId: String(vehicle.staff_id), workDate: request.workDate, error,
      }, 'fleet');
      return [];
    }
  });
  const vehicleIds = vehicleMappings.map(({ vehicle }) => String(vehicle.vehicle_id));
  const vehicleSiteIds = vehicleMappings.map(({ row }) => row.operational_site_id);
  const vehicleProjectIds = vehicleMappings.map(({ row }) => row.project_id);
  const monitoringEnds = vehicleMappings.map(({ monitoringEnd }) => monitoringEnd);
  const lookbackMinutes = Math.max(rule.arrivalDwellMinutes, rule.wrongSiteConfirmationMinutes, rule.earlyDepartureConfirmationMinutes);
  const starts = roster.flatMap((row) => {
    try { return [Date.parse(operationalWindow(toSchedule(row, request.workDate), rule).monitoringStart)]; }
    catch (error) {
      // Same contract as the vehicle window above: this row only loses its
      // contribution to the earliest-lookback bound, and falls back to the
      // workDate-derived start below. Per-person status is unaffected.
      log.warn('Excluding an unusable schedule from the GPS lookback bound', {
        staffId: String(row.staff_id), workDate: request.workDate, error,
      }, 'fleet');
      return [];
    }
  });
  const fallbackStart = Date.parse(`${request.workDate}T00:00:00+02:00`) - rule.monitoringBeforeMinutes * 60_000;
  const earliest = new Date((starts.length ? Math.min(...starts) : fallbackStart) - lookbackMinutes * 60_000).toISOString();
  const positions = await query<Row>(`WITH mapping AS (SELECT * FROM unnest($1::uuid[],$2::uuid[],$5::uuid[],$6::timestamptz[]) m(vehicle_id,site_id,project_id,monitoring_end))
    SELECT p.vehicle_id,p.recorded_at,p.lat latitude,p.lon longitude,p.speed_kph speed_kmh,
      (aoi.id IS NOT NULL OR fal.id IS NOT NULL) site_valid,
      CASE WHEN aoi.id IS NOT NULL THEN ST_Covers(aoi.geom,point.geom)
        WHEN fal.id IS NOT NULL THEN ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography,fal.radius_km*1000) ELSE false END site_inside,
      CASE WHEN aoi.id IS NOT NULL THEN ST_Distance(aoi.geom::geography,point.geom::geography)
        WHEN fal.id IS NOT NULL THEN GREATEST(0,ST_Distance(point.geom::geography,ST_SetSRID(ST_Point(fal.lon,fal.lat),4326)::geography)-fal.radius_km*1000) END site_distance_m,
      known.id known_site_id
    FROM mapping JOIN fleet_vehicle_positions p ON p.vehicle_id=mapping.vehicle_id
    LEFT JOIN fleet_project_operational_sites ops ON ops.id=mapping.site_id AND ops.is_active
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
      AND fal.lat BETWEEN -90 AND 90 AND fal.lon BETWEEN -180 AND 180 AND fal.radius_km>0
    CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(p.lon,p.lat),4326) geom) point
    LEFT JOIN LATERAL (SELECT candidate.id FROM fleet_project_operational_sites candidate
      LEFT JOIN fno_atlas_project_aois caoi ON caoi.id=candidate.project_aoi_id AND caoi.retired_at IS NULL
      LEFT JOIN fleet_authorized_locations cfal ON cfal.id=candidate.authorized_location_id AND cfal.is_active
        AND cfal.lat BETWEEN -90 AND 90 AND cfal.lon BETWEEN -180 AND 180 AND cfal.radius_km>0
      WHERE candidate.project_id=mapping.project_id AND candidate.is_active AND ((caoi.id IS NOT NULL AND ST_Covers(caoi.geom,point.geom))
        OR (cfal.id IS NOT NULL AND ST_DWithin(point.geom::geography,ST_SetSRID(ST_Point(cfal.lon,cfal.lat),4326)::geography,cfal.radius_km*1000)))
      ORDER BY CASE WHEN candidate.id=mapping.site_id THEN 0 ELSE 1 END LIMIT 1) known ON true
    WHERE p.lat BETWEEN -90 AND 90 AND p.lon BETWEEN -180 AND 180
      AND p.recorded_at BETWEEN $3::timestamptz AND LEAST($4::timestamptz,mapping.monitoring_end)
    ORDER BY p.vehicle_id,p.recorded_at`,
  [vehicleIds, vehicleSiteIds, earliest, new Date(request.asOf).toISOString(), vehicleProjectIds, monitoringEnds]);
  const sites = await query<Row>(`SELECT ops.id operational_site_id,
    (ops.is_active AND (aoi.id IS NOT NULL OR (fal.id IS NOT NULL AND fal.lat BETWEEN -90 AND 90
      AND fal.lon BETWEEN -180 AND 180 AND fal.radius_km>0))) geometry_valid,
    COALESCE(aoi.confidence IN ('low','needs_verification'),false) low_confidence
    FROM fleet_project_operational_sites ops
    LEFT JOIN fno_atlas_project_aois aoi ON aoi.id=ops.project_aoi_id AND aoi.retired_at IS NULL
    LEFT JOIN fleet_authorized_locations fal ON fal.id=ops.authorized_location_id AND fal.is_active
    WHERE ops.id=ANY($1::uuid[])`, [roster.map((row) => row.operational_site_id).filter(Boolean)]);
  return { items: mapEvidence(roster, attendance, vehicles, positions, sites, rule, request), total };
}

function toSchedule(row: Row, workDate: string): NonNullable<OperationalEvidence['schedule']> {
  return { policyId: String(row.schedule_policy_id ?? row.policy_id), workDate, timezone: String(row.timezone), scheduled: Boolean(row.scheduled),
    explicitWork: Boolean(row.explicit_work), startTime: String(row.start_time), endTime: String(row.end_time), graceMinutes: asNumber(row.grace_minutes) };
}

function mapEvidence(roster: Row[], attendanceRows: Row[], vehicleRows: Row[], positionRows: Row[], siteRows: Row[], rule: OperationalRule, request: OperationalEvidenceRequest): OperationalEvidence[] {
  const attendance = by(attendanceRows, 'staff_id'); const vehicles = by(vehicleRows, 'staff_id');
  const positions = by(positionRows, 'vehicle_id'); const sites = by(siteRows, 'operational_site_id');
  const freshness = new Map<string, number>();
  for (const row of vehicleRows) { const provider = asString(row.provider); const account = asString(row.account_ref); if (!provider || !account) continue; const key = `${provider}\0${account}`; if (!freshness.has(key)) freshness.set(key, staleAfterSecondsFor(provider, account)); }
  return roster.map((row) => {
    try { return mapPerson(row, attendance.get(String(row.staff_id))?.[0], vehicles.get(String(row.staff_id)) ?? [], positions, sites, freshness, rule, request); }
    catch { return emptyEvidence(row, rule, request, ['malformed_evidence']); }
  });
}

function mapPerson(row: Row, attendance: Row | undefined, vehicleCandidates: Row[], positions: Map<string, Row[]>, sites: Map<string, Row[]>, freshness: Map<string, number>, rule: OperationalRule, request: OperationalEvidenceRequest): OperationalEvidence {
  const base = emptyEvidence(row, rule, request, []); const site = sites.get(String(row.operational_site_id))?.[0];
  base.schedule = toSchedule(row, request.workDate);
  base.assignment.siteGeometryValid = Boolean(site?.geometry_valid); base.assignment.siteGeometryLowConfidence = Boolean(site?.low_confidence);
  if (attendance) {
    const clockInAt = asString(attendance.clock_in_at); const clockOutAt = asString(attendance.clock_out_at);
    const latitude = attendance.latitude == null ? null : asNumber(attendance.latitude); const longitude = attendance.longitude == null ? null : asNumber(attendance.longitude);
    const outLatitude = attendance.out_latitude == null ? null : asNumber(attendance.out_latitude); const outLongitude = attendance.out_longitude == null ? null : asNumber(attendance.out_longitude);
    base.attendance = { entryId: String(attendance.entry_id), clockInAt, clockOutAt,
      clockInPoint: latitude === null || longitude === null || !clockInAt ? null : { latitude, longitude, recordedAt: clockInAt },
      clockOutPoint: outLatitude === null || outLongitude === null || !clockOutAt ? null : { latitude: outLatitude, longitude: outLongitude, recordedAt: clockOutAt },
      matchedSiteId: asString(attendance.matched_site_id), requiredSite: attendance.site_valid == null ? null : { valid: Boolean(attendance.site_valid), inside: Boolean(attendance.site_inside), distanceM: attendance.site_distance_m == null ? null : asNumber(attendance.site_distance_m), knownSiteId: asString(attendance.known_site_id) } };
  }
  const selectedId = asString(row.vehicle_assignment_id);
  const vehicle = selectedId ? vehicleCandidates.find((candidate) => String(candidate.assignment_id) === selectedId)
    : vehicleCandidates.length === 1 ? vehicleCandidates[0] : undefined;
  if (!selectedId && vehicleCandidates.length > 1) base.assignment.ambiguous = true;
  if (selectedId && !vehicle) base.sourceErrors.push('selected_vehicle_assignment_unavailable');
  if (vehicle) {
    const vehicleId = String(vehicle.vehicle_id); const provider = asString(vehicle.provider);
    const account = asString(vehicle.account_ref); const key = provider && account ? `${provider}\0${account}` : null;
    base.vehicle = { assignmentId: String(vehicle.assignment_id), vehicleId, provider, accountRef: account,
      staleAfterSeconds: key ? freshness.get(key) ?? null : null,
      positions: (positions.get(vehicleId) ?? []).map(mapPosition) };
  }
  return base;
}

function mapPosition(row: Row): OperationalVehiclePoint { return { recordedAt: asString(row.recorded_at)!, latitude: asNumber(row.latitude ?? row.lat), longitude: asNumber(row.longitude ?? row.lon), speedKmh: asNumber(row.speed_kmh ?? row.speed_kph ?? 0), valid: Boolean(row.site_valid), inside: Boolean(row.site_inside), distanceM: asNumber(row.site_distance_m ?? 0), knownSiteId: asString(row.known_site_id) }; }
function emptyEvidence(row: Row, rule: OperationalRule, request: OperationalEvidenceRequest, sourceErrors: string[]): OperationalEvidence { return { asOf: request.asOf, workDate: request.workDate, staffId: String(row.staff_id), staffName: String(row.staff_name), assignment: { assignmentId: asString(row.assignment_id), source: (row.source ?? 'unassigned') as OperationalEvidence['assignment']['source'], projectId: asString(row.project_id), projectName: asString(row.project_name), operationalSiteId: asString(row.operational_site_id), operationalSiteName: asString(row.operational_site_name), ambiguous: false, siteGeometryValid: false, siteGeometryLowConfidence: false }, schedule: null, attendance: { entryId: null, clockInAt: null, clockOutAt: null, clockInPoint: null, clockOutPoint: null, matchedSiteId: null, requiredSite: null }, vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] }, rule, sourceWarnings: [], sourceErrors }; }
